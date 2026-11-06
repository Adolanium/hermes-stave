// Checks what Hermes wrote before anyone sees it: every bar of every voice must add up to the meter,
// every note must sit in its instrument's range, and the ABC must parse. Issues name the bar and voice
// so Hermes can repair exactly those bars.
import { barLength, instrumentOf, keyAccidentals } from './model.js'

// abcjs pitch numbers: 0 is middle C (C4), 7 is the C above, -7 the C below.
const RANGES = {
  treble: { name: 'treble', low: -5, high: 17, label: 'E3–f6' },
  bass: { name: 'bass', low: -17, high: 4, label: 'E1–G4' },
  // Fretted parts, as written (an octave above how they sound): open low string to the 12th fret
  // of the top string, and one note per string in a chord.
  guitar: { name: 'guitar', low: -5, high: 16, label: "E, to e' as written; nothing below E,, so a D chord starts on D, not D,", strings: 6, open: 'guitar' },
  bass_guitar: { name: 'bass guitar', low: -12, high: 4, label: 'E,, to G as written; nothing below E,,', strings: 4, open: 'bass' }
}

// Open strings as written (an octave above sound), lowest first, in MIDI numbers.
const OPEN_STRINGS = { guitar: [52, 57, 62, 67, 71, 76], bass: [40, 45, 50, 55] }
const STEPS = [0, 2, 4, 5, 7, 9, 11]
const ACCIDENTALS = { sharp: 1, flat: -1, dblsharp: 2, dblflat: -2, natural: 0 }

/**
 * Whether a chord (written MIDI pitches) prints with one string per note in TAB. Mirrors abcjs, checked
 * against its rendering on 900 random chords: notes high to low, each on the highest string at or
 * below it; a clash between neighbours moves the lower-fret note one string down, once per chord.
 * A clash on the lowest string, a second clash, or two notes a half step apart or less print "?",
 * overlap on one string, or break abcjs, so they do not fit.
 */
export function chordFitsStrings(pitches, open) {
  const sorted = [...pitches].sort((a, b) => b - a)
  if (sorted.some((m, i) => i > 0 && sorted[i - 1] - m <= 1)) return false
  const pos = sorted.map(m => {
    let s = -1
    for (let i = open.length - 1; i >= 0; i--) {
      if (m >= open[i]) {
        s = i
        break
      }
    }
    return { m, s }
  })
  if (pos.some(p => p.s < 0)) return false
  const fret = p => p.m - open[p.s]
  let moved = false
  for (let j = 0; j < pos.length - 1; j++) {
    const a = pos[j]
    const b = pos[j + 1]
    if (a.s !== b.s) continue
    if (a.s === 0 || moved) return false
    const mover = fret(b) < fret(a) ? b : a
    mover.s -= 1
    moved = true
  }
  return new Set(pos.map(p => p.s)).size === pos.length
}

function rangeFor(voice) {
  const tab = instrumentOf(voice.instrument).tab
  if (tab === 'guitar') return RANGES.guitar
  if (tab === 'bass') return RANGES.bass_guitar
  return RANGES[voice.clef === 'bass' ? 'bass' : 'treble']
}

