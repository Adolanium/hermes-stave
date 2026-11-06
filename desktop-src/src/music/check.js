// Checks what Hermes wrote before anyone sees it: every bar of every voice must add up to the meter,
// every note must sit in its instrument's range, and the ABC must parse. Issues name the bar and voice
// so Hermes can repair exactly those bars.
import { barLength, instrumentOf } from './model.js'

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

/** Bars (0-based) that have at least one issue. */
export function badBars(issues) {
  return [...new Set(issues.filter(i => i.bar >= 0).map(i => i.bar))].sort((a, b) => a - b)
}
