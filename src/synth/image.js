import { analyzePixels } from './analysis.js'
const aborted = () => new DOMException('Carga cancelada', 'AbortError')
export async function readImage(file, signal) {
  if (signal.aborted) throw aborted()
  if (file.size > 30 * 1024 * 1024) throw new Error('La imagen supera los 30 MB. Usa una versión más pequeña.')
  if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined') {
    try {
      return await new Promise((resolve, reject) => {
        const worker = new Worker(new URL('../workers/analyze.worker.js', import.meta.url), { type: 'module' })
        const finish = (error, value) => { clearTimeout(timer); signal.removeEventListener('abort', cancel); worker.terminate(); error ? reject(error) : resolve(value) }
        const cancel = () => finish(aborted())
        const timer = setTimeout(() => finish(new Error('Tiempo de análisis agotado.')), 20000)
        signal.addEventListener('abort', cancel, { once: true })
        worker.onmessage = ({ data }) => finish(data.ok ? null : new Error(data.error), data)
        worker.onerror = () => finish(new Error('No se pudo analizar en segundo plano.'))
        worker.postMessage({ file })
      })
    } catch (error) { if (signal.aborted || error.name === 'AbortError') throw aborted() }
  }
  // Older Safari fallback: identical math, with a small canvas and released URL.
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise((resolve, reject) => {
      const im = new Image()
      const finish = (error) => { clearTimeout(timer); signal.removeEventListener('abort', cancel); im.onload = im.onerror = null; if (error) { im.src = ''; reject(error) } else resolve(im) }
      const cancel = () => finish(aborted())
      const timer = setTimeout(() => finish(new Error('No se pudo abrir la imagen. Prueba JPG, PNG o WebP.')), 20000)
      signal.addEventListener('abort', cancel, { once: true })
      im.onload = () => finish(); im.onerror = () => finish(new Error('No se pudo abrir la imagen. Prueba JPG, PNG o WebP.')); im.src = url
    })
    if (signal.aborted) throw aborted()
    const width = image.naturalWidth, height = image.naturalHeight, ratio = Math.min(1, 1440 / Math.max(width, height))
    const preview = document.createElement('canvas'); preview.width = Math.max(1, Math.round(width * ratio)); preview.height = Math.max(1, Math.round(height * ratio))
    preview.getContext('2d').drawImage(image, 0, 0, preview.width, preview.height)
    const scale = Math.min(1, 256 / Math.max(width, height)), canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale))
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(preview, 0, 0, canvas.width, canvas.height)
    const stats = analyzePixels(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)
    const blob = await new Promise(resolve => preview.toBlob(resolve, 'image/webp', .88))
    if (!blob) throw new Error('No se pudo preparar la imagen.')
    if (signal.aborted) throw aborted()
    return { stats, blob, width, height }
  } finally { URL.revokeObjectURL(url) }
}
