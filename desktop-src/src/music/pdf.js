// A small PDF writer: one full-page grayscale image per page, already zlib-deflated by the caller.
// That is all a printed score needs, so Stave carries no PDF library.

export const A4 = { width: 595.28, height: 841.89 } // points

/** PDF text string: plain ASCII in parentheses, anything else as UTF-16BE hex with a BOM. */
export function pdfString(text) {
  const s = String(text ?? '')
  if (/^[\x20-\x7e]*$/.test(s)) return `(${s.replace(/[\\()]/g, c => `\\${c}`)})`
  let hex = 'FEFF'
  for (const ch of s) {
    const code = ch.codePointAt(0)
    const units = code > 0xffff ? [0xd800 + ((code - 0x10000) >> 10), 0xdc00 + ((code - 0x10000) & 0x3ff)] : [code]
    for (const u of units) hex += u.toString(16).toUpperCase().padStart(4, '0')
  }
  return `<${hex}>`
}

/**
 * pages: [{ width, height, data }] where data is the deflated (zlib) 8-bit grayscale pixels.
 * info: { title, subject, author, creator }. Returns the file as a Uint8Array.
 */
export function buildPdf(pages, info = {}) {
  if (!pages.length) throw new Error('nothing to print')
  const enc = new TextEncoder()
  const chunks = []
  const offsets = []
  let size = 0
  const push = part => {
    const bytes = typeof part === 'string' ? enc.encode(part) : part
    chunks.push(bytes)
    size += bytes.length
  }
  const object = (id, body, stream) => {
    offsets[id] = size
    push(`${id} 0 obj\n${body}\n`)
    if (stream) {
      push('stream\n')
      push(stream)
      push('\nendstream\n')
    }
    push('endobj\n')
  }

  // 1 catalog, 2 page tree, 3 info, then three objects per page: page, contents, image.
  const pageId = i => 4 + i * 3
  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`)
  const fields = Object.entries({ Title: info.title, Subject: info.subject, Author: info.author, Creator: info.creator })
    .filter(([, v]) => v)
    .map(([k, v]) => `/${k} ${pdfString(v)}`)
  object(3, `<< ${fields.join(' ')} >>`)
  pages.forEach((page, i) => {
    const id = pageId(i)
    const draw = `q ${A4.width} 0 0 ${A4.height} 0 0 cm /Im0 Do Q`
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`)
    object(id + 1, `<< /Length ${enc.encode(draw).length} >>`, draw)
    object(id + 2, `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${page.data.length} >>`, page.data)
  })

  const count = 4 + pages.length * 3
  const xref = size
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`
  for (let id = 1; id < count; id++) table += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  push(table)
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  const out = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/**
 * Lay systems onto pages. systems: [{ top, bottom }] in score units, in order. Each system takes the
 * band from halfway after the previous one to halfway before the next, so chord symbols and bar
 * numbers above a staff travel with it. Returns [[{ start, end }...] per page]; the first page has
 * `first` units of room, later pages `rest`. A system taller than a page gets a page of its own.
 */
export function paginate(systems, { first, rest, top, bottom }) {
  const bands = systems.map((s, i) => ({
    start: i === 0 ? Math.min(top, s.top) : (systems[i - 1].bottom + s.top) / 2,
    end: i === systems.length - 1 ? Math.max(bottom, s.bottom) : (s.bottom + systems[i + 1].top) / 2
  }))
  const pages = []
  let page = []
  let room = first
  for (const band of bands) {
    const h = band.end - band.start
    if (page.length && h > room) {
      pages.push(page)
      page = []
      room = rest
    }
    page.push(band)
    room -= h
  }
  if (page.length) pages.push(page)
  return pages
}
