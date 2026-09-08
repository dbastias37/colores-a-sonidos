import { clamp } from '../synth/analysis.js'
export const SCALES = {
  majorPent: { name: 'Pentatónica mayor', character: 'Suave y abierta', notes: [0, 2, 4, 7, 9] },
  minorPent: { name: 'Pentatónica menor', character: 'Íntima y serena', notes: [0, 3, 5, 7, 10] },
  ionian: { name: 'Jónica · mayor', character: 'Luminosa y cálida', notes: [0, 2, 4, 5, 7, 9, 11] },
  lydian: { name: 'Lidia', character: 'Aérea y luminosa', notes: [0, 2, 4, 6, 7, 9, 11] },
  dorian: { name: 'Dórica', character: 'Serena y envolvente', notes: [0, 2, 3, 5, 7, 9, 10] },
  aeolian: { name: 'Eólica · menor', character: 'Profunda y contemplativa', notes: [0, 2, 3, 5, 7, 8, 10] },
  phrygian: { name: 'Frigia', character: 'Oscura y misteriosa', notes: [0, 1, 3, 5, 7, 8, 10] }
}
const NAMES = ['Do', 'Do♯', 'Re', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si']
export const noteName = midi => NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1)
export function autoScale(data) {
  if (data.neutral) return 'minorPent'
  if (data.avgSaturation < .22 || data.entropy < .16) return data.coolness > .52 ? 'minorPent' : 'majorPent'
  if (data.coolness > .56) return data.avgBrightness < .28 ? 'phrygian' : data.avgBrightness < .46 ? 'aeolian' : 'dorian'
  return data.avgBrightness > .57 ? 'lydian' : 'ionian'
}
export function makeComposition(data, settings = {}) {
  const scaleKey = settings.scale && settings.scale !== 'auto' ? settings.scale : autoScale(data)
  const scale = SCALES[scaleKey] || SCALES[autoScale(data)]
  const root = 48 + (data.neutral ? 9 : [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5][Math.floor(data.dominantColors[0].h / 30) % 12])
  const bpm = clamp(settings.bpm || data.bpm, 48, 112), beat = 60 / bpm, duration = beat * 32
  const density = clamp(.22 + data.entropy * .73), notes = []
  const degreeMidi = degree => root + scale.notes[((degree % scale.notes.length) + scale.notes.length) % scale.notes.length] + Math.floor(degree / scale.notes.length) * 12
  let seed = data.seed >>> 0
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  let previous = 3
  for (let step = 0; step < 64; step++) {
    const color = data.strips[Math.floor(step / 2)]
    if (step % 4 !== 0 && random() > density * (step % 2 ? .60 : 1)) continue
    const target = color.neutral ? Math.round(color.l * 6) : Math.floor(color.h / 360 * scale.notes.length) + (color.l > .56 ? scale.notes.length : 0)
    let degree = previous + clamp(target - previous, -3, 3)
    if (step % 16 === 0 || step === 62) degree = step === 0 || step >= 48 ? 0 : [0, 2, 4, 0][Math.floor(step / 16)]
    previous = degree
    notes.push({ time: step * beat / 2, duration: beat * (1.2 + (1 - data.contrast) * .6), midi: degreeMidi(degree) + 12, velocity: .10 + color.s * .035 + color.l * .025, hue: color.h, step })
  }
  // Chords use the same scale as the melody; no chromatic unions or random mode changes.
  const progression = scale.notes.length === 5 ? [0, 3, 1, 0] : [0, 5, 3, 4]
  const chords = Array.from({ length: 8 }, (_, i) => {
    const degree = progression[Math.floor(i / 2)]
    return { time: i * 4 * beat, duration: 4 * beat, midis: [0, 2, 4].map(n => degreeMidi(degree + n)) }
  })
  return { scaleKey, scale, root, bpm, beat, duration, notes, chords, brightness: data.avgBrightness, saturation: data.avgSaturation, contrast: data.contrast, density }
}
