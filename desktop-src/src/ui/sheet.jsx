// The engraved score and everything drawn over it: bar hit areas for selection, Hermes's pencil marks
// (rough-notation), the notes that slither in as they are written, and the serpent that runs along the
// melody while it plays.
import abcjs from 'abcjs'
import { annotate } from 'rough-notation'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { barOfEvent } from './player.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const SERPENT_LENGTH = 150

function reducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** Smooth path through points (quadratic curves through midpoints). */
function smoothPath(points) {
  if (points.length === 0) return ''
  if (points.length === 1) return `M${points[0].x} ${points[0].y}`
  let d = `M${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]
    const n = points[i + 1]
    d += ` Q${p.x} ${p.y} ${(p.x + n.x) / 2} ${(p.y + n.y) / 2}`
  }
  const last = points[points.length - 1]
  d += ` L${last.x} ${last.y}`
  return d
}

/** Melody notehead positions per system line, in SVG units, with their bar and source position. */
function melodyPoints(visual) {
  const lines = []
  visual.lines.forEach((line, li) => {
    const voice = line.staff?.[0]?.voices?.[0]
    if (!voice) return
    const pts = []
    for (const el of voice) {
      if (el.el_type !== 'note' || el.rest || !el.abselem?.notePositions?.length) continue
      const top = el.abselem.notePositions.reduce((a, b) => (b.y < a.y ? b : a))
      pts.push({ x: top.x + 4, y: top.y, startChar: el.startChar })
    }
    if (pts.length) lines.push({ line: li, points: pts })
  })
  return lines
}

function segmentLengths(svg, lines) {
  // Cumulative path length at every note, measured on real path elements.
  const probe = document.createElementNS(SVG_NS, 'path')
  svg.appendChild(probe)
  for (const l of lines) {
    l.lengths = l.points.map((_, i) => {
      if (i === 0) return 0
      probe.setAttribute('d', smoothPath(l.points.slice(0, i + 1)))
      return probe.getTotalLength()
    })
    probe.setAttribute('d', smoothPath(l.points))
    l.total = probe.getTotalLength()
  }
  probe.remove()
}

/** Boxes of every bar (overall index), relative to `host`, in CSS pixels. */
function barBoxes(svg, host, count) {
  const hostRect = host.getBoundingClientRect()
  const boxes = []
  const systems = new Map()
  svg.querySelectorAll('.abcjs-staff').forEach(el => {
    const m = /abcjs-l(\d+)/.exec(el.getAttribute('class') || '')
    if (!m) return
    const r = el.getBoundingClientRect()
    const s = systems.get(m[1]) || { top: Infinity, bottom: -Infinity, left: Infinity, right: -Infinity }
    s.top = Math.min(s.top, r.top)
    s.bottom = Math.max(s.bottom, r.bottom)
    s.left = Math.min(s.left, r.left)
    s.right = Math.max(s.right, r.right)
    systems.set(m[1], s)
  })
  for (let i = 0; i < count; i++) {
    const els = svg.querySelectorAll(`.abcjs-mm${i}`)
    if (!els.length) continue
    let line = null
    let inkTop = Infinity
    let left = Infinity
    let right = -Infinity
    let barRight = -Infinity
    els.forEach(el => {
      const cls = el.getAttribute('class') || ''
      const lm = /abcjs-l(\d+)/.exec(cls)
      if (lm && line === null) line = lm[1]
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) return
      if (cls.includes('abcjs-bar')) barRight = Math.max(barRight, r.right)
      else {
        left = Math.min(left, r.left)
        right = Math.max(right, r.right)
        inkTop = Math.min(inkTop, r.top)
      }
    })
    const sys = systems.get(line)
    if (!sys || !Number.isFinite(left)) continue
    boxes.push({ index: i, line: Number(line), left, right: Number.isFinite(barRight) ? barRight : right + 6, top: sys.top, bottom: sys.bottom, inkTop: Math.min(inkTop, sys.top) })
  }
  // Each bar starts where the previous bar on the same line ended.
  boxes.forEach((b, k) => {
    const prev = boxes[k - 1]
    if (prev && prev.line === b.line) b.left = prev.right
    else b.left = b.left - 10
  })
  return boxes.map(b => ({
    index: b.index,
    line: b.line,
    x: b.left - hostRect.left,
    y: b.top - hostRect.top - 14,
    w: Math.max(18, b.right - b.left),
    h: b.bottom - b.top + 28,
    ink: b.inkTop - hostRect.top
  }))
}

/** Split a bar range into one box per system line. */
function rangeBoxes(boxes, from, to) {
  const out = []
  for (const b of boxes) {
    if (b.index < from || b.index > to) continue
    const last = out[out.length - 1]
    if (last && last.line === b.line) {
      last.w = b.x + b.w - last.x
      last.y = Math.min(last.y, b.y)
      last.h = Math.max(last.h, b.h)
      last.ink = Math.min(last.ink, b.ink)
    } else out.push({ ...b })
  }
  return out
}

const RENDER_OPTIONS = width => ({
  add_classes: true,
  staffwidth: Math.max(520, width - 40),
  paddingtop: 52,
  paddingbottom: 10,
  paddingleft: 4,
  paddingright: 24,
  wrap: undefined
})

// Engraving layout lives in ABC directives: room between systems for Hermes's margin notes.
const LAYOUT = ['%%printtempo false', '%%staffsep 128', '%%sysstaffsep 50', '%%gchordfont "Stave Bodoni" 15', '%%voicefont Georgia 11'].join('\n')

function withLayout(abc) {
  // The page shows the title in its own header; abcjs would otherwise reserve a band for it.
  return abc.replace(/^X:1\n/, `X:1\n${LAYOUT}\n`).replace(/^T:.*\n/m, '')
}

/**
 * Props: abc, barCount, marks, selection {from,to}|null, busy {from,to}|null, slither {from,to,key}|null,
 * writing {text}|null, player, onSelect(range|null), onVisual(visual).
 */
export function Sheet({ abc, barCount, marks, selection, busy, slither, writing, player, onSelect, onVisual }) {
  const hostRef = useRef(null)
  const scoreRef = useRef(null)
  const overlayRef = useRef(null)
  const geom = useRef({ boxes: [], melody: [], svg: null })
  const [width, setWidth] = useState(0)
  const [boxes, setBoxes] = useState([])
  const [renderKey, setRenderKey] = useState(0)
  const dragRef = useRef(null)

  // Width drives the engraving's staff width; re-engrave when it changes.
  useLayoutEffect(() => {
    const el = hostRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const w = Math.round(el.clientWidth)
      setWidth(prev => (Math.abs(prev - w) > 8 ? w : prev))
    })
    ro.observe(el)
    setWidth(Math.round(el.clientWidth))
    return () => ro.disconnect()
  }, [])

  // Engrave.
  useLayoutEffect(() => {
    const target = scoreRef.current
    if (!target || !width || !abc) return
    const visual = abcjs.renderAbc(target, withLayout(abc), RENDER_OPTIONS(width))[0]
    const svg = target.querySelector('svg')
    if (!svg) return
    const layer = document.createElementNS(SVG_NS, 'g')
    layer.setAttribute('class', 'st-serpent-layer')
    svg.appendChild(layer)
    const melody = melodyPoints(visual)
    segmentLengths(svg, melody)
    for (const l of melody) {
      const d = smoothPath(l.points)
      for (const kind of ['trace', 'body']) {
        const p = document.createElementNS(SVG_NS, 'path')
        p.setAttribute('d', d)
        p.setAttribute('class', `st-serpent st-serpent-${kind}`)
        p.dataset.line = String(l.line)
        if (kind === 'body') p.style.strokeDasharray = `0 ${l.total + SERPENT_LENGTH}`
        layer.appendChild(p)
        l[kind] = p
      }
    }
    const head = document.createElementNS(SVG_NS, 'circle')
    head.setAttribute('r', '4.2')
    head.setAttribute('class', 'st-serpent-head')
    layer.appendChild(head)
    // The melody's own SVG elements, so playback can light it brighter than the accompaniment.
    const melodyEls = new Set()
    for (const line of visual.lines) {
      for (const el of line.staff?.[0]?.voices?.[0] || []) for (const node of el.abselem?.elemset || []) melodyEls.add(node)
    }
    geom.current = { svg, melody, head, layer, visual, melodyEls }
    setBoxes(barBoxes(svg, hostRef.current, barCount))
    setRenderKey(k => k + 1)
    onVisual?.(visual)
  }, [abc, width, barCount])

  // Notes swim in: every element of the new bars, in reading order, staggered along a wave.
  useLayoutEffect(() => {
    const { svg, melody } = geom.current
    if (!svg || !slither || reducedMotion()) return
    const els = []
    for (let i = slither.from; i <= slither.to; i++) {
      svg.querySelectorAll(`.abcjs-mm${i}`).forEach(el => {
        if ((el.getAttribute('class') || '').includes('abcjs-bar')) return
        const r = el.getBoundingClientRect()
        els.push({ el, x: r.left, y: r.top, bar: i })
      })
    }
    els.sort((a, b) => a.bar - b.bar || a.x - b.x)
    // One wave, never longer than ~1.6 s however many notes arrive.
    const step = Math.min(22, 1600 / Math.max(1, els.length))
    els.forEach(({ el }, k) => {
      el.classList.remove('st-slither')
      void el.getBoundingClientRect()
      el.style.setProperty('--st-delay', `${Math.round(k * step)}ms`)
      el.style.setProperty('--st-dy', `${Math.sin(k * 0.85) * 9}px`)
      el.classList.add('st-slither')
    })
    // The pencil draws the melody of the new bars as they arrive, then lifts.
    const draws = []
    const span = els.length * step + 620
    for (const l of melody) {
      const idx = l.points.map((p, i) => i).filter(i => {
        const bar = barAtStartChar(geom.current.visual, l.points[i].startChar)
        return bar >= slither.from && bar <= slither.to
      })
      if (idx.length < 2) continue
      const a = l.lengths[idx[0]]
      const b = l.lengths[idx[idx.length - 1]]
      const p = document.createElementNS(SVG_NS, 'path')
      p.setAttribute('d', l.trace.getAttribute('d'))
      p.setAttribute('class', 'st-serpent st-serpent-draw')
      p.style.strokeDasharray = `0 ${a} ${b - a} ${l.total}`
      geom.current.layer.appendChild(p)
      const anim = p.animate(
        [
          { strokeDasharray: `0 ${a} 0 ${l.total}`, opacity: 0.9 },
          { strokeDasharray: `0 ${a} ${b - a} ${l.total}`, opacity: 0.9, offset: 0.75 },
          { strokeDasharray: `0 ${a} ${b - a} ${l.total}`, opacity: 0 }
        ],
        { duration: span + 500, easing: 'cubic-bezier(.3,.6,.3,1)', fill: 'forwards' }
      )
      anim.onfinish = () => p.remove()
      draws.push(p)
    }
    return () => draws.forEach(p => p.remove())
  }, [slither?.key, renderKey])

  // Pencil marks: rough-notation annotations over overlay boxes, plus the marginal note.
  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay) return
    overlay.querySelectorAll('.st-mark, .st-note').forEach(n => n.remove())
    const annotations = []
    const animate = !reducedMotion()
    const color = getComputedStyle(overlay).getPropertyValue('--st-pencil').trim() || 'currentColor'
    const used = new Map()
    ;(marks || []).forEach((m, k) => {
      const parts = rangeBoxes(boxes, m.from, m.to)
      if (!parts.length) return
      const fresh = Date.now() - (m.at || 0) < 4000
      parts.forEach((b, j) => {
        const div = document.createElement('div')
        div.className = 'st-mark'
        const pad = m.kind === 'section' ? 0 : 6
        const top = m.kind === 'section' ? Math.min(b.y + 6, b.ink - 8) : b.y + pad
        Object.assign(div.style, { left: `${b.x + pad}px`, top: `${top}px`, width: `${b.w - pad * 2}px`, height: `${b.y + b.h - pad - top}px` })
        overlay.appendChild(div)
        if (m.kind === 'piece') return writeNote(m, b, j, k, div)
        const type = m.kind === 'section' ? 'bracket' : m.kind === 'fixed' ? 'underline' : 'box'
        const a = annotate(div, {
          type,
          brackets: ['top'],
          color,
          strokeWidth: m.kind === 'section' ? 1.3 : 1.6,
          padding: m.kind === 'section' ? 2 : 4,
          iterations: m.kind === 'section' ? 1 : 2,
          animate: animate && fresh,
          animationDuration: 700
        })
        a.show()
        annotations.push(a)
        writeNote(m, b, j, k)
      })
      function writeNote(m, b, j, k) {
        if (j === 0 && m.text) {
          const note = document.createElement('div')
          note.className = 'st-note'
          note.dataset.kind = m.kind
          note.style.setProperty('--st-delay', fresh && animate ? `${400 + k * 60}ms` : '0ms')
          note.textContent = m.text
          overlay.appendChild(note)
          // Keep the note on the page: a note near the right edge ends where its bars end.
          const room = overlay.clientWidth - 8
          const width = note.getBoundingClientRect().width
          let left = b.x + 4
          if (left + width > room) left = Math.max(0, Math.min(b.x + b.w, room) - width)
          // Notes on one system never overlap: a note that would touch another moves up a row.
          const placed = used.get(b.line) || []
          let top = Math.min(b.y, b.ink) - 26
          while (placed.some(r => left < r.right + 12 && left + width + 12 > r.left && Math.abs(r.top - top) < 18)) top -= 19
          placed.push({ left, right: left + width, top })
          used.set(b.line, placed)
          note.style.left = `${left}px`
          note.style.top = `${top}px`
        }
      }
    })
    return () => annotations.forEach(a => a.remove())
  }, [boxes, marks])

  // The serpent and the lit notes follow the audio clock while playing.
  useEffect(() => {
    if (!player) return
    let raf = 0
    let lit = []
    let followed = -1
    const follow = line => {
      const scroller = hostRef.current?.closest('.st-body')
      const staff = geom.current.svg?.querySelector(`.abcjs-staff.abcjs-l${line}`)
      if (!scroller || !staff) return
      const sr = scroller.getBoundingClientRect()
      const r = staff.getBoundingClientRect()
      const wrapper = geom.current.svg.querySelectorAll(`.abcjs-staff.abcjs-l${line}`)
      const bottom = Math.max(...[...wrapper].map(w => w.getBoundingClientRect().bottom))
      if (r.top - 90 < sr.top || bottom + 40 > sr.bottom) {
        scroller.scrollBy({ top: r.top - sr.top - 110, behavior: reducedMotion() ? 'auto' : 'smooth' })
      }
    }
    const clear = () => {
      followed = -1
      lit.forEach(el => el.classList.remove('st-lit', 'st-lit-soft'))
      lit = []
      const g = geom.current
      g.melody?.forEach(l => { l.body.dataset.on = 'false' })
      if (g.head) g.head.dataset.on = 'false'
      scoreRef.current && (scoreRef.current.dataset.playing = 'false')
    }
    const frame = () => {
      raf = requestAnimationFrame(frame)
      if (!player.playing) return clear()
      const g = geom.current
      if (!g.svg) return
      scoreRef.current.dataset.playing = 'true'
      const t = player.position()
      const ev = player.eventAt(t)
      const els = ev ? ev.elements.flat().filter(Boolean) : []
      if (els[0] !== lit[0]) {
        lit.forEach(el => el.classList.remove('st-lit', 'st-lit-soft'))
        els.forEach(el => el.classList.add(g.melodyEls?.has(el) ? 'st-lit' : 'st-lit-soft'))
        lit = els
      }
      // Serpent: interpolate between melody notes by time.
      const pos = serpentPosition(g, player, t)
      if (pos && pos.line !== followed) {
        followed = pos.line
        follow(pos.line)
      }
      g.melody.forEach(l => {
        const on = pos && pos.line === l.line
        l.body.dataset.on = on ? 'true' : 'false'
        if (on) {
          const head = pos.length
          const tail = Math.max(0, head - SERPENT_LENGTH)
          l.body.style.strokeDasharray = `0 ${tail} ${head - tail} ${l.total + SERPENT_LENGTH}`
          const pt = l.body.getPointAtLength(head)
          g.head.setAttribute('cx', pt.x)
          g.head.setAttribute('cy', pt.y)
          g.head.dataset.on = 'true'
        }
      })
      if (!pos && g.head) g.head.dataset.on = 'false'
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); clear() }
  }, [player, renderKey])

  // Selection by click, shift-click and drag across bars.
  const pick = (index, extend) => {
    if (extend && selection) {
      onSelect({ from: Math.min(selection.from, index), to: Math.max(selection.to, index) })
    } else if (selection && selection.from === index && selection.to === index) {
      onSelect(null)
    } else onSelect({ from: index, to: index })
  }

  return (
    <div className="st-score-wrap" ref={hostRef}>
      <div className="st-score" ref={scoreRef} />
      <div className="st-overlay" ref={overlayRef}>
        {boxes.map(b => {
          const selected = selection && b.index >= selection.from && b.index <= selection.to
          const isBusy = busy && b.index >= busy.from && b.index <= busy.to
          return (
            <button
              key={`${renderKey}-${b.index}`}
              type="button"
              className="st-bar"
              aria-label={`Bar ${b.index + 1}`}
              aria-pressed={Boolean(selected)}
              data-selected={selected ? 'true' : 'false'}
              data-busy={isBusy ? 'true' : 'false'}
              style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
              onPointerDown={e => {
                if (e.button !== 0) return
                dragRef.current = { anchor: e.shiftKey && selection ? selection.from : b.index, moved: false }
              }}
              onPointerEnter={e => {
                const d = dragRef.current
                if (!d || !(e.buttons & 1) || d.anchor === b.index) return
                d.moved = true
                onSelect({ from: Math.min(d.anchor, b.index), to: Math.max(d.anchor, b.index) })
              }}
              onClick={e => {
                const d = dragRef.current
                dragRef.current = null
                if (d?.moved) return
                pick(b.index, e.shiftKey)
              }}
            />
          )
        })}
        {writing && <WritingMark boxes={boxes} text={writing.text} />}
      </div>
    </div>
  )
}

function WritingMark({ boxes, text }) {
  // Where the next system will start: under the last one, at the left margin.
  const last = boxes[boxes.length - 1]
  const lineStart = last ? boxes.find(b => b.line === last.line) : null
  const style = last ? { left: lineStart.x + 8, top: last.y + last.h + 34 } : { left: 8, top: 8 }
  return (
    <div className="st-writing" style={style} aria-live="polite">
      <span>{text}</span>
      <i />
    </div>
  )
}

function barAtStartChar(visual, startChar) {
  for (const line of visual.lines) {
    const voice = line.staff?.[0]?.voices?.[0]
    if (!voice) continue
    for (const el of voice) {
      if (el.startChar === startChar) {
        const cls = el.abselem?.elemset?.[0]?.getAttribute?.('class') || ''
        const m = /abcjs-mm(\d+)/.exec(cls)
        return m ? Number(m[1]) : -1
      }
    }
  }
  return -1
}

/** Where along the melody path the music is at `t` seconds: { line, length }. */
function serpentPosition(g, player, t) {
  if (!g.timeline) g.timeline = buildTimeline(g, player)
  const tl = g.timeline
  if (!tl.length) return null
  const ms = t * 1000
  let i = 0
  while (i < tl.length - 1 && tl[i + 1].ms <= ms) i++
  const a = tl[i]
  const b = tl[i + 1]
  if (!b || b.line !== a.line) return { line: a.line, length: a.length }
  const f = Math.max(0, Math.min(1, (ms - a.ms) / Math.max(1, b.ms - a.ms)))
  return { line: a.line, length: a.length + (b.length - a.length) * f }
}

/** Melody notes as { ms, line, length }, matched to timing events by source position. */
function buildTimeline(g, player) {
  const byChar = new Map()
  for (const t of player.timings) {
    for (const c of t.startCharArray || []) if (!byChar.has(c)) byChar.set(c, t.milliseconds)
  }
  const out = []
  for (const l of g.melody || []) {
    l.points.forEach((p, i) => {
      const ms = byChar.get(p.startChar)
      if (ms !== undefined) out.push({ ms, line: l.line, length: l.lengths[i] })
    })
  }
  return out.sort((a, b) => a.ms - b.ms)
}

export { barOfEvent }
