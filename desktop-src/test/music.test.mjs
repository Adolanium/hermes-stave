import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { badBars, checkPiece, lintBar } from '../src/music/check.js'
import { changeBars, compose, reshape } from '../src/music/compose.js'
import { parseJson, readBars } from '../src/music/hermes.js'
import { barLength, pieceFromPlan, restoreVersion, sectionRanges, spliceBars, toAbc, withVersion } from '../src/music/model.js'

const abcjs = createRequire(import.meta.url)('abcjs')

const PLAN = {
  title: 'Sunny Day',
  mood: 'bright',
  key: 'C',
  meter: '4/4',
  tempo: 132,
  voices: [
    { name: 'Melody', instrument: 'flute', clef: 'treble' },
    { name: 'Bass', instrument: 'cello', clef: 'bass' }
  ],
  sections: [
    { id: 'A', name: 'Morning', bars: 4, chords: ['C', 'F G', 'C Am', 'G'], idea: 'rising' },
    { id: 'B', name: 'Noon', bars: 4, chords: ['Am', 'F', 'C G', 'C'], idea: 'answer' }
  ]
}

const A = [
  { V1: '"C"E2 G2 c2 G2', V2: 'C,4 G,,4' },
  { V1: '"F"A2 c2 "G"B2 d2', V2: 'F,,4 G,,4' },
  { V1: '"C"c2 e2 "Am"d2 c2', V2: 'C,4 A,,4' },
  { V1: '"G"B4 G4', V2: 'G,,8' }
]
const B = [
  { V1: '"Am"c3 B A2 c2', V2: 'A,,4 E,4' },
  { V1: '"F"A3 G F2 A2', V2: 'F,,4 C,4' },
  { V1: '"C"G2 E2 "G"D2 G2', V2: 'C,4 G,,4' },
  { V1: '"C"c6 z2', V2: 'C,6 z2' }
]

function cannedAsk(replies) {
  const calls = []
  const ask = async (instructions, input) => {
    calls.push({ instructions, input })
    const next = replies.shift()
    if (next === undefined) throw new Error('no more canned replies')
    return typeof next === 'string' ? next : JSON.stringify(next)
  }
  return { ask, calls }
}

test('bar length per meter', () => {
  assert.equal(barLength('4/4'), 1)
  assert.equal(barLength('6/8'), 0.75)
})

test('lint catches bar lines, quotes and header fields inside a bar', () => {
  assert.equal(lintBar('A2 | B2'), 'bar line inside a bar')
  assert.equal(lintBar('"C E2 G2'), 'unclosed chord symbol')
  assert.equal(lintBar('K:G A8'), 'header field inside a bar')
  assert.equal(lintBar('"Am"A8'), null)
})

test('a clean piece assembles to ABC that abcjs parses with no issues', () => {
  const piece = { ...pieceFromPlan(PLAN, 'happy'), bars: [...A.map(n => ({ section: 'A', notes: n })), ...B.map(n => ({ section: 'B', notes: n }))] }
  const abc = toAbc(piece)
  assert.match(abc, /^X:1\nT:Sunny Day\nM:4\/4\nL:1\/8\nQ:1\/4=132\nK:C\n/)
  assert.match(abc, /%%MIDI program 73/)
  assert.doesNotMatch(abc, /\[P:/)
  assert.match(abc, /\|]$/m)
  assert.deepEqual(checkPiece(piece, abcjs, abc), [])
  assert.deepEqual(sectionRanges(piece).map(r => [r.id, r.from, r.to]), [['A', 0, 3], ['B', 4, 7]])
})

test('the checker names short bars, long bars, triplets and range per voice', () => {
  const piece = {
    ...pieceFromPlan(PLAN, 'x'),
    bars: [
      { section: 'A', notes: { V1: 'c3 B A2', V2: 'C,8' } },
      { section: 'A', notes: { V1: '(3ABc d4 z2', V2: 'C,8' } },
      { section: 'A', notes: { V1: 'c8', V2: 'C,4 G,,4 C,2' } },
      { section: 'A', notes: { V1: "c''8", V2: 'C,8' } }
    ]
  }
  const issues = checkPiece(piece, abcjs, toAbc(piece))
  assert.deepEqual(issues.map(i => [i.bar, i.voice, i.kind]), [[0, 'V1', 'length'], [2, 'V2', 'length'], [3, 'V1', 'range']])
  assert.match(issues[0].message, /6 eighths, needs 8/)
  assert.deepEqual(badBars(issues), [0, 2, 3])
})

test('6/8 bars need six eighths', () => {
  const piece = { ...pieceFromPlan({ ...PLAN, meter: '6/8' }, 'x'), bars: [{ section: 'A', notes: { V1: 'A3 B3', V2: 'C,6' } }, { section: 'A', notes: { V1: 'A4', V2: 'C,6' } }] }
  assert.deepEqual(checkPiece(piece, abcjs, toAbc(piece)).map(i => [i.bar, i.voice]), [[1, 'V1']])
})

