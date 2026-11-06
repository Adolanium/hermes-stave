// The same notes three ways. A deliberately awkward piece (dotted rhythms, triplets, ties across a bar
// line, accidentals that last to the bar line and no further, guitar chords and patterns) is read by a
// small reader written here, independent of abcjs, and compared note by note with what abcjs plays
// (the exported MIDI) and with the frets it prints in the guitar and bass TAB.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { checkPiece } from '../src/music/check.js'
import { readBars } from '../src/music/hermes.js'
import { TAB_TUNINGS, instrumentOf, pieceFromPlan, toAbc } from '../src/music/model.js'

const require = createRequire(import.meta.url)
const abcjs = require('abcjs')
const StringPatterns = require('abcjs/src/tablatures/instruments/string-patterns')

const PLANNED = {
  ...pieceFromPlan({
    title: 'Proof',
    key: 'D',
    meter: '4/4',
    tempo: 100,
    voices: [
      { name: 'Melody', instrument: 'flute' },
      { name: 'Guitar', instrument: 'steel guitar' },
      { name: 'Bass', instrument: 'bass guitar' }
    ],
    sections: [{ id: 'A', bars: 5 }]
  }),
  bars: [
    // key D: F and C are sharp; a dotted quarter, then a triplet
    { V1: '"D"f3 e d2 (3fga', V2: 'D2 [Ad^f]2 A,2 [Ad^f]2', V3: 'D,4 A,,4' },
    // an accidental lasts to the bar line, in its own octave only
    { V1: '"A"^g2 g2 =c2 c2', V2: '[A,EAce]8', V3: 'A,,8' },
    // after the bar line the key is back; a tie runs into the next bar
    { V1: '"G"g2 c2 B2 A2-', V2: 'G,B,DG BGDB,', V3: 'G,,4 D,4' },
    // a sixteenth after a dotted eighth
    { V1: '"D"A2 F3/2 G/ A4', V2: '[DAdf]6 z2', V3: 'D,6 z2' },
    // guitar: =C in one octave, plain c in another (still C sharp from the key)
    { V1: '"C"=c2 e2 g4', V2: '[=CEG]4 [EGc]4', V3: 'C,8' }
  ]
}

// Through the same normalisation as every reply Hermes sends, so the test sees what the page stores.
const PIECE = { ...PLANNED, bars: readBars({ bars: PLANNED.bars }, PLANNED, PLANNED.bars.length).map(b => ({ section: 'A', notes: b.notes })) }

// ---- an independent reader for the ABC Stave writes ----------------------------------------------

const STEPS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
// D major, written out here rather than taken from Stave.
const D_MAJOR = { F: 1, C: 1 }
const ACC = { '^': 1, '^^': 2, _: -1, __: -2, '=': 0 }

