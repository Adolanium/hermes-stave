// The engraved score as paper: black on white, a proper heading, A4 pages. Builds page SVGs from the
// score on screen, and turns them into a PDF by drawing each page at 300 dpi.
import { A4, buildPdf, paginate } from '../music/pdf.js'
import bodoni from './fonts/bodoni.woff2'
import bodoniItalic from './fonts/bodoni-italic.woff2'

const NS = 'http://www.w3.org/2000/svg'
const INK = '#111111'
const MARGIN = 56 // score units around the music
const HEADER = 150 // room for the title block on the first page
const FOOTER = 54
const DPI_WIDTH = 2480 // A4 at 300 dpi

const FONTS = `@font-face{font-family:'Stave Bodoni';src:url(${bodoni}) format('woff2');font-style:normal}` +
  `@font-face{font-family:'Stave Bodoni';src:url(${bodoniItalic}) format('woff2');font-style:italic}`

function el(name, attrs = {}, text) {
  const node = document.createElementNS(NS, name)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  if (text != null) node.textContent = text
  return node
}

function capitalise(s) {
  const t = String(s || '').trim()
  return t ? t[0].toUpperCase() + t.slice(1) : ''
}

/** "Gently, ♩. = 58": the mood as a tempo word, then the metronome mark. */
function tempoLine(piece) {
  const dotted = piece.meta.meter === '6/8'
  const mood = capitalise(String(piece.meta.mood || '').split(',')[0])
  return `${mood ? `${mood}, ` : ''}♩${dotted ? '.' : ''} = ${piece.meta.tempo}`
}

/** The score on screen, its size, and the vertical extent of each system, in score units. */
function measure() {
  const src = document.querySelector('.st-score svg')
  if (!src) throw new Error('the score is not on screen')
  const box = src.getBBox()
  const lines = new Map()
  src.querySelectorAll('[class*="abcjs-l"]').forEach(node => {
    if (node.closest('.st-serpent-layer')) return
    const m = /(?:^|\s)abcjs-l(\d+)(?:\s|$)/.exec(node.getAttribute('class') || '')
    if (!m || typeof node.getBBox !== 'function') return
    const b = node.getBBox()
    if (!b.width && !b.height) return
    const s = lines.get(m[1]) || { top: Infinity, bottom: -Infinity }
    s.top = Math.min(s.top, b.y)
    s.bottom = Math.max(s.bottom, b.y + b.height)
    lines.set(m[1], s)
  })
  const systems = [...lines.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([, s]) => s)
  return { src, box, systems: systems.length ? systems : [{ top: box.y, bottom: box.y + box.height }] }
}

/** The music, black on white, without the page's classes, highlight layer or hit areas. */
function inkedMusic(src) {
  const svg = src.cloneNode(true)
  svg.querySelectorAll('.st-serpent-layer, title, style').forEach(n => n.remove())
  svg.querySelectorAll('path, text, rect, tspan').forEach(n => {
    n.removeAttribute('class')
    n.setAttribute('fill', INK)
    if (n.getAttribute('stroke') && n.getAttribute('stroke') !== 'none') n.setAttribute('stroke', INK)
  })
  return [...svg.childNodes]
}

function heading(piece, width) {
  const g = el('g')
  g.appendChild(el('text', { x: width / 2, y: 74, 'text-anchor': 'middle', 'font-family': 'Stave Bodoni, Didot, Georgia, serif', 'font-size': 40, fill: INK }, piece.title))
  const small = { 'font-family': 'Stave Bodoni, Georgia, serif', 'font-size': 15, fill: INK }
  g.appendChild(el('text', { ...small, x: MARGIN, y: 132, 'font-style': 'italic' }, tempoLine(piece)))
  g.appendChild(el('text', { ...small, x: width - MARGIN, y: 132, 'text-anchor': 'end' }, 'Music by Hermes'))
  return g
}

/**
 * One SVG per A4 page (or a single tall page with `single`), as strings, fonts embedded so they draw
 * the same anywhere.
 */
export function sheetPages(piece, { single = false } = {}) {
  const { src, box, systems } = measure()
  const music = inkedMusic(src)
  // The music keeps its own left edge (box.x) and gets a printer's margin on both sides.
  const width = Math.ceil(box.x + box.width + 2 * MARGIN)
  const pageHeight = Math.round(width * (A4.height / A4.width))
  const top = box.y - 8
  const bottom = box.y + box.height + 8
  const plan = single
    ? [[{ start: top, end: bottom }]]
    : paginate(systems, { first: pageHeight - HEADER - FOOTER, rest: pageHeight - MARGIN - FOOTER, top, bottom })

  return plan.map((bands, p) => {
    const used = bands.reduce((h, b) => h + b.end - b.start, 0)
    const height = single ? Math.ceil(HEADER + used + MARGIN) : pageHeight
    const svg = el('svg', { xmlns: NS, viewBox: `0 0 ${width} ${height}`, width, height })
    svg.appendChild(el('style', {}, FONTS))
    svg.appendChild(el('rect', { x: 0, y: 0, width, height, fill: '#ffffff' }))
    const defs = svg.appendChild(el('defs'))
    if (p === 0) svg.appendChild(heading(piece, width))
    let y = p === 0 ? HEADER : MARGIN
    bands.forEach((band, k) => {
      const id = `band${k}`
      const clip = defs.appendChild(el('clipPath', { id, clipPathUnits: 'userSpaceOnUse' }))
      clip.appendChild(el('rect', { x: -MARGIN, y: band.start, width: width + 2 * MARGIN, height: band.end - band.start }))
      const g = svg.appendChild(el('g', { transform: `translate(${MARGIN} ${y - band.start})`, 'clip-path': `url(#${id})` }))
      music.forEach(n => g.appendChild(n.cloneNode(true)))
      y += band.end - band.start
    })
    if (!single && plan.length > 1) {
      svg.appendChild(el('text', { x: width / 2, y: height - 26, 'text-anchor': 'middle', 'font-family': 'Stave Bodoni, Georgia, serif', 'font-size': 13, fill: INK }, `${p + 1} / ${plan.length}`))
    }
    return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`
  })
}

export function sheetSvg(piece) {
  return sheetPages(piece, { single: true })[0]
}

async function rasterise(svgText) {
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const w = DPI_WIDTH
    const h = Math.round(w * (A4.height / A4.width))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    const rgba = ctx.getImageData(0, 0, w, h).data
    const gray = new Uint8Array(w * h)
    for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000
    const deflated = await new Response(new Blob([gray]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer()
    return { width: w, height: h, data: new Uint8Array(deflated) }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function sheetPdf(piece) {
  await document.fonts?.ready
  const pages = []
  for (const svg of sheetPages(piece)) pages.push(await rasterise(svg))
  return buildPdf(pages, { title: piece.title, subject: piece.prompt || piece.meta?.mood || '', author: 'Hermes', creator: 'Stave for Hermes Desktop' })
}
