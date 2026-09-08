// Fixed HSL bins make entropy comparable across images (including neutral images).
export const BIN_COUNT = 24 * 3 * 4 + 8
export const clamp = (v, min = 0, max = 1) => Math.max(min, Math.min(max, v))
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  const l = (max + min) / 2
  if (!d) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = ((max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60) % 360
  return { h, s, l }
}
export function shannonEntropy(counts) {
  const total = counts.reduce((a, b) => a + b, 0)
  return total ? counts.reduce((sum, n) => n ? sum - (n / total) * Math.log2(n / total) : sum, 0) : 0
}
export function analyzePixels(pixels, width, height) {
  const histogram = new Float64Array(BIN_COUNT), groups = new Map()
  const strips = Array.from({ length: 32 }, () => ({ x: 0, y: 0, s: 0, l: 0, w: 0, chroma: 0 }))
  let weight = 0, light = 0, light2 = 0, saturation = 0, cool = 0, chroma = 0, seed = 2166136261
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, a = pixels[i + 3] / 255
    if (!a) continue
    const { h, s, l } = rgbToHsl(pixels[i], pixels[i + 1], pixels[i + 2])
    const neutral = s < .09 || l < .025 || l > .975
    const bin = neutral ? 288 + Math.min(7, Math.floor(l * 8)) : Math.floor(h / 15) * 12 + Math.min(2, Math.floor(s * 3)) * 4 + Math.min(3, Math.floor(l * 4))
    histogram[bin] += a
    const c = groups.get(bin) || { r: 0, g: 0, b: 0, weight: 0 }
    c.r += pixels[i] * a; c.g += pixels[i + 1] * a; c.b += pixels[i + 2] * a; c.weight += a; groups.set(bin, c)
    weight += a; light += l * a; light2 += l * l * a; saturation += s * a
    const cw = neutral ? 0 : s * a
    chroma += cw; if (h >= 120 && h < 300) cool += cw
    const strip = strips[Math.min(31, Math.floor(x / width * 32))]
    strip.x += Math.cos(h * Math.PI / 180) * cw; strip.y += Math.sin(h * Math.PI / 180) * cw
    strip.chroma += cw; strip.s += s * a; strip.l += l * a; strip.w += a
    seed = Math.imul(seed ^ (Math.round(pixels[i] / 8) + Math.round(pixels[i + 1] / 8) * 32 + Math.round(pixels[i + 2] / 8) * 1024), 16777619) >>> 0
  }
  if (!weight) throw new Error('La imagen es completamente transparente. Elige una imagen con colores visibles.')
  const entropyBits = shannonEntropy(Array.from(histogram)), avgBrightness = light / weight
  const dominantColors = [...groups.values()].sort((a, b) => b.weight - a.weight).slice(0, 6).map(c => {
    const rgb = [c.r, c.g, c.b].map(n => Math.round(n / c.weight))
    return { ...rgbToHsl(...rgb), rgb, hex: '#' + rgb.map(n => n.toString(16).padStart(2, '0')).join(''), weight: c.weight / weight }
  })
  return {
    avgBrightness, avgSaturation: saturation / weight, coolness: chroma ? cool / chroma : .5,
    neutral: chroma / weight < .06, entropy: entropyBits / Math.log2(BIN_COUNT), entropyBits,
    contrast: clamp(Math.sqrt(Math.max(0, light2 / weight - avgBrightness ** 2)) * 2),
    bpm: Math.round(58 + avgBrightness * 42), dominantColors, seed,
    strips: strips.map(c => ({ h: (Math.atan2(c.y, c.x) * 180 / Math.PI + 360) % 360, s: c.w ? c.s / c.w : 0, l: c.w ? c.l / c.w : avgBrightness, weight: c.w / weight, neutral: c.chroma < .01 }))
  }
}
