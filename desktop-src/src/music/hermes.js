// What Stave asks Hermes, and how it reads the answers. Hermes plans first (form, key, chords, parts),
// then writes one section at a time so each call stays short and the score fills in as it arrives.
// `ask(instructions, input, { maxTokens, temperature })` is injected: Desktop's llm.oneshot in the app,
// a canned function in tests.
import { FRETTED_RANGE, INSTRUMENTS, barsText, dropKeyAccidentals, eighthsPerBar, foldIntoRange, instrumentOf } from './model.js'

const INSTRUMENT_NAMES = Object.keys(INSTRUMENTS).join(', ')

const NOTATION_RULES = (meter) => `Notation: ABC with L:1/8, so a plain note is an eighth. Every bar of every part must add up to exactly ${eighthsPerBar(meter)} eighths (meter ${meter}).
- Pitches: C D E F G A B c d e f g a b, lower octave with a trailing comma (C, D,), higher with an apostrophe (c' d'). Middle C is C.
- Sharps ^F, flats _B, naturals =F. The key signature already applies; only write accidentals that leave the key.
- Lengths: A2 = quarter, A4 = half, A8 = whole, A3 = dotted quarter, A/ = sixteenth, A3/2 = dotted eighth. Rests: z, z2, z4, z8.
- Chords: [CEG]2. Triplets: (3ABc = three eighths in the time of two. Ties: A2-A2.
- Chord symbols for the first part only, in double quotes before the note where the harmony changes: "Am"A2 c2 "F"F4.
- Never write bar lines, repeats, header fields, decorations, or comments inside a bar.
- Treble parts stay between G3 and f6 (G, to f'). Bass parts stay between E1 and G4 (E,,, to G).
- Guitars (nylon guitar, steel guitar, electric guitar) are written on the treble clef an octave above how they sound, as guitar music is, between E, and e'; the page adds TAB under them. Nothing below E, (the open low string): a D chord starts on D, not D,. Use these chord shapes, spelled for C major (in another key, mark with ^ _ or = any note the key signature would change): G [G,B,DGBg], C [CEGce], D [DAd^f], Em [E,B,EGBe], Am [A,EAce], E [E,B,E^GBe], A [A,EA^ce], Dm [DAdf], F [FAcf], Bm [B,^FBd^f]. Do not repeat one block chord on every beat: pick the shape one note at a time (G,B,DG BGDB) or strum it in a rhythm (chord2 then shorter strums, with a rest or a held chord).
- Bass guitar is written on the bass clef an octave above how it sounds, between E,, and G, one note at a time.`

export const PLAN_INSTRUCTIONS = `You are the composer behind Stave, a page that turns a sentence into a short piece of sheet music.
Plan the piece the person describes. Reply with JSON only, no prose, in exactly this shape:
{"title": "2-4 word title", "mood": "few words", "key": "C" | "G" | "D" | "F" | "Bb" | "Eb" | "A" | "Am" | "Em" | "Dm" | "Gm" | "Cm" | "Bm" | "F#m",
 "meter": "4/4" | "3/4" | "6/8" | "2/4", "tempo": 40-200 (quarter notes per minute; for 6/8 dotted quarters),
 "voices": [{"name": "Melody", "instrument": "<instrument>", "clef": "treble" | "bass"}, ...],
 "sections": [{"id": "A", "name": "1-2 words", "bars": 4 or 8, "chords": ["one chord per bar, or two separated by a space"], "idea": "one line: contour, rhythm, register, how it relates to earlier sections"}]}
Rules: 2 or 3 voices; the first is the melody. Pick instruments from: ${INSTRUMENT_NAMES}. Guitars use the treble clef and bass guitar the bass clef.
Total length 16 to 32 bars across 2 to 4 sections; reuse section ids for a return (A B A) only when the music repeats.
Give the piece a shape: a memorable motif, contrast in the middle, an ending that lands on the tonic.
Respect anything specific the person asked for (instrument, length, tempo, style).`

