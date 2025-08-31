// Análisis ligero en hilo aparte
self.onmessage = async (e) => {
  try {
    const { fileOrBitmap, maxSize = 512 } = e.data
    let bmp = fileOrBitmap
    if (!(bmp instanceof ImageBitmap)) {
      // decode fuera del main thread
      bmp = await createImageBitmap(fileOrBitmap, { resizeWidth: maxSize, resizeHeight: maxSize, resizeQuality: 'high' })
    }
    const off = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = off.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(bmp, 0, 0)
    const { width, height } = off
    const img = ctx.getImageData(0, 0, width, height).data

    // muestreo denso pero eficiente
    const stride = 16 // cada 4 píxeles (RGBA*4)
    let totL = 0, totS = 0, count = 0
    const bins = new Map() // hue bin de 6°
    const hi = []

    for (let i = 0; i < img.length; i += stride) {
      const a = img[i+3]; if (a === 0) continue
      const r = img[i], g = img[i+1], b = img[i+2]
      // rgb→hsl
      const R=r/255,G=g/255,B=b/255
      const max=Math.max(R,G,B), min=Math.min(R,G,B)
      const l=(max+min)/2
      let h=0,s=0
      if (max!==min){
        const d=max-min
        s=l>0.5? d/(2-max-min): d/(max+min)
        switch(max){
          case R:h=(G-B)/d+(G<B?6:0);break
          case G:h=(B-R)/d+2;break
          case B:h=(R-G)/d+4;break
        }
        h=h/6
      }
      const H = (h*360)|0
      totL += l; totS += s; count++

      const k = Math.round(H/6)*6
      const v = bins.get(k) || { h:k, s:0, l:0, w:0 }
      v.w++; v.s = (v.s + s)*0.5; v.l = (v.l + l)*0.5
      bins.set(k, v)

      // acentos brillantes adicionales
      if ((s>0.6 && l>0.55) || (s>0.5 && l>0.7)) {
        hi.push({h:H,s,l,w:1})
      }
    }

    const arr = Array.from(bins.values()).sort((a,b)=>b.w-a.w)
    const dominant = arr.slice(0, 20)
    // highlights extra (top 8)
    hi.sort((a,b)=>(b.s*b.l)-(a.s*a.l))
    const extra = hi.slice(0, 8)

    const cool = arr.filter(c=> (c.h>=160 && c.h<=300)).length
    const warm = arr.length - cool
    const avgL = totL / Math.max(1,count)
    const avgS = totS / Math.max(1,count)
    const ent = Math.min(1, arr.length/60) // proxy rápida

    postMessage({
      ok:true,
      data:{
        avgBrightness: avgL,
        avgSaturation: avgS,
        coolness: cool/Math.max(1,(cool+warm)),
        pastelnessRatio: 0, // no se usa aquí
        brightnessRatio: 0, // no se usa aquí
        dominantColors: dominant.concat(extra).slice(0,24),
        bpm: Math.round(60 + avgL*100),
        contrast: Math.abs((dominant[0]?.l||.5)-(dominant[1]?.l||.5)),
        entropy: ent
      }
    })
  } catch (err) {
    postMessage({ ok:false, error: String(err?.message||err) })
  }
}