const ALLOWED = /^[A-Ga-gz^_=,'0-9/\s[\]()".<>\-~#bm+°ø7-9A-Za-z|:]*$/

/** Quick structural checks on one bar's text that parsing will not report. */
export function lintBar(text) {
  const t = String(text ?? '')
  if (!t.trim()) return 'empty bar'
  if (t.includes('|')) return 'bar line inside a bar'
  if ((t.match(/"/g) || []).length % 2) return 'unclosed chord symbol'
  if ((t.match(/\[/g) || []).length !== (t.match(/]/g) || []).length) return 'unclosed chord bracket'
  if (/[A-Z]:/.test(t.replace(/"[^"]*"/g, ''))) return 'header field inside a bar'
  if (!ALLOWED.test(t)) return 'characters ABC does not use'
  return null
}

/**
 * Parse one piece's ABC with abcjs and return issues:
 * [{ bar (0-based), voice ('V1'), kind ('length'|'range'|'syntax'), message }].
 */
export function checkPiece(piece, abcjs, abcText) {
  const issues = []
  piece.bars.forEach((bar, i) => {
    for (const v of piece.voices) {
      const problem = lintBar(bar.notes[v.id])
      if (problem) issues.push({ bar: i, voice: v.id, kind: 'syntax', message: problem })
    }
  })
  let tune
  try {
    tune = abcjs.parseOnly(abcText)[0]
  } catch (e) {
    issues.push({ bar: -1, voice: '', kind: 'syntax', message: `does not parse: ${e.message}` })
    return issues
  }
  for (const w of tune?.warnings || []) {
    issues.push({ bar: -1, voice: '', kind: 'syntax', message: String(w).replace(/<[^>]+>/g, '').slice(0, 120) })
  }
  const expected = barLength(piece.meta.meter)
  piece.voices.forEach((voice, staffIndex) => {
    const range = rangeFor(voice)
    let bar = 0
    let sum = 0
    let triplet = 1
    let tripletLeft = 0
    let measure = {}
    const close = () => {
      if (bar < piece.bars.length && Math.abs(sum - expected) > 1e-3) {
        const have = Math.round(sum * 8 * 100) / 100
        const want = Math.round(expected * 8 * 100) / 100
        issues.push({ bar, voice: voice.id, kind: 'length', message: `${have} eighths, needs ${want}` })
      }
      bar += 1
      sum = 0
    }
    for (const line of tune?.lines || []) {
      const staff = line.staff?.[staffIndex]
      if (!staff) continue
      for (const el of staff.voices?.[0] || []) {
        if (el.el_type === 'bar') {
          close()
          measure = {}
          continue
        }
        if (el.el_type !== 'note' || !el.duration) continue
        if (el.startTriplet) {
          triplet = el.tripletMultiplier || 2 / 3
          tripletLeft = el.tripletR || el.startTriplet
        }
        sum += el.duration * (tripletLeft > 0 ? triplet : 1)
        if (tripletLeft > 0) tripletLeft -= 1
        for (const p of el.pitches || []) {
          if (p.pitch < range.low || p.pitch > range.high) {
            issues.push({ bar, voice: voice.id, kind: 'range', message: `note outside the ${range.name} range (${range.label})` })
            break
          }
        }
        if (range.strings && (el.pitches || []).length > range.strings) {
          issues.push({ bar, voice: voice.id, kind: 'range', message: `a chord with ${el.pitches.length} notes; this part has ${range.strings} strings` })
        } else if (range.open && (el.pitches || []).length > 1) {
          const keyAcc = Object.fromEntries((staff.key?.accidentals || []).map(a => [a.note.toUpperCase(), ACCIDENTALS[a.acc] ?? 0]))
          const midis = el.pitches.map(p => {
            const step = ((p.pitch % 7) + 7) % 7
            const letter = 'CDEFGAB'[step]
            if (p.accidental) measure[letter] = ACCIDENTALS[p.accidental] ?? 0
            return 60 + 12 * Math.floor(p.pitch / 7) + STEPS[step] + (measure[letter] ?? keyAcc[letter] ?? 0)
          })
          if (!chordFitsStrings(midis, OPEN_STRINGS[range.open])) {
            issues.push({ bar, voice: voice.id, kind: 'range', message: 'two notes of a chord fall on the same string, so it cannot be fingered; spread the chord out or drop a note' })
          }
        } else {
          for (const p of el.pitches || []) if (p.accidental) measure['CDEFGAB'[((p.pitch % 7) + 7) % 7]] = ACCIDENTALS[p.accidental] ?? 0
        }
      }
    }
    if (sum > 0) close()
  })
  return dedupe(issues).sort((a, b) => a.bar - b.bar || a.voice.localeCompare(b.voice))
}

function dedupe(issues) {
  const seen = new Set()
  return issues.filter(i => {
    const k = `${i.bar}|${i.voice}|${i.kind}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function eighthsOf(len) {
  if (!len) return 1
  const m = /^(\d*)(\/*)(\d*)$/.exec(len)
  if (!m) return NaN
  const num = m[1] ? Number(m[1]) : 1
  if (!m[2]) return num
  return num / (m[3] ? Number(m[3]) : 2 ** m[2].length)
}

function restOf(eighths) {
  if (Number.isInteger(eighths)) return eighths === 1 ? 'z' : `z${eighths}`
  const sixteenths = Math.round(eighths * 2)
  return sixteenths === 1 ? 'z/' : `z${sixteenths}/2`
}

/**
 * Last resort for a bar Hermes could not make add up: drop notes from the end while it is too long,
 * then fill what is missing with a rest. Returns null for bars with triplets, which this would break.
 */
export function fitBarLength(text, want) {
  const t = String(text ?? '')
  if (t.includes('(')) return null
  const tokens = []
  for (const m of t.matchAll(/"[^"]*"|![^!]*!|\[[^\]]*\]([\d/]*)-?|[_^=]*[A-Ga-g][,']*([\d/]*)-?|[zx]([\d/]*)/g)) {
    if (m[0][0] === '"' || m[0][0] === '!') continue
    tokens.push({ start: m.index, dur: eighthsOf(m[1] ?? m[2] ?? m[3] ?? '') })
  }
  if (tokens.some(k => !Number.isFinite(k.dur))) return null
  let total = tokens.reduce((s, k) => s + k.dur, 0)
  let cut = t.length
  while (total > want + 1e-9 && tokens.length) {
    const last = tokens.pop()
    total -= last.dur
    cut = last.start
  }
  const kept = t.slice(0, cut).trimEnd().replace(/-$/, '')
  const missing = Math.round((want - total) * 8) / 8
  return missing > 0 ? `${kept} ${restOf(missing)}`.trim() : kept
}

/**
 * Last resort for a guitar or bass chord Hermes could not make playable: drop the fewest notes, inner
 * ones first, so the bass and the top note stay, until every note has its own string. Accidentals
 * follow the bar as the TAB reads them (by letter). Chords that already fit are left alone.
 */
export function fitChordsToStrings(text, key, instrument) {
  const tab = instrumentOf(instrument).tab
  if (!tab) return String(text ?? '')
  const open = OPEN_STRINGS[tab]
  const keyAcc = keyAccidentals(key)
  const measure = {}
  const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
  const VALUE = { '^': 1, '^^': 2, _: -1, __: -2, '=': 0 }
  const midiOf = ([, acc, letter, marks]) => {
    const name = letter.toUpperCase()
    if (acc) measure[name] = VALUE[acc]
    const octave = (letter === letter.toLowerCase() ? 1 : 0) + (marks.match(/'/g) || []).length - (marks.match(/,/g) || []).length
    return 60 + 12 * octave + STEP[name] + (measure[name] ?? keyAcc[name] ?? 0)
  }
  return String(text ?? '')
    .split(/("[^"]*"|![^!]*!)/)
    .map((part, i) => (i % 2 ? part : part.replace(/\[([^\]]*)\]|([_^=]*)([A-Ga-g])([,']*)/g, (whole, inner, acc, letter, marks) => {
      if (inner === undefined) {
        midiOf([whole, acc, letter, marks])
        return whole
      }
      const notes = [...inner.matchAll(/([_^=]*)([A-Ga-g])([,']*)/g)].map(m => ({ text: m[0], midi: midiOf(m) }))
      if (notes.length < 2 || chordFitsStrings(notes.map(n => n.midi), open)) return whole
      // Inner notes (by pitch) are the first candidates to go; the bass and the top note go last.
      const order = notes.map((n, k) => k).sort((a, b) => notes[a].midi - notes[b].midi)
      const candidates = [...order.slice(1, -1).reverse(), order.at(-1), order[0]]
      for (const drop of [1, 2, 3]) {
        const tries = drop === 1 ? candidates.map(k => [k]) : drop === 2 ? candidates.flatMap((a, x) => candidates.slice(x + 1).map(b => [a, b])) : [candidates.slice(0, 3)]
        for (const gone of tries) {
          const kept = notes.filter((n, k) => !gone.includes(k))
          if (kept.length && (kept.length < 2 || chordFitsStrings(kept.map(n => n.midi), open))) {
            return kept.length === 1 ? kept[0].text : `[${kept.map(n => n.text).join('')}]`
          }
        }
      }
      return whole
    })))
    .join('')
}

/** Bars (0-based) that have at least one issue. */
export function badBars(issues) {
  return [...new Set(issues.filter(i => i.bar >= 0).map(i => i.bar))].sort((a, b) => a - b)
}