test('JSON is read through fences and chatter', () => {
  assert.deepEqual(parseJson('Sure!\n```json\n{"a": 1}\n```'), { a: 1 })
  assert.throws(() => parseJson('no json here'), /did not reply with JSON/)
})

test('readBars insists on the bar count and strips stray bar lines', () => {
  const piece = pieceFromPlan(PLAN, 'x')
  assert.throws(() => readBars({ bars: [{ V1: 'A8', V2: 'C,8' }] }, piece, 2), /wrote 1 bars, 2 were asked/)
  assert.deepEqual(readBars({ bars: [{ V1: 'A4 | B4', V2: 'C,8' }] }, piece, 1), [{ notes: { V1: 'A4 B4', V2: 'C,8' } }])
})

test('compose plans, writes each section, repairs a broken bar once, and marks it', async () => {
  const brokenA = A.map((b, i) => (i === 2 ? { ...b, V1: '"C"c2 e2 d2' } : b))
  const calls = []
  const ask = async (instructions, input) => {
    calls.push({ instructions, input })
    if (instructions.startsWith('You are the composer')) return JSON.stringify(PLAN)
    if (instructions.startsWith('You fix bars')) return JSON.stringify({ bars: [A[2]] })
    return JSON.stringify({ bars: /Now write section A/.test(input) ? brokenA : B })
  }
  const events = []
  const piece = await compose(ask, abcjs, 'a happy song', e => events.push(e.phase))
  assert.equal(calls.length, 4)
  assert.match(calls.find(c => c.instructions.startsWith('You fix bars')).input, /3: V1="\\"C\\"c2 e2 d2".*<- V1: 6 eighths, needs 8/)
  assert.deepEqual(events, ['planning', 'plan', 'writing', 'repair', 'section', 'section', 'done'])
  assert.equal(piece.bars.length, 8)
  assert.equal(piece.bars[2].notes.V1, A[2].V1)
  assert.deepEqual(piece.marks.map(m => [m.kind, m.from, m.to]), [['section', 0, 3], ['fixed', 2, 2], ['section', 4, 7]])
  assert.equal(piece.versions.length, 1)
  assert.deepEqual(checkPiece(piece, abcjs, toAbc(piece)), [])
})

test('changing bars replaces only the selection, keeps an undo snapshot, and leaves a margin note', async () => {
  const base = { ...pieceFromPlan(PLAN, 'x'), bars: [...A.map(n => ({ section: 'A', notes: n })), ...B.map(n => ({ section: 'B', notes: n }))] }
  const { ask, calls } = cannedAsk([{ bars: [{ V1: '"Am"A4 E4', V2: 'A,,8' }, { V1: '"E"^G8', V2: 'E,,8' }], note: 'darker, turns to minor' }])
  const { piece, note } = await changeBars(ask, abcjs, base, 2, 3, 'make it sadder')
  assert.match(calls[0].input, /Selected: bars 3 to 4 \(2 bars\)/)
  assert.equal(note, 'darker, turns to minor')
  assert.equal(piece.bars.length, 8)
  assert.equal(piece.bars[2].notes.V1, '"Am"A4 E4')
  assert.equal(piece.bars[4].notes.V1, B[0].V1)
  assert.deepEqual(piece.marks.at(-1), { ...piece.marks.at(-1), kind: 'changed', from: 2, to: 3, text: 'darker, turns to minor' })
  const undone = restoreVersion(piece, piece.versions.length - 1)
  assert.equal(undone.bars[2].notes.V1, A[2].V1)
})

test('reshape changes tempo and instruments without touching the notes', async () => {
  const base = { ...pieceFromPlan(PLAN, 'x'), bars: A.map(n => ({ section: 'A', notes: n })) }
  const { ask } = cannedAsk([{ tempo: 76, voices: [{ name: 'Melody', instrument: 'violin', clef: 'treble' }, { name: 'Bass', instrument: 'cello', clef: 'bass' }], note: 'slower, on strings' }])
  const { piece } = await reshape(ask, abcjs, base, 'slower, strings')
  assert.equal(piece.meta.tempo, 76)
  assert.equal(piece.voices[0].instrument, 'violin')
  assert.deepEqual(piece.bars, base.bars)
  assert.equal(piece.versions.length, 1)
})

test('spliceBars and withVersion keep the rest of the piece', () => {
  const base = { ...pieceFromPlan(PLAN, 'x'), bars: A.map(n => ({ section: 'A', notes: n })) }
  const next = spliceBars(withVersion(base, 'v'), 1, 1, [{ notes: { V1: 'A8', V2: 'C,8' } }, { notes: { V1: 'B8', V2: 'C,8' } }])
  assert.equal(next.bars.length, 5)
  assert.equal(next.bars[3].notes.V1, A[2].V1)
  assert.equal(next.versions.length, 1)
})

