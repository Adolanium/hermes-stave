// Checks what Hermes wrote before anyone sees it: every bar of every voice must add up to the meter,
// every note must sit in its instrument's range, and the ABC must parse. Issues name the bar and voice
// so Hermes can repair exactly those bars.
import { barLength } from './model.js'

// abcjs pitch numbers: 0 is middle C (C4), 7 is the C above, -7 the C below.
const RANGES = {
  treble: { low: -5, high: 17, label: 'G3–f6' },
  bass: { low: -17, high: 4, label: 'E1–G4' }
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
    const range = RANGES[voice.clef === 'bass' ? 'bass' : 'treble']
    let bar = 0
    let sum = 0
    let triplet = 1
    let tripletLeft = 0
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
            issues.push({ bar, voice: voice.id, kind: 'range', message: `note outside ${voice.clef === 'bass' ? 'bass' : 'treble'} range (${range.label})` })
            break
          }
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
