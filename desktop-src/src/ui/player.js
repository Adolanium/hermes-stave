// Playback: abcjs's synth makes the sound, and its note timings tell the page which notes are sounding.
// The page reads the position from the audio clock every frame, so the highlight and the serpent move
// smoothly between notes instead of jumping on timer ticks.
import abcjs from 'abcjs'

let sharedContext = null

function audioContext() {
  if (!sharedContext) {
    const Ctx = window.AudioContext || window.webkitAudioContext
    sharedContext = new Ctx()
  }
  return sharedContext
}

export class Player {
  constructor() {
    this.synth = null
    this.visual = null
    this.timings = []
    this.duration = 0
    this.loadedFor = null
    this.playing = false
    this.offset = 0 // seconds, while paused
    this.listeners = new Set()
    this.loading = null
  }

  on(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  emit() {
    for (const fn of this.listeners) fn(this)
  }

  /** Point the player at a freshly rendered tune. Stops anything playing. */
  setTune(visual) {
    if (this.visual === visual) return
    this.stop()
    this.visual = visual
    this.synth = null
    this.loadedFor = null
    this.offset = 0
    try {
      const all = visual ? new abcjs.TimingCallbacks(visual, {}).noteTimings : []
      this.timings = all.filter(t => t.type === 'event')
      const end = all[all.length - 1]
      this.duration = end ? (end.milliseconds || 0) / 1000 : 0
    } catch {
      this.timings = []
      this.duration = 0
    }
    this.emit()
  }

  get isLoading() {
    return Boolean(this.loading)
  }

  async load() {
    if (!this.visual) return
    if (this.loadedFor === this.visual && this.synth) return
    if (this.loading) return this.loading
    const visual = this.visual
    this.loading = (async () => {
      const ctx = audioContext()
      if (ctx.state === 'suspended') await ctx.resume()
      const synth = new abcjs.synth.CreateSynth()
      await synth.init({ audioContext: ctx, visualObj: visual, millisecondsPerMeasure: visual.millisecondsPerMeasure(), options: { chordsOff: false } })
      await synth.prime()
      if (this.visual !== visual) return
      this.synth = synth
      this.loadedFor = visual
      this.duration = synth.duration || this.duration
    })()
    this.emit()
    try {
      await this.loading
    } finally {
      this.loading = null
      this.emit()
    }
  }

  /** Seconds into the piece right now. */
  position() {
    if (this.playing && this.synth?.startTimeSec !== undefined) {
      const t = audioContext().currentTime - this.synth.startTimeSec
      if (t >= this.duration - 0.05) {
        this.finish()
        return this.duration
      }
      return Math.max(0, t)
    }
    return this.offset
  }

  async play(fromSeconds) {
    await this.load()
    if (!this.synth) return
    if (fromSeconds !== undefined) this.offset = Math.max(0, Math.min(fromSeconds, this.duration - 0.1))
    if (this.offset >= this.duration - 0.1) this.offset = 0
    this.synth.seek(this.offset, 'seconds')
    this.synth.start()
    this.playing = true
    this.emit()
  }

  pause() {
    if (!this.playing || !this.synth) return
    this.offset = this.position()
    this.synth.pause()
    this.playing = false
    this.emit()
  }

  seek(seconds) {
    const s = Math.max(0, Math.min(seconds, this.duration))
    if (this.playing && this.synth) {
      this.synth.seek(s, 'seconds')
    }
    this.offset = s
    this.emit()
  }

  finish() {
    if (this.synth) {
      try { this.synth.stop() } catch { /* already stopped */ }
    }
    this.playing = false
    this.offset = 0
    this.emit()
  }

  stop() {
    if (this.synth && this.playing) {
      try { this.synth.stop() } catch { /* already stopped */ }
    }
    this.playing = false
    this.emit()
  }

  /** The timing event sounding at `seconds` (binary search). */
  eventAt(seconds) {
    const ms = seconds * 1000
    const list = this.timings
    let lo = 0
    let hi = list.length - 1
    let found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (list[mid].milliseconds <= ms) { found = mid; lo = mid + 1 } else hi = mid - 1
    }
    return found >= 0 ? list[found] : null
  }

  /** Start time in seconds of overall bar `index` (0-based), from the timings. */
  barStart(index) {
    for (const t of this.timings) {
      if (barOfEvent(t) === index) return t.milliseconds / 1000
    }
    return 0
  }

  /** A WAV of the piece, as an object URL. */
  async wavUrl() {
    await this.load()
    return this.synth ? this.synth.download() : null
  }
}

/** Overall bar index of a timing event, read off its SVG elements' abcjs-mm classes. */
export function barOfEvent(event) {
  for (const group of event?.elements || []) {
    for (const el of group || []) {
      const m = /abcjs-mm(\d+)/.exec(el?.getAttribute?.('class') || '')
      if (m) return Number(m[1])
    }
  }
  return -1
}

export function midiBytes(visual) {
  return abcjs.synth.getMidiFile(visual, { midiOutputType: 'binary' })
}

export function fmtTime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
