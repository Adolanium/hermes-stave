// The Stave page: one score, Hermes in its margins, playback at the top, the ask field at the foot.
import abcjs from 'abcjs'
import { icons, Popover, PopoverContent, PopoverTrigger, writeClipboardText } from '@hermes/plugin-sdk'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { changeBars, compose, reshape } from '../music/compose.js'
import { instrumentOf, restoreVersion, toAbc } from '../music/model.js'
import { makeAsk } from './ask.js'
import { fmtTime, midiBytes, Player, barOfEvent } from './player.js'
import { Sheet } from './sheet.jsx'
import { deletePiece, loadPieces, savePiece, setCurrent, currentId } from './store.js'
import { CSS } from './styles.js'

const SUGGESTIONS = [
  'a lullaby for a rainy night',
  'a sea shanty for a very small boat',
  'a waltz for two cats in love',
  'a victory fanfare for finishing my taxes',
  'something hopeful, like the first warm morning of spring'
]

function useStyles() {
  useEffect(() => {
    const el = document.createElement('style')
    el.dataset.stave = 'true'
    el.textContent = CSS
    document.head.appendChild(el)
    return () => el.remove()
  }, [])
}

function keyName(key) {
  const m = /^([A-G][#b]?)(m?)$/.exec(key || 'C')
  if (!m) return key
  return `${m[1].replace('#', '♯').replace('b', '♭')} ${m[2] ? 'minor' : 'major'}`
}

function UndoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 14l-4-4 4-4" />
      <path d="M5 10h11a4 4 0 1 1 0 8h-1" />
    </svg>
  )
}

function MinusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 12h12" /></svg>
  )
}

function PlayGlyph({ playing }) {
  return playing ? (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4.2" height="14" rx="1.2" /><rect x="13.8" y="5" width="4.2" height="14" rx="1.2" /></svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.6v12.8c0 .8.9 1.3 1.6.9l10-6.4a1 1 0 0 0 0-1.8l-10-6.4C8.9 4.3 8 4.8 8 5.6z" /></svg>
  )
}

function download(name, blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

function fileName(piece, ext) {
  return `${(piece.title || 'stave').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'stave'}.${ext}`
}

function usePlayer() {
  const player = useMemo(() => new Player(), [])
  const [, force] = useState(0)
  useEffect(() => player.on(() => force(n => n + 1)), [player])
  useEffect(() => () => player.stop(), [player])
  return player
}

/** Re-render on every frame while playing, for the clock and the scrubber. */
function useClock(player) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!player.playing) return
    let raf = 0
    let last = 0
    const loop = now => {
      raf = requestAnimationFrame(loop)
      if (now - last > 120) { last = now; tick(n => n + 1) }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [player.playing])
}

/**
 * Hermes writes in the theme's accent when it has colour; a grey accent gets an editor's blue pencil,
 * lighter on dark grounds, deeper on light ones.
 */
function usePencil(ref) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const apply = () => {
      el.style.removeProperty('--st-pencil')
      const probe = document.createElement('span')
      probe.style.color = 'var(--ui-accent, transparent)'
      el.appendChild(probe)
      const accent = parseRgb(getComputedStyle(probe).color)
      probe.style.color = 'var(--st-ground)'
      const ground = parseRgb(getComputedStyle(probe).color)
      probe.remove()
      if (accent && saturation(accent) >= 0.28) return
      const dark = ground ? luminance(ground) < 0.4 : true
      el.style.setProperty('--st-pencil', dark ? 'oklch(0.74 0.14 252)' : 'oklch(0.52 0.19 262)')
    }
    apply()
    const mo = new MutationObserver(apply)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
    return () => mo.disconnect()
  }, [])
}

function parseRgb(text) {
  const m = /rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/.exec(text || '')
  return m ? [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255] : null
}

function saturation([r, g, b]) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max === 0 ? 0 : (max - min) / max
}

