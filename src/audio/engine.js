const SAMPLE_RATE = 24000
const KEYS = ['melody', 'harmony', 'drone']
const hz = midi => 440 * 2 ** ((midi - 69) / 12)
function check(signal) { if (signal?.aborted) throw new DOMException('Preparación cancelada', 'AbortError') }

// Fold every release and echo across the boundary so looping doesn't cut tails.
export function foldLoop(samples, length, peakLimit) {
  const result = new Float32Array(length)
  for (let i = 0; i < samples.length; i++) result[i % length] += samples[i]
  let peak = 0
  for (const v of result) peak = Math.max(peak, Math.abs(v))
  if (peak > peakLimit) { const gain = peakLimit / peak; for (let i = 0; i < length; i++) result[i] *= gain }
  return result
}
function voice(ctx, output, midi, time, duration, volume, kind, brightness) {
  const envelope = ctx.createGain(), tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'; tone.frequency.value = kind === 'melody' ? 1600 + brightness * 3400 : kind === 'drone' ? 480 : 900 + brightness * 1200; tone.Q.value = .5
  const attack = kind === 'melody' ? .012 : kind === 'harmony' ? .65 : 1.2
  const release = kind === 'melody' ? .65 : 1.5
  const end = time + duration + release
  envelope.gain.setValueAtTime(0, time)
  envelope.gain.linearRampToValueAtTime(volume, time + attack)
  if (kind === 'melody') {
    envelope.gain.exponentialRampToValueAtTime(Math.max(.0001, volume * .10), time + duration)
  } else envelope.gain.setValueAtTime(volume, time + Math.max(attack, duration - .1))
  envelope.gain.exponentialRampToValueAtTime(.00001, end - .02)
  envelope.gain.linearRampToValueAtTime(0, end)
  tone.connect(envelope); envelope.connect(output)
  for (let i = 0; i < 2; i++) {
    const osc = ctx.createOscillator(), gain = ctx.createGain()
    osc.type = i === 0 ? 'sine' : 'triangle'
    osc.frequency.value = hz(midi) * (kind === 'melody' && i ? 2 : 1)
    osc.detune.value = kind === 'melody' ? 0 : i ? 3 : -3
    gain.gain.value = i ? kind === 'melody' ? .20 : .22 : .78
    osc.connect(gain); gain.connect(tone); osc.start(time); osc.stop(end + .01)
  }
}
export async function renderComposition(composition, signal, progress = () => {}) {
  const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext
  if (!Offline) throw new Error('Tu navegador no admite este motor de audio. Prueba una versión reciente de Chrome o Safari.')
  const length = Math.round(composition.duration * SAMPLE_RATE), buffers = {}
  for (const [index, key] of KEYS.entries()) {
    check(signal)
    const ctx = new Offline(1, length + SAMPLE_RATE * 8, SAMPLE_RATE)
    const dry = ctx.createGain(); dry.connect(ctx.destination)
    // A finite echo network is rendered once, never recalculated during playback.
    if (key !== 'drone') for (let tap = 1; tap <= 4; tap++) {
      const delay = ctx.createDelay(4), wet = ctx.createGain()
      delay.delayTime.value = composition.beat * .75 * tap
      wet.gain.value = (key === 'melody' ? .24 : .12) ** tap
      dry.connect(delay); delay.connect(wet); wet.connect(ctx.destination)
    }
    if (key === 'melody') for (const note of composition.notes) voice(ctx, dry, note.midi, note.time, note.duration, note.velocity, key, composition.brightness)
    if (key === 'harmony') for (const chord of composition.chords) for (const midi of chord.midis) voice(ctx, dry, midi, chord.time, chord.duration, .075, key, composition.brightness)
    if (key === 'drone') for (let i = 0; i < 4; i++) {
      voice(ctx, dry, composition.root - 12, i * composition.beat * 8, composition.beat * 8, .14, key, composition.brightness)
      voice(ctx, dry, composition.root - 5, i * composition.beat * 8, composition.beat * 8, .045, key, composition.brightness)
    }
    const rendered = await ctx.startRendering()
    check(signal)
    const loop = ctx.createBuffer(1, length, SAMPLE_RATE)
    loop.copyToChannel(foldLoop(rendered.getChannelData(0), length, key === 'drone' ? .20 : .28), 0)
    buffers[key] = loop
    progress((index + 1) / KEYS.length)
  }
  return { buffers, duration: length / SAMPLE_RATE }
}

