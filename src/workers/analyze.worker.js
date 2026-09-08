import { analyzePixels } from '../synth/analysis.js'
self.onmessage = async ({ data: { file } }) => {
  let bitmap
  try {
    bitmap = await createImageBitmap(file)
    const { width, height } = bitmap
    const ratio = Math.min(1, 1440 / Math.max(width, height))
    const preview = new OffscreenCanvas(Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)))
    preview.getContext('2d').drawImage(bitmap, 0, 0, preview.width, preview.height)
    bitmap.close(); bitmap = null
    const scale = Math.min(1, 256 / Math.max(width, height))
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)))
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(preview, 0, 0, canvas.width, canvas.height)
    const stats = analyzePixels(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)
    const blob = await preview.convertToBlob({ type: 'image/webp', quality: .88 })
    self.postMessage({ ok: true, stats, blob, width, height })
  } catch (error) {
    self.postMessage({ ok: false, error: error.message })
  } finally { bitmap?.close() }
}