function luminance([r, g, b]) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function StavePage({ storage }) {
  useStyles()
  const pageRef = useRef(null)
  usePencil(pageRef)
  const player = usePlayer()
  const [pieces, setPieces] = useState(() => loadPieces(storage))
  const [piece, setPiece] = useState(() => {
    const id = currentId(storage)
    return loadPieces(storage).find(p => p.id === id) || null
  })
  const [phase, setPhase] = useState('idle') // idle | composing | editing | reshaping
  const [progress, setProgress] = useState(null) // { label, step, total }
  const [writing, setWriting] = useState(null)
  const [slither, setSlither] = useState(null)
  const [selection, setSelection] = useState(null)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [draft, setDraft] = useState('')
  const [useChatModel, setUseChatModel] = useState(() => storage.get('useChatModel', true) !== false)
  const chatModelRef = useRef(useChatModel)
  chatModelRef.current = useChatModel
  const cancelRef = useRef(false)
  const lastRequest = useRef(null)
  const inputRef = useRef(null)
  useClock(player)

  const ask = useMemo(() => makeAsk(storage, { useChatModel: () => chatModelRef.current }), [storage])
  const abc = useMemo(() => (piece && piece.bars.length ? toAbc(piece) : ''), [piece])
  const working = phase !== 'idle'

  const persist = useCallback(p => setPieces(savePiece(storage, p)), [storage])

  const openPiece = p => {
    player.stop()
    if (!p) player.setTune(null)
    setPiece(p)
    setSelection(null)
    setError(null)
    setSlither(p ? { from: 0, to: p.bars.length - 1, key: Date.now() } : null)
    setCurrent(storage, p ? p.id : null)
  }

  const runCompose = async prompt => {
    const text = prompt.trim()
    if (!text || working) return
    lastRequest.current = { kind: 'compose', text }
    player.stop()
    cancelRef.current = false
    setError(null)
    setSelection(null)
    setDraft('')
    setPhase('composing')
    setPiece(null)
    player.setTune(null)
    setProgress({ label: 'Planning the form', step: 0, total: 1 })
    setWriting({ text: 'planning the form…' })
    try {
      await compose(ask, abcjs, text, ev => {
        if (ev.phase === 'plan') {
          setPiece(ev.piece)
          setProgress({ label: 'Planned', step: 1, total: ev.piece.sections.length + 1 })
        } else if (ev.phase === 'writing') {
          const s = ev.piece.sections.find(x => x.id === ev.section)
          setWriting({ text: `writing ${s?.name ? s.name.toLowerCase() : `section ${ev.section}`}…` })
          setProgress(p => ({ ...p, label: `Writing ${s?.name || `section ${ev.section}`}` }))
        } else if (ev.phase === 'repair') {
          setWriting({ text: `checking bar${ev.bars.length > 1 ? 's' : ''} ${ev.bars.map(b => b + 1).join(', ')}…` })
        } else if (ev.phase === 'section') {
          setPiece(ev.piece)
          setSlither({ from: ev.from, to: ev.to, key: Date.now() })
          setProgress(p => ({ ...p, step: (p?.step || 1) + 1 }))
        } else if (ev.phase === 'done') {
          setPiece(ev.piece)
          persist(ev.piece)
        }
      }, () => cancelRef.current)
    } catch (e) {
      if (String(e?.message) !== 'cancelled') setError(friendly(e))
    } finally {
      setPhase('idle')
      setWriting(null)
      setProgress(null)
    }
  }

  const runChange = async request => {
    const text = request.trim()
    if (!text || working || !piece) return
    lastRequest.current = { kind: 'change', text, selection }
    player.stop()
    setError(null)
    setDraft('')
    const sel = selection
    try {
      if (sel) {
        setPhase('editing')
        setBusy(sel)
        const { piece: next } = await changeBars(ask, abcjs, piece, sel.from, sel.to, text)
        setPiece(next)
        persist(next)
        setSlither({ from: sel.from, to: sel.to, key: Date.now() })
      } else {
        setPhase('reshaping')
        setBusy({ from: 0, to: piece.bars.length - 1 })
        const before = piece
        const { piece: next, note } = await reshape(ask, abcjs, piece, text)
        const rewrote = next.bars !== before.bars
        const marked = { ...next, marks: [...next.marks.filter(m => m.kind !== 'piece'), { kind: 'piece', from: 0, to: 0, text: note, at: Date.now() }] }
        setPiece(marked)
        persist(marked)
        if (rewrote) setSlither({ from: 0, to: next.bars.length - 1, key: Date.now() })
      }
    } catch (e) {
      setError(friendly(e))
    } finally {
      setPhase('idle')
      setBusy(null)
    }
  }

  const submit = () => (piece ? runChange(draft) : runCompose(draft))

  const undo = () => {
    if (!piece || !canUndo(piece)) return
    player.stop()
    const prev = restoreVersion(piece, piece.versions.length - 1)
    setPiece(prev)
    persist(prev)
    setSelection(null)
  }

  const setTempo = delta => {
    if (!piece) return
    const tempo = Math.max(40, Math.min(200, piece.meta.tempo + delta))
    const next = { ...piece, meta: { ...piece.meta, tempo }, updatedAt: Date.now() }
    player.stop()
    setPiece(next)
    persist(next)
  }

  const togglePlay = async () => {
    if (!abc) return
    try {
      if (player.playing) player.pause()
      else await player.play(selection && !player.offset ? player.barStart(selection.from) : undefined)
    } catch (e) {
      setError(`Could not play: ${e?.message || e}`)
    }
  }

  // Keyboard: Space plays, Escape clears the selection, Cmd/Ctrl+Z undoes.
  useEffect(() => {
    const onKey = e => {
      const typing = e.target.closest?.('input, textarea, [contenteditable]')
      if (e.key === 'Escape' && selection) setSelection(null)
      if (typing) return
      if (e.key === ' ' && abc) { e.preventDefault(); togglePlay() }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    if (selection) inputRef.current?.focus()
  }, [selection?.from, selection?.to])

  // While Hermes composes, keep the newest section and the pencil in view.
  const bodyRef = useRef(null)
  useEffect(() => {
    if (phase !== 'composing' || !slither) return
    const el = bodyRef.current
    if (!el) return
    const id = requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion() ? 'auto' : 'smooth' }))
    return () => cancelAnimationFrame(id)
  }, [slither?.key])

  const position = player.position()
  const event = player.playing ? player.eventAt(position) : null
  const bar = event ? barOfEvent(event) : -1

  const placeholder = !piece
    ? 'Describe a piece of music…'
    : selection
      ? selection.from === selection.to ? `Change bar ${selection.from + 1}: “sadder”, “more playful”, “end on a long note”…` : `Change bars ${selection.from + 1}–${selection.to + 1}: “sadder”, “add a run up”, “simpler bass”…`
      : 'Change the whole piece: “slower”, “on strings”, “in A minor”, “make it longer”… or select bars first'

  return (
    <div className="st-page" ref={pageRef}>
      <header className="st-head">
        <div className="st-titles">
          <h1 className="st-title" data-empty={piece ? 'false' : 'true'}>{piece ? piece.title : 'Stave'}</h1>
          <div className="st-meta">
            {piece ? (
              <>
                <b>{keyName(piece.meta.key)}</b><span className="st-dot" />
                <span>{piece.meta.meter}</span><span className="st-dot" />
                <span>{piece.meta.meter === '6/8' ? '♩.' : '♩'} = {piece.meta.tempo}</span><span className="st-dot" />
                <span>{piece.voices.map(v => instrumentOf(v.instrument).label).join(', ')}</span>
                {piece.bars.length > 0 && (<><span className="st-dot" /><span>{piece.bars.length} bars</span></>)}
              </>
            ) : (
              <span>Describe a piece and Hermes writes it as sheet music.</span>
            )}
          </div>
        </div>
        <div className="st-tools">
          <PiecesMenu pieces={pieces} current={piece} disabled={working} onOpen={openPiece} onNew={() => openPiece(null)} onDelete={id => { setPieces(deletePiece(storage, id)); if (piece?.id === id) openPiece(null) }} />
          <button type="button" className="st-iconbtn" onClick={undo} disabled={!piece || !canUndo(piece) || working} title="Undo the last change (⌘Z)" aria-label="Undo the last change"><UndoIcon /></button>
          <ExportMenu piece={piece} player={player} abc={abc} useChatModel={useChatModel} onUseChatModel={v => { setUseChatModel(v); storage.set('useChatModel', v) }} onError={setError} />
          <div className="st-transport">
            <button type="button" className="st-play" onClick={togglePlay} disabled={!abc || working} data-loading={player.isLoading ? 'true' : 'false'} aria-label={player.playing ? 'Pause' : 'Play'} title={player.playing ? 'Pause (Space)' : 'Play (Space)'}>
              <PlayGlyph playing={player.playing} />
            </button>
            <div className="st-clock">
              <span className="st-clock-time">{fmtTime(position)} <span style={{ color: 'var(--st-ink-4)' }}>/ {fmtTime(player.duration)}</span></span>
              <span className="st-clock-bar">{piece && piece.bars.length ? `Bar ${bar >= 0 ? bar + 1 : selection ? selection.from + 1 : 1} of ${piece.bars.length}` : '—'}</span>
            </div>
            <Scrubber player={player} />
            <div className="st-tempo" aria-label="Tempo">
              <button type="button" className="st-iconbtn" onClick={() => setTempo(-8)} disabled={!piece || working} aria-label="Slower"><MinusIcon /></button>
              <span>♩ {piece ? piece.meta.tempo : '—'}</span>
              <button type="button" className="st-iconbtn" onClick={() => setTempo(8)} disabled={!piece || working} aria-label="Faster"><icons.Plus size={16} /></button>
            </div>
          </div>
        </div>
      </header>

      <main className="st-body" ref={bodyRef}>
        {piece && piece.bars.length > 0 ? (
          <Sheet
            abc={abc}
            barCount={piece.bars.length}
            marks={piece.marks}
            selection={selection}
            busy={busy}
            slither={slither}
            writing={phase === 'composing' ? writing : null}
            player={player}
            onSelect={setSelection}
            onVisual={v => player.setTune(v)}
          />
        ) : (
          <EmptyStaff
            planning={phase === 'composing'}
            piece={piece}
            writing={writing}
            draft={draft}
            setDraft={setDraft}
            onSubmit={() => runCompose(draft)}
            onPick={s => runCompose(s)}
          />
        )}
      </main>

      <footer className="st-foot">
        {error && (
          <div className="st-error" role="alert">
            <span>{error}</span>
            {lastRequest.current && <button type="button" onClick={() => { const r = lastRequest.current; setError(null); if (r.kind === 'compose') runCompose(r.text); else { setSelection(r.selection); setTimeout(() => runChange(r.text)) } }}>Try again</button>}
            <button type="button" onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}
        {piece && piece.bars.length > 0 && !working && (
          <div className="st-hint">
            <span>Click a bar to select it, drag or <kbd>⇧</kbd> click for more</span>
            <span><kbd>Space</kbd> play</span>
            <span><kbd>Esc</kbd> clear</span>
          </div>
        )}
        {(piece || working) && (
          <div className="st-ask">
            {working ? (
              <div className="st-status" aria-live="polite">
                <em>{phase === 'composing' ? 'Hermes is composing' : 'Hermes is revising'}</em>
                <span>{phase === 'composing' ? progress?.label : busy && busy.to - busy.from < (piece?.bars.length || 0) - 1 ? (busy.from === busy.to ? `bar ${busy.from + 1}` : `bars ${busy.from + 1}–${busy.to + 1}`) : 'the whole piece'}</span>
                {phase === 'composing' && progress && (
                  <span className="st-steps">
                    {Array.from({ length: progress.total }, (_, i) => <i key={i} data-done={i < progress.step ? 'true' : 'false'} data-now={i === progress.step ? 'true' : 'false'} />)}
                  </span>
                )}
                {phase === 'composing' && <button type="button" className="st-iconbtn" onClick={() => { cancelRef.current = true }}>Stop after this section</button>}
              </div>
            ) : (
              <>
                {selection && (
                  <span className="st-scope">
                    {selection.from === selection.to ? `Bar ${selection.from + 1}` : `Bars ${selection.from + 1}–${selection.to + 1}`}
                    <button type="button" onClick={() => setSelection(null)} aria-label="Clear selection"><icons.XIcon size={12} /></button>
                  </span>
                )}
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } }}
                  placeholder={placeholder}
                  aria-label={placeholder}
                />
                <button type="button" className="st-send" onClick={submit} disabled={!draft.trim()} aria-label="Send to Hermes"><icons.ArrowUp size={17} /></button>
              </>
            )}
          </div>
        )}
      </footer>
    </div>
  )
}

