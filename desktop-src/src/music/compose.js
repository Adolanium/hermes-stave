// The composing loop: plan, write each section, check, repair once, and report every step so the page
// can show what Hermes is doing while it does it. Also the bar edit and whole-piece reshape flows.
import { badBars, checkPiece } from './check.js'
import { editBars, planPiece, readBars, repairBars, reshapePiece, writeSection } from './hermes.js'
import { INSTRUMENTS, METERS, eighthsPerBar, pieceFromPlan, spliceBars, toAbc, withVersion } from './model.js'

function mark(kind, from, to, text) {
  return { kind, from, to, text, at: Date.now() }
}

/** Check bars, repair the broken ones once, and return { piece, fixed, left }. */
async function checkAndRepair(ask, piece, abcjs, scope, emit) {
  let issues = checkPiece(piece, abcjs, toAbc(piece)).filter(i => i.bar < 0 || scope.includes(i.bar))
  let bad = badBars(issues)
  if (bad.length === 0) return { piece, fixed: [], left: issues.filter(i => i.bar < 0) }
  emit({ phase: 'repair', bars: bad, issues })
  let repaired = piece
  try {
    const bars = await repairBars(ask, piece, bad, issues)
    const nextBars = [...piece.bars]
    bad.forEach((index, k) => { nextBars[index] = { ...nextBars[index], notes: bars[k].notes } })
    repaired = { ...piece, bars: nextBars }
  } catch (e) {
    emit({ phase: 'repair-failed', error: String(e.message || e) })
  }
  issues = checkPiece(repaired, abcjs, toAbc(repaired)).filter(i => i.bar < 0 || scope.includes(i.bar))
  const still = badBars(issues)
  return { piece: repaired, fixed: bad.filter(b => !still.includes(b)), left: issues }
}

/**
 * Compose a piece from a sentence. `emit(event)` receives:
 * plan → { piece } once the plan is in; section → { piece, from, to } as each section lands;
 * repair → { bars }; done → { piece, issues }.
 */
export async function compose(ask, abcjs, prompt, emit = () => {}, cancelled = () => false) {
  emit({ phase: 'planning' })
  const plan = await planPiece(ask, prompt)
  let piece = pieceFromPlan(plan, prompt)
  if (piece.sections.length === 0) throw new Error('Hermes returned a plan with no sections')
  emit({ phase: 'plan', piece })
  for (const section of piece.sections) {
    if (cancelled()) throw new Error('cancelled')
    emit({ phase: 'writing', section: section.id, piece })
    const from = piece.bars.length
    const bars = await writeSection(ask, piece, section)
    piece = { ...piece, bars: [...piece.bars, ...bars.map(b => ({ section: section.id, notes: b.notes }))] }
    const to = piece.bars.length - 1
    const scope = Array.from({ length: to - from + 1 }, (_, k) => from + k)
    const checked = await checkAndRepair(ask, piece, abcjs, scope, emit)
    piece = checked.piece
    const text = section.name ? `${section.id} · ${section.name.toLowerCase()}` : `section ${section.id}`
    piece = { ...piece, marks: [...piece.marks, mark('section', from, to, text)] }
    if (checked.fixed.length) {
      piece = { ...piece, marks: [...piece.marks, ...checked.fixed.map(b => mark('fixed', b, b, 'checked and fixed'))] }
    }
    emit({ phase: 'section', piece, from, to, fixed: checked.fixed })
  }
  piece = withVersion({ ...piece, updatedAt: Date.now() }, 'Written')
  const issues = checkPiece(piece, abcjs, toAbc(piece))
  emit({ phase: 'done', piece, issues })
  return piece
}

/** Change bars [from, to] as asked. Returns the new piece (with an undo snapshot) and Hermes's note. */
export async function changeBars(ask, abcjs, piece, from, to, request, emit = () => {}) {
  emit({ phase: 'editing', from, to })
  const before = withVersion(piece, `Before: ${request.slice(0, 40)}`)
  const { bars, note } = await editBars(ask, piece, from, to, request)
  let next = spliceBars(before, from, to, bars)
  const scope = Array.from({ length: to - from + 1 }, (_, k) => from + k)
  const checked = await checkAndRepair(ask, next, abcjs, scope, emit)
  next = checked.piece
  next = { ...next, marks: [...next.marks.filter(m => m.to < from || m.from > to || m.kind === 'section'), mark('changed', from, to, note || request)] }
  return { piece: next, note }
}

/** Apply a whole-piece change (tempo, instruments, key, length, rewrite). */
export async function reshape(ask, abcjs, piece, request, emit = () => {}) {
  emit({ phase: 'reshaping' })
  const reply = await reshapePiece(ask, piece, request)
  let next = withVersion(piece, `Before: ${request.slice(0, 40)}`)
  const meta = { ...next.meta }
  if (typeof reply.key === 'string' && /^[A-G][#b]?m?$/.test(reply.key)) meta.key = reply.key
  if (Number(reply.tempo)) meta.tempo = Math.max(40, Math.min(200, Math.round(Number(reply.tempo))))
  if (typeof reply.meter === 'string' && METERS.includes(reply.meter)) meta.meter = reply.meter
  next = { ...next, meta, title: typeof reply.title === 'string' && reply.title.trim() ? reply.title.trim().slice(0, 60) : next.title }
  if (Array.isArray(reply.voices) && reply.voices.length) {
    next = {
      ...next,
      voices: reply.voices.slice(0, 3).map((v, i) => ({
        id: `V${i + 1}`,
        name: String(v.name || next.voices[i]?.name || 'Part').slice(0, 24),
        instrument: INSTRUMENTS[String(v.instrument || '').toLowerCase()] ? String(v.instrument).toLowerCase() : next.voices[i]?.instrument || 'piano',
        clef: v.clef === 'bass' ? 'bass' : v.clef === 'treble' ? 'treble' : next.voices[i]?.clef || 'treble'
      }))
    }
  }
  if (Array.isArray(reply.bars) && reply.bars.length) {
    const bars = readBars(reply, next, reply.bars.length)
    const sectionOf = i => next.bars[Math.min(i, next.bars.length - 1)]?.section ?? next.sections[0]?.id
    next = { ...next, bars: bars.map((b, i) => ({ section: sectionOf(i), notes: b.notes })), marks: next.marks.filter(m => m.kind === 'section' && m.to < reply.bars.length) }
    const scope = next.bars.map((_, i) => i)
    next = (await checkAndRepair(ask, next, abcjs, scope, emit)).piece
  } else if (next.voices.length !== piece.voices.length) {
    // Voices changed without new bars: keep the music for the voices that still exist.
    const rest = `z${eighthsPerBar(next.meta.meter)}`
    next = { ...next, bars: next.bars.map(b => ({ ...b, notes: Object.fromEntries(next.voices.map(v => [v.id, b.notes[v.id] || rest])) })) }
  }
  // A whole-piece change overrides earlier whole-piece notes; keep only marks about specific bars.
  next = { ...next, marks: next.marks.filter(m => m.kind === 'section' || m.kind === 'fixed' || (m.kind === 'changed' && !m.whole)), updatedAt: Date.now() }
  const note = String(reply.note || request).slice(0, 120)
  return { piece: next, note }
}
