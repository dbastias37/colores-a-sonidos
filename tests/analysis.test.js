import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzePixels, rgbToHsl, shannonEntropy, BIN_COUNT } from '../src/synth/analysis.js'
import { makeComposition, autoScale } from '../src/audio/composition.js'
import { foldLoop } from '../src/audio/engine.js'
function image(colors, width = colors.length, height = 1) {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) pixels.set(colors[i % colors.length], i * 4)
  return analyzePixels(pixels, width, height)
}
test('Shannon entropy uses probabilities, not a count of occupied bins', () => {
  assert.equal(shannonEntropy([100, 0]), 0)
  assert.equal(shannonEntropy([50, 50]), 1)
  assert.ok(shannonEntropy([99, 1]) < .09)
  const flat = image([[255, 0, 0, 255]])
  const balanced = image([[255, 0, 0, 255], [0, 0, 255, 255]])
  assert.equal(flat.entropy, 0)
  assert.equal(balanced.entropyBits, 1)
  assert.equal(balanced.entropy, 1 / Math.log2(BIN_COUNT))
})
test('grayscale has neutral temperature; transparent pixels do not bias statistics', () => {
  const gray = image([[128, 128, 128, 255]])
  assert.equal(gray.neutral, true); assert.equal(gray.coolness, .5); assert.equal(autoScale(gray), 'minorPent')
  const redWithInvisibleBlue = image([[255, 0, 0, 255], [0, 0, 255, 0]])
  assert.equal(redWithInvisibleBlue.coolness, 0); assert.equal(redWithInvisibleBlue.entropy, 0)
  assert.throws(() => image([[0, 0, 0, 0]]), /transparente/)
  const black = image([[0, 0, 0, 255]]), white = image([[255, 255, 255, 255]])
  assert.equal(black.avgBrightness, 0); assert.equal(white.avgBrightness, 1)
  assert.ok(white.bpm > black.bpm)
})
test('color weights and hue wrap are correct', () => {
  const data = image([[0, 0, 255, 255], [0, 0, 255, 255], [255, 0, 0, 255]])
  assert.ok(Math.abs(data.coolness - 2 / 3) < 1e-10)
  assert.equal(data.dominantColors[0].hex, '#0000ff')
  assert.equal(rgbToHsl(255, 0, 1).h < 360, true)
})
test('composition is deterministic, scale-locked and responds to spatial changes', () => {
  const colors = [[0, 120, 220, 255], [255, 120, 80, 255], [80, 190, 70, 255]]
  const a = image(colors, 96, 32), b = image([...colors].reverse(), 96, 32)
  const score = makeComposition(a)
  assert.deepEqual(score, makeComposition(a))
  assert.notDeepEqual(score.notes, makeComposition(b).notes)
  for (const note of score.notes) {
    assert.ok(score.scale.notes.includes(((note.midi - score.root) % 12 + 12) % 12))
    assert.ok(note.time >= 0 && note.time < score.duration)
  }
  assert.ok(score.notes.length <= 64)
  for (const chord of score.chords) for (const midi of chord.midis) assert.ok(score.scale.notes.includes((midi - score.root) % 12))
  assert.equal(makeComposition(a, { scale: 'dorian', bpm: 60 }).duration, 32)
})
test('loop folding preserves tails and enforces the sum-of-stems headroom', () => {
  const input = Float32Array.from([0, 1, 2, 3, 4, 5])
  assert.deepEqual([...foldLoop(input, 4, 100)], [4, 6, 2, 3])
  const samples = foldLoop(input, 4, .28)
  assert.ok(Math.max(...samples) <= .280001)
  assert.ok(.28 + .28 + .20 < 1)
  assert.ok(samples.every(Number.isFinite))
})