function canUndo(piece) {
  return piece.versions.length > 0 && String(piece.versions[piece.versions.length - 1].label || '').startsWith('Before')
}

function friendly(e) {
  const m = String(e?.message || e || 'Something went wrong')
  if (/no provider|not configured/i.test(m)) return 'Hermes has no model configured for this. Pick one in Settings, then try again.'
  if (/timed? ?out|timeout/i.test(m)) return 'Hermes took too long on that step. Try again, or ask for a shorter piece.'
  if (/JSON/.test(m)) return 'Hermes answered in a shape Stave could not read. Try again.'
  return m.length > 160 ? `${m.slice(0, 160)}…` : m
}

function Scrubber({ player }) {
  const ref = useRef(null)
  const frac = player.duration ? Math.min(1, player.position() / player.duration) : 0
  const seekAt = e => {
    const r = ref.current.getBoundingClientRect()
    player.seek(((e.clientX - r.left) / r.width) * player.duration)
  }
  return (
    <div
      ref={ref}
      className="st-scrub"
      role="slider"
      tabIndex={0}
      aria-label="Position"
      aria-valuemin={0}
      aria-valuemax={Math.round(player.duration)}
      aria-valuenow={Math.round(player.position())}
      onPointerDown={e => { if (!player.duration) return; e.currentTarget.setPointerCapture(e.pointerId); seekAt(e) }}
      onPointerMove={e => { if (e.buttons & 1 && player.duration) seekAt(e) }}
      onKeyDown={e => {
        if (e.key === 'ArrowRight') player.seek(player.position() + 2)
        if (e.key === 'ArrowLeft') player.seek(player.position() - 2)
      }}
    >
      <div className="st-scrub-fill" style={{ width: `${frac * 100}%` }} />
      <div className="st-scrub-knob" style={{ left: `${frac * 100}%` }} />
    </div>
  )
}

