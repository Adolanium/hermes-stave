// The piece model and its ABC text. A piece is plain data (what Hermes wrote, bar by bar, per voice);
// ABC is derived from it on every render, so an edit to bars 5–6 never touches bar 7.

export const METERS = ['4/4', '3/4', '6/8', '2/4']

/** General MIDI programs Hermes may choose from, by the name it writes. */
export const INSTRUMENTS = {
  piano: { program: 0, label: 'Piano' },
  'music box': { program: 10, label: 'Music box' },
  celesta: { program: 8, label: 'Celesta' },
  vibraphone: { program: 11, label: 'Vibraphone' },
  marimba: { program: 12, label: 'Marimba' },
  'nylon guitar': { program: 24, label: 'Guitar' },
  'acoustic bass': { program: 32, label: 'Double bass' },
  violin: { program: 40, label: 'Violin' },
  viola: { program: 41, label: 'Viola' },
  cello: { program: 42, label: 'Cello' },
  strings: { program: 48, label: 'Strings' },
  harp: { program: 46, label: 'Harp' },
  choir: { program: 52, label: 'Choir' },
  trumpet: { program: 56, label: 'Trumpet' },
  'french horn': { program: 60, label: 'Horn' },
  clarinet: { program: 71, label: 'Clarinet' },
  oboe: { program: 68, label: 'Oboe' },
  flute: { program: 73, label: 'Flute' },
  'pan flute': { program: 75, label: 'Pan flute' }
}