export class AudioEngine {
  constructor(onState = () => {}) {
    this.onState = onState; this.context = null; this.sources = []; this.stems = null
    this.playing = false; this.offset = 0; this.startedAt = 0; this.generation = 0
    this.mix = { melody: .9, harmony: .65, drone: .4, master: .75 }
  }
  // Invoke synchronously in a user's click, before any asynchronous preparation.
  unlock() {
    if (!this.context || this.context.state === 'closed') {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext
      if (!Context) return Promise.reject(new Error('El navegador no admite audio web.'))
      this.context = new Context({ latencyHint: 'playback' })
      this.master = this.context.createGain(); this.master.gain.value = this.mix.master * .85
      this.fade = this.context.createGain(); this.fade.gain.value = 0
      this.compressor = this.context.createDynamicsCompressor()
      this.compressor.threshold.value = -8; this.compressor.knee.value = 6; this.compressor.ratio.value = 5
      this.compressor.attack.value = .003; this.compressor.release.value = .2
      this.gains = {}
      for (const key of KEYS) { const gain = this.context.createGain(); gain.gain.value = this.mix[key]; gain.connect(this.fade); this.gains[key] = gain }
      this.fade.connect(this.master); this.master.connect(this.compressor); this.compressor.connect(this.context.destination)
      this.context.onstatechange = () => this.onState(this.playing && this.context?.state !== 'running' ? 'interrupted' : this.playing ? 'playing' : 'paused')
    }
    return this.context.resume()
  }
  load(stems) { this.pause(true); this.stems = stems; this.offset = 0 }
  position() { return this.stems ? (this.offset + (this.playing ? Math.max(0, this.context.currentTime - this.startedAt) : 0)) % this.stems.duration : 0 }
  async play() {
    const token = ++this.generation
    await this.unlock()
    if (token !== this.generation || !this.stems) return
    if (this.playing) { this.onState('playing'); return }
    const now = this.context.currentTime, start = now + .04
    this.startedAt = start
    this.fade.gain.cancelScheduledValues(now); this.fade.gain.setValueAtTime(0, now); this.fade.gain.linearRampToValueAtTime(1, start + .14)
    this.sources = KEYS.map(key => {
      const source = this.context.createBufferSource(); source.buffer = this.stems.buffers[key]; source.loop = true; source.connect(this.gains[key]); source.start(start, this.offset)
      source.onended = () => source.disconnect()
      return source
    })
    this.playing = true; this.onState('playing')
  }
  pause(reset = false) {
    ++this.generation
    if (this.playing) this.offset = this.position()
    this.playing = false
    if (this.context && this.context.state !== 'closed') {
      const now = this.context.currentTime
      this.fade.gain.cancelScheduledValues(now); this.fade.gain.setValueAtTime(this.fade.gain.value, now); this.fade.gain.linearRampToValueAtTime(0, now + .06)
      for (const source of this.sources) { try { source.stop(now + .065) } catch {} }
    }
    this.sources = []; if (reset) this.offset = 0
    this.onState('paused')
  }
  seek(seconds) {
    if (!this.stems) return Promise.resolve()
    const resume = this.playing; this.pause(); this.offset = Math.max(0, Math.min(this.stems.duration - .001, seconds))
    return resume ? this.play() : Promise.resolve()
  }
  setMix(key, value) {
    this.mix[key] = Math.max(0, Math.min(1, value))
    const gain = key === 'master' ? this.master : this.gains?.[key]
    if (gain && this.context.state !== 'closed') gain.gain.setTargetAtTime(this.mix[key] * (key === 'master' ? .85 : 1), this.context.currentTime, .03)
  }
  clear() { this.pause(true); this.stems = null }
  dispose() {
    this.onState = () => {}; this.clear()
    if (this.context) { this.context.onstatechange = null; this.context.close().catch(() => {}) }
    this.context = null; this.gains = null; this.master = null; this.fade = null; this.compressor = null
  }
}