export const SECTION_INSTRUCTIONS = (meter) => `You write sections of a short piece in ABC notation for Stave. Reply with JSON only:
{"bars": [{"V1": "notes of bar 1 for voice V1", "V2": "...", ...}, ...]}
Write exactly the number of bars asked, one object per bar, every voice in every bar.
${NOTATION_RULES(meter)}
Make it music: a clear melody with a motif that comes back, rhythmic variety, stepwise motion with some leaps, phrases that breathe (a longer note or rest every 2 or 4 bars).
Lower voices support the melody: bass on chord roots and fifths, inner parts in longer notes or a simple pattern.
When a section repeats an earlier one, reuse its bars with small variation.`

export const REPAIR_INSTRUCTIONS = (meter) => `You fix bars in a short piece of ABC music for Stave. Some bars have problems listed next to them.
Reply with JSON only: {"bars": [{"V1": "...", "V2": "..."}, ...]} with one object per bar asked, in order, every voice, keeping the music as close to the original as possible.
${NOTATION_RULES(meter)}`

export const EDIT_INSTRUCTIONS = (meter) => `You revise a short piece of ABC music for Stave. The person selected some bars and said how to change them.
Reply with JSON only: {"bars": [{"V1": "...", "V2": "..."}, ...], "note": "what you changed, under 12 words, plain words for someone who does not read music"}
Return exactly the number of bars selected, one object per bar, every voice. The notes must actually change to do what they asked: a new rhythm, new pitches or both. The bar length never changes: to hold a note longer, take its time from other notes in the bar (shorten or drop them). Keep the bars around the selection in mind so the change joins smoothly.
${NOTATION_RULES(meter)}`

export const RESHAPE_INSTRUCTIONS = (meter) => `You revise a whole short piece of ABC music for Stave. The person said how to change it.
Reply with JSON only, including only what changes:
{"title"?: "...", "key"?: "...", "tempo"?: 40-200, "voices"?: [{"name": "...", "instrument": "...", "clef": "treble" | "bass"}], "bars"?: [{"V1": "...", ...}, ...], "note": "what you changed, under 12 words"}
Change tempo or instruments without rewriting bars when that is all they asked for. When you change "key", rewrite "bars" in the new key.
"bars", when present, replaces every bar: keep the same count unless they asked for a longer or shorter piece. Keep the voice count unless they asked otherwise; when voices change, every bar must use the new voice ids V1, V2, V3 in order.
Pick instruments from: ${INSTRUMENT_NAMES}.
${NOTATION_RULES(meter)}`

/** The first JSON object in a model reply, tolerant of fences and chatter around it. */
export function parseJson(text) {
  const s = String(text ?? '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Hermes did not reply with JSON')
  return JSON.parse(s.slice(start, end + 1))
}

function voiceIds(piece) {
  return piece.voices.map(v => v.id)
}

/** Normalise a {"bars": [...]} reply to `count` bars with every voice present. */
export function readBars(reply, piece, count) {
  const list = Array.isArray(reply?.bars) ? reply.bars : []
  if (list.length !== count) throw new Error(`Hermes wrote ${list.length} bars, ${count} were asked for`)
  return list.map(b => {
    const notes = {}
    for (const v of piece.voices) {
      const text = String(b?.[v.id] ?? '').replace(/\|/g, ' ').replace(/\s+/g, ' ').trim()
      const tab = instrumentOf(v.instrument).tab
      notes[v.id] = dropKeyAccidentals(tab ? foldIntoRange(text, FRETTED_RANGE[tab]) : text, piece.meta.key)
    }
    return { notes }
  })
}

function describe(piece) {
  const v = piece.voices.map(x => `${x.id} ${x.name} (${x.instrument}, ${x.clef} clef)`).join('; ')
  return `Title: ${piece.title}\nMood: ${piece.meta.mood}\nKey: ${piece.meta.key}  Meter: ${piece.meta.meter}  Tempo: ${piece.meta.tempo}\nVoices: ${v}`
}

export async function planPiece(ask, prompt) {
  const text = await ask(PLAN_INSTRUCTIONS, `The person asked for: ${prompt}`, { maxTokens: 900, temperature: 0.8 })
  return parseJson(text)
}