const KEY_RE = /^[A-G][#b]?m?$/

/** Length of one bar in whole notes ("6/8" → 0.75). */
export function barLength(meter) {
  const [n, d] = String(meter).split('/').map(Number)
  return n / d
}

/** Eighth notes per bar, the unit Hermes counts in (L:1/8). */
export function eighthsPerBar(meter) {
  return Math.round(barLength(meter) * 8)
}

export function instrumentOf(name) {
  return INSTRUMENTS[String(name || '').toLowerCase()] || INSTRUMENTS.piano
}

/** ABC key field from "F#m" / "Bb" style names. */
export function abcKey(key) {
  const k = KEY_RE.test(String(key || '')) ? String(key) : 'C'
  return k.replace('#', '#').replace(/^([A-G])b/, '$1b')
}

function tempoField(meter, tempo) {
  const bpm = Math.max(40, Math.min(200, Math.round(Number(tempo) || 100)))
  return meter === '6/8' ? `3/8=${bpm}` : `1/4=${bpm}`
}

function cleanTitle(title) {
  return String(title || 'Untitled').replace(/[\r\n%]/g, ' ').trim().slice(0, 60) || 'Untitled'
}

/** Bars of one section, as indexes into piece.bars. */
export function sectionRanges(piece) {
  const out = []
  piece.bars.forEach((bar, i) => {
    const last = out[out.length - 1]
    if (last && last.id === bar.section) last.to = i
    else out.push({ id: bar.section, from: i, to: i })
  })
  return out.map(r => ({ ...r, section: piece.sections.find(s => s.id === r.id) }))
}

/**
 * The full ABC text for a piece. Each voice gets its own staff and General MIDI program; four bars
 * per line keeps the engraving even; section names print as part labels. `tempo` overrides the
 * piece's tempo for playback.
 */
export function toAbc(piece, { tempo } = {}) {
  const meta = piece.meta
  const lines = [
    'X:1',
    `T:${cleanTitle(piece.title)}`,
    `M:${meta.meter}`,
    'L:1/8',
    `Q:${tempoField(meta.meter, tempo ?? meta.tempo)}`,
    `K:${abcKey(meta.key)}`
  ]
  const ids = piece.voices.map(v => v.id)
  lines.push(`%%score ${ids.length > 1 ? `[${ids.join(' ')}]` : ids[0]}`)
  lines.push('%%MIDI chordvol 46', '%%MIDI bassvol 0')
  for (const v of piece.voices) {
    lines.push(`V:${v.id} clef=${v.clef === 'bass' ? 'bass' : 'treble'} name="${instrumentOf(v.instrument).label}" snm=""`)
  }
  const perLine = meta.meter === '4/4' ? 4 : 6
  for (let start = 0; start < piece.bars.length; start += perLine) {
    const chunk = piece.bars.slice(start, start + perLine)
    piece.voices.forEach((v, vi) => {
      let text = `[V:${v.id}] `
      if (start === 0) text += `%%MIDI program ${instrumentOf(v.instrument).program}\n[V:${v.id}] `
      chunk.forEach((bar, j) => {
        const index = start + j
        text += `${(bar.notes[v.id] || 'z8').trim()} ${index === piece.bars.length - 1 ? '|]' : '|'} `
      })
      lines.push(text.trimEnd())
    })
  }
  return `${lines.join('\n')}\n`
}

/** A new, empty piece from Hermes's plan. */
export function pieceFromPlan(plan, prompt) {
  const meter = METERS.includes(plan.meter) ? plan.meter : '4/4'
  const voices = (Array.isArray(plan.voices) ? plan.voices : []).slice(0, 3).map((v, i) => ({
    id: `V${i + 1}`,
    name: String(v.name || (i === 0 ? 'Melody' : 'Part')).slice(0, 24),
    instrument: INSTRUMENTS[String(v.instrument || '').toLowerCase()] ? String(v.instrument).toLowerCase() : 'piano',
    clef: v.clef === 'bass' ? 'bass' : 'treble'
  }))
  if (voices.length === 0) voices.push({ id: 'V1', name: 'Melody', instrument: 'piano', clef: 'treble' })
  const sections = (Array.isArray(plan.sections) ? plan.sections : []).slice(0, 6).map((s, i) => ({
    id: String(s.id || String.fromCharCode(65 + i)).replace(/[^A-Za-z0-9']/g, '').slice(0, 3) || String.fromCharCode(65 + i),
    name: String(s.name || '').slice(0, 28),
    bars: Math.max(2, Math.min(12, Number(s.bars) || 4)),
    chords: Array.isArray(s.chords) ? s.chords.map(String) : [],
    idea: String(s.idea || '').slice(0, 200)
  }))
  return {
    id: newId(),
    title: cleanTitle(plan.title),
    prompt: String(prompt || ''),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    meta: {
      key: KEY_RE.test(String(plan.key || '')) ? String(plan.key) : 'C',
      meter,
      tempo: Math.max(40, Math.min(200, Math.round(Number(plan.tempo) || 100))),
      mood: String(plan.mood || '').slice(0, 80)
    },
    voices,
    sections,
    bars: [],
    marks: [],
    versions: []
  }
}

export function newId() {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** Replace bars [from, to] (inclusive, 0-based) with `bars`, keeping their sections. */
export function spliceBars(piece, from, to, bars) {
  const section = piece.bars[from]?.section ?? piece.sections[0]?.id
  const next = bars.map(b => ({ section, notes: { ...b.notes } }))
  return { ...piece, bars: [...piece.bars.slice(0, from), ...next, ...piece.bars.slice(to + 1)], updatedAt: Date.now() }
}

/** Keep the last `limit` snapshots so any change can be undone. */
export function withVersion(piece, label, limit = 30) {
  const snap = { at: Date.now(), label, title: piece.title, meta: piece.meta, voices: piece.voices, sections: piece.sections, bars: piece.bars, marks: piece.marks }
  return { ...piece, versions: [...piece.versions, snap].slice(-limit) }
}

export function restoreVersion(piece, index) {
  const v = piece.versions[index]
  if (!v) return piece
  return { ...piece, title: v.title, meta: v.meta, voices: v.voices, sections: v.sections, bars: v.bars, marks: v.marks, versions: piece.versions.slice(0, index), updatedAt: Date.now() }
}

/** ABC text of bars [from, to] for every voice, numbered, for prompts. */
export function barsText(piece, from = 0, to = piece.bars.length - 1) {
  const rows = []
  for (let i = from; i <= to; i++) {
    const bar = piece.bars[i]
    if (!bar) continue
    rows.push(`${i + 1}: ${piece.voices.map(v => `${v.id}=${JSON.stringify(bar.notes[v.id] || '')}`).join(' ')}`)
  }
  return rows.join('\n')
}
