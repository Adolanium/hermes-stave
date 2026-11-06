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
  'nylon guitar': { program: 24, label: 'Classical guitar', tab: 'guitar' },
  'steel guitar': { program: 25, label: 'Acoustic guitar', tab: 'guitar' },
  'electric guitar': { program: 27, label: 'Electric guitar', tab: 'guitar' },
  'bass guitar': { program: 33, label: 'Bass guitar', tab: 'bass' },
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

/**
 * Fretted instruments get a TAB staff under their notes. Like printed guitar music, their parts are
 * written an octave above how they sound (guitar on a treble staff, bass guitar on a bass staff),
 * so the tunings below are written pitches and playback drops these parts an octave.
 */
export const TAB_TUNINGS = {
  guitar: ['E,', 'A,', 'D', 'G', 'B', 'e'],
  bass: ['E,,', 'A,,', 'D,', 'G,']
}

/** Written range of fretted parts, in abcjs diatonic steps (C = 0): E, to e' and E,, to G. */
export const FRETTED_RANGE = { guitar: [-5, 16], bass: [-12, 4] }

/**
 * Move notes outside a fretted part's range by whole octaves until they fit, as a player would:
 * a D chord written from D, starts on D. Chord symbols and decorations are left alone.
 */
export function foldIntoRange(text, [low, high]) {
  return String(text ?? '')
    .split(/("[^"]*"|![^!]*!)/)
    .map((part, i) => (i % 2 ? part : part.replace(/([_^=]*)([A-Ga-g])([,']*)/g, (whole, acc, letter, marks) => {
      const step = 'CDEFGAB'.indexOf(letter.toUpperCase())
      let pitch = step + (letter === letter.toLowerCase() ? 7 : 0) + 7 * ((marks.match(/'/g) || []).length - (marks.match(/,/g) || []).length)
      if (pitch >= low && pitch <= high) return whole
      while (pitch < low) pitch += 7
      while (pitch > high) pitch -= 7
      const octave = Math.floor(pitch / 7)
      const name = octave >= 1 ? letter.toLowerCase() + "'".repeat(octave - 1) : letter.toUpperCase() + ','.repeat(-octave)
      return acc + name
    })))
    .join('')
}

const SHARP_ORDER = 'FCGDAEB'
const FLAT_ORDER = 'BEADGCF'
const MAJOR_FIFTHS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 }
const MINOR_FIFTHS = { A: 0, E: 1, B: 2, 'F#': 3, 'C#': 4, 'G#': 5, 'D#': 6, 'A#': 7, D: -1, G: -2, C: -3, F: -4, Bb: -5, Eb: -6, Ab: -7 }
const ACCIDENTAL_VALUE = { '^': 1, '^^': 2, _: -1, __: -2, '=': 0 }

/** Sharps (+1) and flats (-1) by letter for a key like "G", "Bb" or "F#m". */
export function keyAccidentals(key) {
  const k = String(key || 'C')
  const fifths = (k.endsWith('m') ? MINOR_FIFTHS[k.slice(0, -1)] : MAJOR_FIFTHS[k]) ?? 0
  return Object.fromEntries([...(fifths >= 0 ? SHARP_ORDER : FLAT_ORDER).slice(0, Math.abs(fifths))].map(l => [l, fifths >= 0 ? 1 : -1]))
}

/**
 * Drop accidentals the key signature already gives, so a D chord in G major does not print a sharp
 * on its F. An accidental that matches the key is dropped until one that changes the note appears on
 * that letter in the bar; from then on everything on that letter is kept as written.
 */
export function dropKeyAccidentals(text, key) {
  const keyAcc = keyAccidentals(key)
  const touched = new Set()
  return String(text ?? '')
    .split(/("[^"]*"|![^!]*!)/)
    .map((part, i) => (i % 2 ? part : part.replace(/(\^\^|__|[_^=])?([A-Ga-g])/g, (whole, acc, letter) => {
      if (!acc) return whole
      const name = letter.toUpperCase()
      if (!touched.has(name) && ACCIDENTAL_VALUE[acc] === (keyAcc[name] ?? 0)) return letter
      touched.add(name)
      return whole
    })))
    .join('')
}

/** The clef a voice must use: fretted instruments have a fixed one; others keep what Hermes chose. */
export function clefFor(instrument, clef) {
  const tab = INSTRUMENTS[String(instrument || '').toLowerCase()]?.tab
  if (tab === 'guitar') return 'treble'
  if (tab === 'bass') return 'bass'
  return clef === 'bass' ? 'bass' : 'treble'
}

/** abcjs tablature options, one entry per voice (staff); an empty instrument means no TAB. */
export function tablatureFor(piece) {
  const tabs = piece.voices.map(v => instrumentOf(v.instrument).tab)
  if (!tabs.some(Boolean)) return undefined
  return tabs.map(tab => (tab ? { instrument: 'guitar', label: '', tuning: TAB_TUNINGS[tab] } : { instrument: '' }))
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
      if (start === 0) {
        // MIDI directives only reach the synth on their own lines after a V: line; written inline
        // after [V:..] they are ignored and every part plays as a piano.
        const inst = instrumentOf(v.instrument)
        text = `V:${v.id}\n%%MIDI program ${inst.program}\n${inst.tab ? '%%MIDI transpose -12\n' : ''}[V:${v.id}] `
      }
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
    clef: clefFor(v.instrument, v.clef)
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

/**
 * A piece the agent opened with stave_open (already checked on the Python side) as a page piece:
 * section lengths and marks are derived from its bars.
 */
export function pieceFromAgent(entry) {
  const voices = (entry.voices || []).slice(0, 3).map((v, i) => ({
    id: `V${i + 1}`,
    name: String(v.name || (i === 0 ? 'Melody' : 'Part')).slice(0, 24),
    instrument: INSTRUMENTS[String(v.instrument || '').toLowerCase()] ? String(v.instrument).toLowerCase() : 'piano',
    clef: clefFor(v.instrument, v.clef)
  }))
  const bars = (entry.bars || []).map(b => ({
    section: String(b.section || 'A').slice(0, 3),
    notes: Object.fromEntries(voices.map(v => [v.id, String(b.notes?.[v.id] ?? '')]))
  }))
  const names = new Map((entry.sections || []).map(s => [String(s.id), String(s.name || '')]))
  const piece = {
    id: newId(),
    title: cleanTitle(entry.title),
    prompt: String(entry.prompt || ''),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    meta: {
      key: KEY_RE.test(String(entry.key || '')) ? String(entry.key) : 'C',
      meter: METERS.includes(entry.meter) ? entry.meter : '4/4',
      tempo: Math.max(40, Math.min(200, Math.round(Number(entry.tempo) || 100))),
      mood: String(entry.mood || '').slice(0, 80)
    },
    voices,
    sections: [],
    bars,
    marks: [],
    versions: [],
    from: 'chat'
  }
  const seen = new Set()
  for (const r of sectionRanges(piece)) {
    const name = names.get(r.id) || ''
    piece.sections.push({ id: r.id, name, bars: r.to - r.from + 1, chords: [], idea: '' })
    const label = name ? `${r.id} · ${name.toLowerCase()}` : `section ${r.id}`
    piece.marks.push({ kind: 'section', from: r.from, to: r.to, text: seen.has(r.id) ? `${label}, again` : label, at: Date.now() })
    seen.add(r.id)
  }
  if (entry.note) piece.marks.push({ kind: 'piece', from: 0, to: 0, text: String(entry.note).slice(0, 120), at: Date.now() })
  return withVersion(piece, 'Written in chat')
}