function length(text) {
  if (!text) return 1
  const m = /^(\d*)(\/*)(\d*)$/.exec(text)
  const num = m[1] ? Number(m[1]) : 1
  const den = m[3] ? Number(m[3]) : 2 ** m[2].length
  return m[2] ? num / den : num
}

/** Written MIDI pitches and times (in quarter notes) of one voice, ties merged. */
function readVoice(bars, keyAcc, meterEighths) {
  const notes = []
  const open = new Map() // tied notes waiting for their continuation, by pitch
  let t = 0
  bars.forEach((text, bar) => {
    const accidentals = new Map() // by letter and octave, for this bar only
    let triplet = 0
    const clean = String(text).replace(/"[^"]*"/g, ' ')
    const re = /\(3|\[([^\]]*)\]([\d/]*)(-?)|([_^=]*)([A-Ga-g])([,']*)([\d/]*)(-?)|z([\d/]*)/g
    for (const m of clean.matchAll(re)) {
      if (m[0] === '(3') {
        triplet = 3
        continue
      }
      const scale = triplet > 0 ? 2 / 3 : 1
      if (triplet > 0) triplet -= 1
      const heads = []
      let dur
      let tie
      if (m[9] !== undefined) {
        t += (length(m[9]) * scale) / 2
        continue
      }
      if (m[1] !== undefined) {
        for (const n of m[1].matchAll(/([_^=]*)([A-Ga-g])([,']*)/g)) heads.push(n)
        dur = length(m[2]) * scale
        tie = m[3] === '-'
      } else {
        heads.push([m[0], m[4], m[5], m[6]])
        dur = length(m[7]) * scale
        tie = m[8] === '-'
      }
      for (const [, acc, letter, marks] of heads) {
        const name = letter.toUpperCase()
        const octave = (letter === letter.toLowerCase() ? 1 : 0) + (marks.match(/'/g) || []).length - (marks.match(/,/g) || []).length
        const slot = `${name}${octave}`
        if (acc) accidentals.set(slot, ACC[acc])
        const pitch = 60 + 12 * octave + STEPS[name] + (accidentals.has(slot) ? accidentals.get(slot) : keyAcc[name] ?? 0)
        const start = t
        const end = t + dur / 2
        if (open.has(pitch)) {
          open.get(pitch).end = end
          if (!tie) open.delete(pitch)
        } else {
          const note = { start, end, pitch }
          notes.push(note)
          if (tie) open.set(pitch, note)
        }
      }
      t += dur / 2
    }
    assert.equal(Math.round(t * 1000), Math.round(((bar + 1) * meterEighths * 1000) / 2), `bar ${bar + 1} adds up`)
  })
  return notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
}

// ---- what abcjs plays ----------------------------------------------------------------------------

function vlq(b, i) {
  let v = 0
  for (;;) {
    const c = b[i++]
    v = (v << 7) | (c & 0x7f)
    if (!(c & 0x80)) return [v, i]
  }
}

/** Notes of each track of a MIDI file: start and end in quarter notes, and pitch. */
function midiTracks(bytes) {
  const b = [...bytes]
  const division = (b[12] << 8) | b[13]
  const tracks = []
  for (let i = 14; i < b.length;) {
    const len = (b[i + 4] << 24) | (b[i + 5] << 16) | (b[i + 6] << 8) | b[i + 7]
    const end = i + 8 + len
    const on = new Map()
    const notes = []
    let t = 0
    let status = 0
    for (let j = i + 8; j < end;) {
      let d
      ;[d, j] = vlq(b, j)
      t += d
      if (b[j] === 0xff) {
        let l
        ;[l, j] = vlq(b, j + 2)
        j += l
        continue
      }
      if (b[j] & 0x80) status = b[j++]
      const kind = status & 0xf0
      if (kind === 0x90 || kind === 0x80) {
        const [pitch, velocity] = [b[j], b[j + 1]]
        j += 2
        if (kind === 0x90 && velocity > 0) on.set(pitch, t)
        else if (on.has(pitch)) {
          notes.push({ start: on.get(pitch) / division, end: t / division, pitch })
          on.delete(pitch)
        }
      } else j += kind === 0xc0 || kind === 0xd0 ? 1 : 2
    }
    tracks.push(notes.sort((x, y) => x.start - y.start || x.pitch - y.pitch))
    i = end
  }
  return tracks
}

const round = notes => notes.map(n => [Math.round(n.start * 1000) / 1000, Math.round(n.end * 1000) / 1000, n.pitch])

test('the proof piece passes Stave’s own checks', () => {
  assert.deepEqual(checkPiece(PIECE, abcjs, toAbc(PIECE)), [])
})

test('what abcjs plays is exactly what the bars say, part by part', () => {
  const abc = toAbc(PIECE)
  const tracks = midiTracks(abcjs.synth.getMidiFile(abc, { midiOutputType: 'binary', chordsOff: true })[0]).filter(t => t.length)
  assert.equal(tracks.length, PIECE.voices.length)
  PIECE.voices.forEach((voice, i) => {
    const written = readVoice(PIECE.bars.map(b => b.notes[voice.id]), D_MAJOR, 8)
    const shift = instrumentOf(voice.instrument).tab ? -12 : 0
    const sounding = written.map(n => ({ ...n, pitch: n.pitch + shift }))
    assert.deepEqual(round(tracks[i]), round(sounding), `${voice.instrument} plays what is written`)
  })
})

test('every TAB fret is the note on the staff, on its own string', () => {
  const tune = abcjs.parseOnly(toAbc(PIECE))[0]
  PIECE.voices.forEach((voice, staff) => {
    const tab = instrumentOf(voice.instrument).tab
    if (!tab) return
    const strings = new StringPatterns({ tuning: TAB_TUNINGS[tab], capo: 0, params: {}, linePitch: 3, setError() {} })
    const written = readVoice(PIECE.bars.map(b => b.notes[voice.id]), D_MAJOR, 8)
    const fromTab = []
    let t = 0
    for (const line of tune.lines) {
      const s = line.staff?.[staff]
      if (!s) continue
      strings.accidentals = s.key?.accidentals || []
      // As abcjs's TAB renderer does: an octave clef shifts what each written note means.
      strings.clefTranspose = /-8/.test(s.clef?.type || '') ? -12 : 0
      for (const el of s.voices[0]) {
        if (el.el_type === 'bar') strings.measureAccidentals = {}
        if (el.el_type !== 'note') continue
        if (el.pitches) {
          const placed = strings.notesToNumber(el.pitches.map(p => ({ name: p.name }))).notes
          assert.equal(new Set(placed.map(n => n.str)).size, placed.length, `one string per note at ${t}`)
          for (const n of placed) {
            assert.notEqual(n.num, '?', `a fret for every note at ${t}`)
            // The open string plus the fret is the sounding note (abcjs counts an octave lower than
            // MIDI, hence +12); undo the clef's octave to get back to the written note.
            const sounding = strings.stringPitches[strings.stringPitches.length - 1 - n.str] + n.num + 12
            fromTab.push({ start: t, pitch: sounding - strings.clefTranspose })
          }
        }
        t += el.duration * 4
      }
    }
    // The guitar and bass parts have no ties or triplets, so every written note is a TAB number.
    const key = n => [Math.round(n.start * 1000) / 1000, n.pitch]
    assert.deepEqual(
      fromTab.map(key).sort((a, b) => a[0] - b[0] || a[1] - b[1]),
      written.map(key).sort((a, b) => a[0] - b[0] || a[1] - b[1]),
      `${voice.instrument}: TAB and staff agree`
    )
  })
})
