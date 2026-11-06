import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inflateSync } from 'node:zlib'
import { buildPdf, paginate, pdfString } from '../src/music/pdf.js'

async function deflate(bytes) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer())
}

const latin1 = bytes => Buffer.from(bytes).toString('latin1')

test('pdf strings: ASCII escaped in parentheses, anything else as UTF-16BE hex', () => {
  assert.equal(pdfString('Hush (a lullaby) \\ two'), '(Hush \\(a lullaby\\) \\\\ two)')
  assert.match(pdfString('für'), /^<FEFF006600FC0072>$/)
  assert.match(pdfString('🎵'), /^<FEFFD83CDFB5>$/)
})

test('a PDF has one page per image, a valid cross-reference table and the image intact', async () => {
  const w = 40, h = 30
  const pixels = new Uint8Array(w * h).map((_, i) => i % 256)
  const page = { width: w, height: h, data: await deflate(pixels) }
  const bytes = buildPdf([page, page], { title: 'Starlight Cradle', author: 'Hermes' })
  const text = latin1(bytes)
  assert.ok(text.startsWith('%PDF-1.4\n'))
  assert.ok(text.trimEnd().endsWith('%%EOF'))
  assert.match(text, /\/Type \/Pages \/Kids \[4 0 R 7 0 R\] \/Count 2/)
  assert.match(text, /\/Title \(Starlight Cradle\)/)

  // every xref entry points at its own "N 0 obj"
  const start = Number(/startxref\n(\d+)/.exec(text)[1])
  assert.ok(text.slice(start).startsWith('xref\n0 10\n'))
  const entries = text.slice(start).split('\n').slice(3, 12)
  entries.forEach((line, k) => {
    const offset = Number(line.slice(0, 10))
    assert.ok(text.slice(offset).startsWith(`${k + 1} 0 obj`), `object ${k + 1} at ${offset}`)
  })

  // the image stream inflates back to the pixels, and its /Length is right
  const m = /\/Length (\d+) >>\nstream\n/.exec(text.slice(text.indexOf('/Subtype /Image')))
  const at = text.indexOf('/Subtype /Image') + m.index + m[0].length
  const stream = bytes.slice(at, at + Number(m[1]))
  assert.deepEqual(new Uint8Array(inflateSync(stream)), pixels)
  assert.equal(latin1(bytes.slice(at + Number(m[1]), at + Number(m[1]) + 10)), '\nendstream')
})

test('systems fill pages in order, each keeping the space above it', () => {
  const systems = [0, 1, 2, 3, 4].map(i => ({ top: i * 300 + 40, bottom: i * 300 + 240 }))
  const pages = paginate(systems, { first: 650, rest: 900, top: 0, bottom: 1300 })
  assert.deepEqual(pages.map(p => p.length), [2, 3])
  assert.deepEqual(pages[0][0], { start: 0, end: 290 })
  assert.deepEqual(pages[0][1], { start: 290, end: 590 })
  assert.equal(pages[1].at(-1).end, 1440)
  // a system taller than a page still gets printed, alone
  assert.deepEqual(paginate([{ top: 0, bottom: 2000 }], { first: 500, rest: 500, top: 0, bottom: 2000 }).length, 1)
})