/** Write `section` (an entry of piece.sections, with its own bar count) after the bars already written. */
export async function writeSection(ask, piece, section) {
  const opening = piece.sections[0]?.id === section.id
  const before = piece.bars.length
    ? `Bars written so far:\n${barsText(piece)}`
    : opening ? 'This is the opening: state the motif clearly.' : `The other sections are being written at the same time from the same plan. Make this section's motif grow from the idea of section ${piece.sections[0]?.id}, and contrast as the plan says.`
  const earlier = piece.bars.some(b => b.section === section.id) ? `This is a return of section ${section.id}: reuse those bars with a small variation.` : ''
  const input = `${describe(piece)}\n\nForm: ${piece.sections.map(s => `${s.id} "${s.name}" ${s.bars} bars, chords ${s.chords.join(' | ')}: ${s.idea}`).join('\n')}\n\n${before}\n\nNow write section ${section.id} "${section.name}": ${section.bars} bars, numbered ${piece.bars.length + 1} to ${piece.bars.length + section.bars}.\nChords, one entry per bar: ${section.chords.join(' | ') || 'your choice'}\nIdea: ${section.idea}\n${earlier}`
  const text = await ask(SECTION_INSTRUCTIONS(piece.meta.meter), input, { maxTokens: replyBudget(piece, section.bars), temperature: 0.7 })
  return readBars(parseJson(text), piece, section.bars)
}

/** Ask Hermes to fix bars `indexes` (0-based) given their issues; returns bars in the same order. */
export async function repairBars(ask, piece, indexes, issues, intent = '') {
  const rows = indexes.map(i => {
    const problems = issues.filter(x => x.bar === i).map(x => `${x.voice}: ${x.message}`).join('; ')
    return `${barsText(piece, i, i)}   <- ${problems}`
  })
  const keep = intent ? `\n\nThese bars were just rewritten because the person asked: ${intent}. Keep that change and fix only the problems: to make a note longer, take the time from the notes around it.` : ''
  const input = `${describe(piece)}\n\nWhole piece for context:\n${barsText(piece)}\n\nFix these ${indexes.length} bars, in this order:\n${rows.join('\n')}${keep}`
  const text = await ask(REPAIR_INSTRUCTIONS(piece.meta.meter), input, { maxTokens: replyBudget(piece, indexes.length), temperature: 0.2 })
  return readBars(parseJson(text), piece, indexes.length)
}

/**
 * Token ceiling for a reply of `bars` bars: about 45 per voice per bar for the notes and JSON, plus
 * room for a model's hidden reasoning, which counts against the same limit when it is turned on.
 * The ceiling costs nothing when unused; a tight one would cut a thinking model off mid-answer.
 */
export function replyBudget(piece, bars) {
  return Math.min(12000, 4000 + bars * piece.voices.length * 45)
}

/**
 * Rewrite bars [from, to] (0-based, inclusive) as the person asked. Returns { bars, note }.
 * Only the neighbourhood travels (four bars either side, plus the form): a smaller prompt and a
 * reply sized to the selection keep a bar edit quick.
 */
export async function editBars(ask, piece, from, to, request, retryNote = '') {
  const count = to - from + 1
  const lo = Math.max(0, from - 4)
  const hi = Math.min(piece.bars.length - 1, to + 4)
  const form = piece.sections.map(s => `${s.id} "${s.name}"`).join(', ')
  const input = `${describe(piece)}\nForm: ${form}; ${piece.bars.length} bars in all.\n\nBars ${lo + 1} to ${hi + 1}, around the selection:\n${barsText(piece, lo, hi)}\n\nSelected: bars ${from + 1} to ${to + 1} (${count} bars).\nThe person said: ${request}${retryNote ? `\n\n${retryNote}` : ''}`
  const text = await ask(EDIT_INSTRUCTIONS(piece.meta.meter), input, { maxTokens: replyBudget(piece, count) + 60, temperature: retryNote ? 0.9 : 0.6 })
  const reply = parseJson(text)
  return { bars: readBars(reply, piece, count), note: String(reply.note || '').slice(0, 120) }
}

/** Whole-piece change (tempo, instruments, key, length). Returns the parsed reply. */
export async function reshapePiece(ask, piece, request) {
  const input = `${describe(piece)}\n\nWhole piece:\n${barsText(piece)}\n\nThe person said: ${request}`
  const text = await ask(RESHAPE_INSTRUCTIONS(piece.meta.meter), input, { maxTokens: 3600, temperature: 0.6 })
  return parseJson(text)
}