function PiecesMenu({ pieces, current, disabled, onOpen, onNew, onDelete }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="st-iconbtn" disabled={disabled} aria-label="Your pieces">
          <icons.NotebookTabs size={16} /> Pieces
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="st-menu">
        <div className="st-menu-head">
          <span>{pieces.length ? `${pieces.length} piece${pieces.length === 1 ? '' : 's'}` : 'No pieces yet'}</span>
          <button type="button" className="st-iconbtn" onClick={() => { onNew(); setOpen(false) }}><icons.Plus size={14} /> New piece</button>
        </div>
        {pieces.length === 0 && <div className="st-menu-empty">Your pieces will collect here.</div>}
        {pieces.map(p => (
          <div key={p.id} className="st-piece" data-current={current?.id === p.id ? 'true' : 'false'} role="button" tabIndex={0} onClick={() => { onOpen(p); setOpen(false) }} onKeyDown={e => { if (e.key === 'Enter') { onOpen(p); setOpen(false) } }}>
            <span className="st-piece-title">{p.title}</span>
            <span className="st-piece-sub">{keyName(p.meta.key)} · {p.bars.length} bars · “{p.prompt}”</span>
            <button type="button" className="st-iconbtn st-piece-del" aria-label={`Delete ${p.title}`} onClick={e => { e.stopPropagation(); if (window.confirm(`Delete “${p.title}”?`)) onDelete(p.id) }}><icons.Trash2 size={14} /></button>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  )
}

function ExportMenu({ piece, player, abc, useChatModel, onUseChatModel, onError }) {
  const [open, setOpen] = useState(false)
  const ready = Boolean(piece && abc)
  const run = fn => async () => {
    setOpen(false)
    try { await fn() } catch (e) { onError(`Export failed: ${e?.message || e}`) }
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="st-iconbtn" aria-label="Export and settings"><icons.Download size={16} /></button>
      </PopoverTrigger>
      <PopoverContent align="end" className="st-menu" style={{ width: 280 }}>
        <button type="button" className="st-menu-item" disabled={!ready} onClick={run(async () => {
          const visual = player.visual || abcjs.renderAbc('*', abc)[0]
          download(fileName(piece, 'mid'), new Blob([midiBytes(visual)], { type: 'audio/midi' }))
        })}><icons.Download size={16} /> MIDI file<small>for any music app</small></button>
        <button type="button" className="st-menu-item" disabled={!ready} onClick={run(async () => {
          const url = await player.wavUrl()
          if (!url) throw new Error('audio is not ready')
          const blob = await (await fetch(url)).blob()
          download(fileName(piece, 'wav'), blob)
        })}><icons.Volume2 size={16} /> Audio (WAV)<small>what you hear</small></button>
        <button type="button" className="st-menu-item" disabled={!ready} onClick={run(async () => {
          download(fileName(piece, 'abc'), new Blob([abc], { type: 'text/vnd.abc' }))
        })}><icons.FileText size={16} /> ABC notation<small>plain text</small></button>
        <button type="button" className="st-menu-item" disabled={!ready} onClick={run(async () => { await writeClipboardText(abc) })}><icons.Copy size={16} /> Copy ABC</button>
        <div className="st-menu-head" style={{ paddingTop: 12 }}>Hermes writes with</div>
        <button type="button" className="st-menu-item" aria-pressed={useChatModel} onClick={() => onUseChatModel(true)}>
          {useChatModel ? <icons.Check size={16} /> : <span style={{ width: 16 }} />} Your chat model<small>best music</small>
        </button>
        <button type="button" className="st-menu-item" aria-pressed={!useChatModel} onClick={() => onUseChatModel(false)}>
          {!useChatModel ? <icons.Check size={16} /> : <span style={{ width: 16 }} />} The fast helper model<small>cheaper</small>
        </button>
      </PopoverContent>
    </Popover>
  )
}

// A faint motif that swims onto the empty staff: the page shows what it does before anyone types.
const GHOST = 'X:1\nM:4/4\nL:1/8\nK:C\n"C"E2 G2 c2 G2 | "F"A2 c2 "G"B2 d2 | "Am"c2 e2 d2 c2 | "G"B4 z4 |]\n'

function EmptyStaff({ planning, piece, writing, draft, setDraft, onSubmit, onPick }) {
  const staffRef = useRef(null)
  useEffect(() => {
    const el = staffRef.current
    if (!el) return
    const draw = () => {
      abcjs.renderAbc(el, GHOST, { add_classes: true, staffwidth: Math.max(480, el.clientWidth - 30), paddingtop: 0, paddingbottom: 0, paddingleft: 0, paddingright: 0, format: { gchordfont: 'Georgia 14 bold' } })
      if (reduceMotion()) return
      const notes = [...el.querySelectorAll('.abcjs-note, .abcjs-rest, .abcjs-beam-elem, .abcjs-chord')]
      notes.forEach((n, k) => {
        n.style.setProperty('--st-delay', `${700 + k * 70}ms`)
        n.style.setProperty('--st-dy', `${Math.sin(k * 0.85) * 10}px`)
        n.classList.add('st-slither')
      })
    }
    draw()
    const ro = new ResizeObserver(() => draw())
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const plan = piece?.sections || []
  return (
    <div className="st-empty" data-planning={planning ? 'true' : 'false'}>
      <h2>{planning ? (piece ? piece.title : 'Listening…') : 'What should it sound like?'}</h2>
      <div className="st-empty-staff">
        <div ref={staffRef} className="st-ghost" aria-hidden="true" />
        {planning && (
          <div className="st-plan" aria-live="polite">
            {plan.length ? plan.map((s, i) => (
              <span key={`${s.id}-${i}`} className="st-note" style={{ position: 'static', ['--st-delay']: `${i * 180}ms` }}>
                {s.id} · {s.name || 'section'} <small>{s.bars} bars</small>
              </span>
            )) : <span className="st-writing" style={{ position: 'static' }}><span>{writing?.text || 'planning…'}</span><i /></span>}
          </div>
        )}
      </div>
      {!planning && (
        <>
          <div className="st-ask" data-big="true">
            <input
              autoFocus
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); onSubmit() } }}
              placeholder="a happy little song for a sunny morning…"
              aria-label="Describe a piece of music"
            />
            <button type="button" className="st-send" onClick={onSubmit} disabled={!draft.trim()} aria-label="Write it"><icons.ArrowUp size={17} /></button>
          </div>
          <div className="st-chips">
            {SUGGESTIONS.map(s => <button key={s} type="button" className="st-chip" onClick={() => onPick(s)}>{s}</button>)}
          </div>
        </>
      )}
    </div>
  )
}

function reduceMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}