test('a returning section reuses its bars instead of asking Hermes again', async () => {
  const plan = { ...PLAN, sections: [...PLAN.sections, { id: 'A', name: 'Morning', bars: 4, chords: [], idea: 'return' }] }
  const { ask, calls } = cannedAsk([plan, { bars: A }, { bars: B }])
  const piece = await compose(ask, abcjs, 'a b a', () => {})
  assert.equal(calls.length, 3)
  assert.equal(piece.bars.length, 12)
  assert.deepEqual(piece.bars.slice(8).map(b => b.notes.V1), A.map(b => b.V1))
  assert.equal(piece.bars[8].section, 'A')
  assert.deepEqual(piece.marks.map(m => [m.kind, m.from, m.text]), [['section', 0, 'A · morning'], ['section', 4, 'B · noon'], ['section', 8, 'A · morning, again']])
})

test('every new section is written in parallel straight after the plan', async () => {
  const plan = { ...PLAN, sections: [...PLAN.sections, { id: 'C', name: 'Dusk', bars: 4, chords: [], idea: 'close' }] }
  const started = []
  let release
  const gate = new Promise(r => { release = r })
  const ask = async (instructions, input) => {
    if (instructions.startsWith('You are the composer')) return JSON.stringify(plan)
    const which = /Now write section (\w)/.exec(input)[1]
    started.push(which)
    if (started.length === 3) release()
    await gate
    return JSON.stringify({ bars: which === 'B' ? B : A })
  }
  const piece = await compose(ask, abcjs, 'abc', () => {})
  assert.deepEqual(started, ['A', 'B', 'C'])
  assert.equal(piece.bars.length, 12)
})

test('a bar edit sends only the bars around the selection', async () => {
  const base = { ...pieceFromPlan(PLAN, 'x'), bars: Array.from({ length: 24 }, (_, i) => ({ section: 'A', notes: A[i % 4] })) }
  const { ask, calls } = cannedAsk([{ bars: [{ V1: 'A8', V2: 'C,8' }], note: 'held' }])
  await changeBars(ask, abcjs, base, 12, 12, 'hold it')
  assert.match(calls[0].input, /Bars 9 to 17, around the selection/)
  assert.doesNotMatch(calls[0].input, /^1: /m)
  assert.match(calls[0].input, /^13: /m)
})

test('a section that fails once is asked again instead of losing the piece', async () => {
  let failedOnce = false
  const ask = async (instructions, input) => {
    if (instructions.startsWith('You are the composer')) return JSON.stringify(PLAN)
    if (/Now write section B/.test(input) && !failedOnce) { failedOnce = true; throw new Error('one-shot generation failed: timed out') }
    return JSON.stringify({ bars: /Now write section A/.test(input) ? A : B })
  }
  const events = []
  const piece = await compose(ask, abcjs, 'x', e => events.push(e.phase))
  assert.ok(events.includes('retry'))
  assert.equal(piece.bars.length, 8)
})

test('an edit that returns the same notes is asked again, and never claims a change it did not make', async () => {
  const base = { ...pieceFromPlan(PLAN, 'x'), bars: A.map(n => ({ section: 'A', notes: n })) }
  const same = { bars: [{ V1: A[3].V1, V2: A[3].V2 }], note: 'made it sleepy' }
  const { ask, calls } = cannedAsk([same, { bars: [{ V1: '"G"B8', V2: 'G,,8' }], note: 'held the last note' }])
  const { piece, note } = await changeBars(ask, abcjs, base, 3, 3, 'end on a long note')
  assert.equal(calls.length, 2)
  assert.match(calls[1].input, /returned these bars unchanged/)
  assert.equal(piece.bars[3].notes.V1, '"G"B8')
  assert.equal(note, 'held the last note')

  const stubborn = cannedAsk([same, same])
  const second = await changeBars(stubborn.ask, abcjs, base, 3, 3, 'end on a long note')
  assert.equal(second.note, 'Hermes kept these bars as they were. Try asking another way.')
  assert.equal(second.piece.marks.at(-1).text, second.note)
})

test('an edit that overruns the bar goes back to the edit prompt, and a repair back to the start says so', async () => {
  const base = { ...pieceFromPlan(PLAN, 'x'), bars: A.map(n => ({ section: 'A', notes: n })) }
  const long = { bars: [{ V1: '"G"B6 A4', V2: A[3].V2 }], note: 'held the last note' }
  const { ask, calls } = cannedAsk([long, { bars: [{ V1: '"G"B4 A4', V2: A[3].V2 }], note: 'held the last note' }])
  const { piece, note } = await changeBars(ask, abcjs, base, 3, 3, 'end on a long note')
  assert.equal(calls.length, 2)
  assert.match(calls[1].instructions, /^You revise a short piece/)
  assert.match(calls[1].input, /has problems/)
  assert.equal(piece.bars[3].notes.V1, '"G"B4 A4')
  assert.equal(note, 'held the last note')

  const stubborn = cannedAsk([long, long, { bars: [{ V1: A[3].V1, V2: A[3].V2 }] }])
  const second = await changeBars(stubborn.ask, abcjs, base, 3, 3, 'end on a long note')
  assert.equal(stubborn.calls.length, 3)
  assert.match(stubborn.calls[2].input, /the person asked: end on a long note/)
  assert.equal(second.note, 'Hermes kept these bars as they were. Try asking another way.')
})
