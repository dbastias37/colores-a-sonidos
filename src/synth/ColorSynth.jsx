import React, { useEffect, useRef, useState } from 'react'
import * as Tone from 'tone'
import { Upload, Play, Pause } from 'lucide-react'

// PERF constants
const PERF = { LOOK_AHEAD: 0.05, MAX_EVENTS_PER_TICK: 10, MAX_SYNTH_VOICES: 8, IMG_MAX_SIZE: 180, SAMPLE_STRIDE: 20, MAX_PARTICLES: 700 }

// Helpers
const hsl = (h,s,l)=>`hsl(${h}, ${Math.round(s*100)}%, ${Math.round(l*100)}%)`
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v))

const SCALES = {
  feliz: {
    ionian:   ['C3','D3','E3','F3','G3','A3','B3','C4'],
    lydian:   ['C3','D3','E3','F#3','G3','A3','B3','C4']
  },
  triste: {
    aeolian:  ['C3','D3','Eb3','F3','G3','Ab3','Bb3','C4'],
    dorian:   ['C3','D3','Eb3','F3','G3','A3','Bb3','C4']
  }
}

function chooseScale(m, d) {
  if (m==='feliz') return d.avgBrightness>0.55 ? SCALES.feliz.lydian : SCALES.feliz.ionian
  return d.avgSaturation>0.45 ? SCALES.triste.dorian : SCALES.triste.aeolian
}

function noteForColor(h, scaleArr){
  if (!scaleArr?.length) return '—'
  const idx = Math.floor((h % 360) / (360/scaleArr.length))
  return scaleArr[idx]
}

export default function ColorSynth(){
  const [imgURL, setImgURL] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [data, setData] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [err, setErr] = useState(null)
  const [showHelp, setShowHelp] = useState(false)

  const [imgRatio, setImgRatio] = useState(16/9)   // ratio por defecto
  const imgBoxRef = useRef(null)

  const mood = data ? (data.coolness < 0.5 ? 'feliz' : 'triste') : 'feliz'
  const scale = data ? chooseScale(mood, data) : []
  const strong = data ? data.dominantColors.filter(c=>c.s>.55 && c.l>.25 && c.l<.8) : []
  const uniqueHues = strong.length ? new Set(strong.map(c=>c.h)).size : 0
  const richness = data ? uniqueHues / Math.max(1, data.dominantColors.length) : 0
  const energy = data ? Math.min(1, 0.4 + data.avgSaturation*0.4 + richness*0.6) : 0
  const caracter = energy > 0.65 ? 'estruendoso' : 'calmo'

  // mixer
  const [mix, setMix] = useState({ drone:-18, pad:-14 })

  const fileRef = useRef(null)
  const canvasRef = useRef(null)
  const preUrlRef = useRef(null)
  const abortRef = useRef({aborted:false})
  const wasPlayingRef = useRef(false)

  // audio nodes/buses
  const fx = useRef({})
  const buses = useRef({})
  const ambient = useRef(null)
  const pad = useRef(null)
  const padLoop = useRef(null)
  const arpLoop = useRef(null)

  // viz
  // --- Visual autónomo: orbes por paleta ---
  const VISIBLE_BOOST = /Mobi|Android/i.test(navigator.userAgent) ? 1.1 : 1.2   // +20% visibilidad
  const portalCanvasRef = useRef(null)   // nodo <canvas> real en el portal
  const rafRef = useRef(null)
  const particlesRef = useRef([])
  const sizeRef = useRef({ w: 0, h: 0 })

  useEffect(()=>{
    // don't start audio yet (mobile policy)
    try { const ctx = Tone.getContext(); ctx.lookAhead = PERF.LOOK_AHEAD; ctx.latencyHint = 'interactive' } catch{}
    const onVis = async () => {
      if (document.visibilityState !== 'visible') { try { Tone.Transport.pause() } catch {} ; stopViz() }
      else if (wasPlayingRef.current) { try { await Tone.context.resume(); Tone.Transport.start() } catch {} }
    }
    document.addEventListener('visibilitychange', onVis)
    return ()=>{ document.removeEventListener('visibilitychange', onVis); hardStop() }
  }, [])

  useEffect(()=>{
    // Monta un canvas una sola vez en #bg-viz-portal
    const portal = document.getElementById('bg-viz-portal')
    if (portal && !portalCanvasRef.current) {
      const c = document.createElement('canvas')
      portal.innerHTML = ''            // limpia cualquier canvas previo
      portal.appendChild(c)
      portalCanvasRef.current = c
    }
    const onResize = () => resizeViz()
    window.addEventListener('resize', onResize)
    return () => {
      stopViz()
      window.removeEventListener('resize', onResize)
      if (portalCanvasRef.current?.parentNode) {
        portalCanvasRef.current.parentNode.removeChild(portalCanvasRef.current)
      }
      portalCanvasRef.current = null
    }
  }, [])

  useEffect(()=>{
    const B = buses.current
    const setDb = (g,db)=>g?.gain?.rampTo(Tone.dbToGain(db),0.05)
    if (!B.drone) return
    setDb(B.drone, mix.drone)
    setDb(B.pad, mix.pad)
  },[mix])

  useEffect(() => {
    const box = imgBoxRef.current
    if (!box) return
    const supportsAspect = CSS?.supports?.('aspect-ratio: 1') ?? true
    if (supportsAspect) return
    const ro = new ResizeObserver(() => {
      const w = box.clientWidth || 0
      box.style.height = w ? `${w / (imgRatio || (16/9))}px` : ''
    })
    ro.observe(box)
    return () => ro.disconnect()
  }, [imgRatio])

  const setupAudioGraph = () => {
    if (fx.current.master) return
    const master = new Tone.Gain(1)
    const makeup = new Tone.Gain(Tone.dbToGain(3)) // ~+3 dB
    const comp = new Tone.Compressor(-20, 3)
    const limiter = new Tone.Limiter(-1)
    master.chain(makeup, comp, limiter, Tone.Destination)
    fx.current = { master, makeup, comp, limiter, reverb: new Tone.Reverb({roomSize:.32, wet:.30}), delay: new Tone.FeedbackDelay({delayTime:'8n', feedback:.20, wet:.12}) }
    buses.current = {
      drone: new Tone.Gain(Tone.dbToGain(mix.drone)),
      pad:   new Tone.Gain(Tone.dbToGain(mix.pad))
    }
    Object.values(buses.current).forEach(b => b.chain(fx.current.delay, fx.current.reverb, fx.current.master))
  }

  // ---------- Image analysis ----------
  const analyzeImage = async (file)=>{
    abortRef.current.aborted = true
    abortRef.current = {aborted:false}
    const local = abortRef.current
    setAnalyzing(true)
    try{
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d', {willReadFrequently:true})
      let bmp=null
      if ('createImageBitmap' in window) bmp = await createImageBitmap(file)
      const w=bmp?bmp.width:await getW(file); const h=bmp?bmp.height:await getH(file)
      const ratio = Math.min(PERF.IMG_MAX_SIZE / w, PERF.IMG_MAX_SIZE / h)
      canvas.width = Math.max(1, Math.floor(w * ratio)); canvas.height = Math.max(1, Math.floor(h * ratio))
      if (bmp) ctx.drawImage(bmp,0,0,canvas.width,canvas.height)
      else { const im = await loadImg(file, local); if (!im) return null; ctx.drawImage(im,0,0,canvas.width,canvas.height) }

      const stats = extractStats(ctx, canvas.width, canvas.height, local)
      const extra = pickHighlights(ctx, canvas.width, canvas.height, stats.dominantColors, local)
      const merged = (stats.dominantColors.concat(extra)).slice(0, 20) // más colores
      const bpm = Math.round(60 + stats.avgBrightness*100)
      const swing = Math.min(.35, Math.max(0, stats.avgSaturation*.3))
      Tone.Transport.swing = swing; Tone.Transport.swingSubdivision='8n'
      const result = {...stats, dominantColors: merged, bpm}
      setData(result)
      return result
    }catch(e){ setErr('Análisis: '+(e.message||String(e))); return null }
    finally{ setAnalyzing(false); if (preUrlRef.current) { URL.revokeObjectURL(preUrlRef.current); preUrlRef.current=null } }
  }

  const loadImg = (file, local)=>new Promise((resolve)=>{
    const img = new Image()
    img.onload = ()=>{ if(!local.aborted) resolve(img) }
    img.onerror = ()=>resolve(null)
    const u = URL.createObjectURL(file)
    if (preUrlRef.current) URL.revokeObjectURL(preUrlRef.current)
    preUrlRef.current = u
    img.src = u
  })
  const getW = (file)=>new Promise(r=>{ const i=new Image(); i.onload=()=>r(i.width); i.src=URL.createObjectURL(file) })
  const getH = (file)=>new Promise(r=>{ const i=new Image(); i.onload=()=>r(i.height); i.src=URL.createObjectURL(file) })

  const extractStats = (ctx,w,h,local)=>{
    const data = ctx.getImageData(0,0,w,h).data
    const stride = Math.max(8, Math.floor(PERF.SAMPLE_STRIDE*2)) * 4  // muestreo más denso
    const bins = new Map()
    let TB=0, TS=0, C=0, cool=0, warm=0, pastel=0, bright=0
    for (let i=0;i<data.length;i+=stride){
      if (local.aborted) break
      const a=data[i+3]; if (a===0) continue
      const r=data[i],g=data[i+1],b=data[i+2]
      const {h:sH, s, l} = rgbToHsl(r,g,b)
      TB+=l; TS+=s; C++
      if (sH>=120 && sH<=300) cool++; else warm++
      if (s<.3 && l>.7) pastel++; else if (s>.7 || l<.3) bright++
      const k = Math.round(sH/6)*6    // bins de 6°
      const e = bins.get(k)
      if (e) { e.weight++; e.s=(e.s+s)/2; e.l=(e.l+l)/2 }
      else bins.set(k,{h:k,s,l,weight:1})
    }
    const groups = Array.from(bins.values()).sort((a,b)=>b.weight-a.weight)
    const dominantColors = groups.slice(0,10)
    const avgBrightness = C? TB/C : .5
    const avgSaturation = C? TS/C : .5
    const coolness = (cool+warm)? cool/(cool+warm) : .5
    const pastelnessRatio = C? pastel/C : 0
    const brightnessRatio = C? bright/C : 0
    const contrast = Math.abs((dominantColors[0]?.l??.5)-(dominantColors[1]?.l??.5))
    const uniqueHues = new Set(dominantColors.map(c=>c.h)).size
    const colorEntropy = dominantColors.length ? uniqueHues/dominantColors.length : .5
    return {dominantColors, avgBrightness, avgSaturation, coolness, pastelnessRatio, brightnessRatio, contrast, colorEntropy}
  }

  const pickHighlights = (ctx,w,h,existing,local)=>{
    const data = ctx.getImageData(0,0,w,h).data
    const stride = PERF.SAMPLE_STRIDE*4
    const out = []; const used = new Set(existing.map(c=>c.h))
    for (let i=0;i<data.length;i+=stride){
      if (local.aborted) break
      const a=data[i+3]; if (a===0) continue
      const r=data[i],g=data[i+1],b=data[i+2]
      const {h,s,l} = rgbToHsl(r,g,b)
      if ((l>.75 && s>.5) || (l>.6 && s>.75)) { const k=Math.round(h/12)*12; if(!used.has(k)){ used.add(k); out.push({h:k,s,l,weight:1}); if(out.length>=8) break } }
    }
    return out
  }

  const rgbToHsl = (r,g,b)=>{
    r/=255; g/=255; b/=255;
    const max=Math.max(r,g,b), min=Math.min(r,g,b);
    let h,s,l=(max+min)/2;
    if(max===min){h=s=0}
    else{
      const d=max-min; s=l>0.5? d/(2-max-min) : d/(max+min);
      switch(max){
        case r: h=(g-b)/d + (g<b?6:0); break;
        case g: h=(b-r)/d + 2; break;
        case b: h=(r-g)/d + 4; break;
      } h/=6;
    }
    return {h:h*360, s, l}
  }

  const setupFromData = async (d)=>{
    try{
      setErr(null)
      await Tone.start()
      setupAudioGraph()

      softStop()

      const mood = (d.coolness < 0.5) ? 'feliz' : 'triste'
      const strong = d.dominantColors.filter(c=>c.s>.55 && c.l>.25 && c.l<.8)
      const uniqueHues = new Set(strong.map(c=>c.h)).size
      const richness = uniqueHues / Math.max(1, d.dominantColors.length)
      const energy = Math.min(1, 0.4 + d.avgSaturation*0.4 + richness*0.6)

      Tone.Transport.bpm.rampTo(d.bpm, .15)
      Tone.Transport.swing = Math.min(.35, Math.max(0, d.avgSaturation*.3))
      Tone.Transport.swingSubdivision = '8n'

      ambient.current = new Tone.Synth({
        oscillator:{ type:'sine' },
        envelope:{ attack:2.5, decay:1.2, sustain:.9, release:3.5 }
      })
      const lp = new Tone.Filter({ frequency: 900 + energy*600, type:'lowpass' })
      ambient.current.chain(lp, buses.current.drone)
      ambient.current.volume.value = -18
      ambient.current.triggerAttack((mood==='feliz')?'C2':'G1')

      const padVoices = Math.round(4 + energy*2)
      pad.current = new Tone.PolySynth(Tone.AMSynth, {
        maxPolyphony: padVoices,
        volume: Tone.gainToDb(0.4),
        options: { envelope:{ attack:1.2, decay:1, sustain:.9, release:4.2 } }
      }).connect(buses.current.pad)

      const scale = chooseScale(mood, d)
      const hueToDegree = h => Math.floor((h % 360) / (360/scale.length))
      const rootIdx = hueToDegree(d.dominantColors[0]?.h || 0)
      const root = Tone.Frequency(scale[rootIdx]).toNote()

      function chordFrom(rootNote, m, e) {
        const f = Tone.Frequency(rootNote)
        const intervals = (m==='feliz')
          ? [0, 4, 7, (e>.6? 11:9)]        // maj7 / add9
          : [0, 3, 7, (e>.6? 10:9)]        // min7 / add9
        if (Math.random()<.5) intervals[0] -= 12
        if (Math.random()<.35) intervals.push(14) // add 6th/13th
        return intervals.map(semi => f.transpose(semi).toNote())
      }

      padLoop.current?.dispose?.()
      padLoop.current = new Tone.Loop((time)=>{
        const base = chordFrom(root, mood, energy)
        const alt = d.dominantColors[1]?.h
        const shift = alt ? ((alt%120)<60 ? 0 : 2) : 0
        const chord = base.map(n => Tone.Frequency(n).transpose(shift).toNote())
        chord.forEach(n=>{
          const nudge = (Math.random()-.5)*0.03
          pad.current.triggerAttackRelease(n, '2n', time+nudge, 0.7)
        })
      }, Math.max(5.5, 9 - energy*4)).start(0)

      arpLoop.current?.dispose?.()
      arpLoop.current = new Tone.Loop((time)=>{
        const base = chordFrom(root, mood, energy)
        const n = base[(Math.random()*base.length)|0]
        const durn = (Math.random()<.5)?'8n':'4n'
        const nudge = (Math.random()-.5)*0.02
        pad.current.triggerAttackRelease(n, durn, time+nudge, 0.45)
      }, Math.max(.28, .5 - energy*.25)).start(0)

      return true
    }catch(e){ setErr(e.message||String(e)); return false }
  }


  // ---------- UI actions ----------
  const onImgLoad = (e) => {
    const w = e.target.naturalWidth || 1
    const h = e.target.naturalHeight || 1
    const r = Math.max(0.1, Math.min(10, w / h))
    setImgRatio(r)
  }

  const onUpload = async (e)=>{
    const f = e.target.files?.[0]; if (!f||!f.type.startsWith('image/')) return
    if (imgURL) URL.revokeObjectURL(imgURL)
    setImgURL(URL.createObjectURL(f))
    stopAll()
    const d = await analyzeImage(f); if (!d) return
  }

  const togglePlay = async ()=>{
    if (!data) return
    if (playing){ stopAll(); stopViz(); Tone.Transport.stop(); setPlaying(false); wasPlayingRef.current=false; return }
    const ok = await setupFromData(data)
    if (ok){ startViz(); Tone.Transport.start(); setPlaying(true); wasPlayingRef.current=true; }
  }

  const testAudio = async ()=>{
    try{ await Tone.start(); const t=new Tone.Synth().toDestination(); t.triggerAttackRelease('C4','8n'); setTimeout(()=>t.dispose(),400) }catch(e){ setErr('Audio: '+e.message) }
  }

  // cleanup helpers
  const stopAll = ()=>{
    try{ padLoop.current?.dispose?.(); padLoop.current=null }catch{}
    try{ arpLoop.current?.dispose?.(); arpLoop.current=null }catch{}
    if (ambient.current){ try{ ambient.current.triggerRelease?.(); ambient.current.dispose?.() }catch{}; ambient.current=null }
    if (pad.current){ try{ pad.current.dispose?.() }catch{}; pad.current=null }
  }
  const softStop = ()=> stopAll()
  const hardStop = ()=>{ stopAll(); try{ Tone.Transport.stop(); Tone.Transport.cancel(0) }catch{}; stopViz(); if(preUrlRef.current){ URL.revokeObjectURL(preUrlRef.current); preUrlRef.current=null } }

  const startViz = () => {
    const c = portalCanvasRef.current
    if (!c) return
    resizeViz()
    const ctx = c.getContext('2d', { alpha: true })
    const PI2 = Math.PI * 2
    cancelAnimationFrame(rafRef.current)
    particlesRef.current.length = 0
    if (data?.dominantColors) {
      data.dominantColors.forEach(c=>emit(c.h, c.s, c.l, 0.6))
    }

    const loop = (ts) => {
      const { w, h } = sizeRef.current
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = 'rgba(4, 8, 20, 0.08)' // ~20% menos opaco
      ctx.fillRect(0, 0, w, h)

      // “viento” muy leve y +5% movimiento
      const t = ts * 0.0003
      const windXBase = Math.sin(t) * 0.15
      const windYBase = Math.cos(t * 0.8) * 0.10
      const speedScale = 1.05

      if (data?.dominantColors && Math.random() < 0.08) {
        const c = data.dominantColors[(Math.random()*data.dominantColors.length)|0]
        emit(c.h, c.s, c.l, 0.5)
      }

      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i]
        const windX = windXBase + Math.sin(p.y * 0.002 + t * 0.6) * 0.08
        const windY = windYBase + Math.cos(p.x * 0.002 - t * 0.4) * 0.06
        p.vx += windX * 0.02
        p.vy += windY * 0.02

        p.x += p.vx * speedScale
        p.y += p.vy * speedScale
        p.life -= 0.012
        p.r = p.baseR * (0.92 + 0.08 * Math.sin(t * 2 + p.pulsePhase))

        if (p.life <= 0 || p.r <= 0.6 || p.x < -40 || p.y < -40 || p.x > w + 40 || p.y > h + 40) {
          particlesRef.current.splice(i, 1)
          continue
        }

        // mezcla aditiva para más brillo suaves (glow)
        ctx.globalCompositeOperation = 'lighter'
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r)
        g.addColorStop(0, `hsla(${p.h|0}, ${Math.round(p.s*100)}%, ${Math.round(p.l*100)}%, ${Math.min(0.6, 0.35 * p.intensity * VISIBLE_BOOST)})`)
        g.addColorStop(1, `hsla(${p.h|0}, ${Math.round(p.s*100)}%, ${Math.round(p.l*100)}%, 0)`)
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, PI2)
        ctx.fill()
      }

      // cota
      const MAX = 700
      if (particlesRef.current.length > MAX) {
        particlesRef.current.splice(0, particlesRef.current.length - MAX)
      }
      // vuelve al modo normal para el próximo velo
      ctx.globalCompositeOperation = 'source-over'
      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
  }

  const stopViz = () => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    particlesRef.current.length = 0
  }

  const resizeViz = () => {
    const c = portalCanvasRef.current
    if (!c) return
    const scale = 0.66
    c.width = Math.floor(window.innerWidth * scale)
    c.height = Math.floor(window.innerHeight * scale)
    sizeRef.current = { w: c.width, h: c.height }
  }

  // Emisor de orbes: llama con h,s,l,intensity desde tus disparos musicales
  const emit = (h, s, l, intensity = 0.5) => {
    const { w, h: H } = sizeRef.current
    if (!w || !H) return
    const side = Math.random()
    let x, y, vx, vy
    if (side < 0.25) { x = -20; y = Math.random() * H; vx = 0.6 + Math.random() * 0.6; vy = (Math.random() - 0.5) * 0.4 }
    else if (side < 0.5) { x = w + 20; y = Math.random() * H; vx = -(0.6 + Math.random() * 0.6); vy = (Math.random() - 0.5) * 0.4 }
    else if (side < 0.75) { x = Math.random() * w; y = -20; vx = (Math.random() - 0.5) * 0.4; vy = 0.6 + Math.random() * 0.6 }
    else { x = Math.random() * w; y = H + 20; vx = (Math.random() - 0.5) * 0.4; vy = -(0.6 + Math.random() * 0.6) }

    const baseR = 10 + intensity * 22 * (0.6 + Math.random() * 0.8)
    particlesRef.current.push({
      x, y, vx, vy,
      r: baseR, baseR,
      life: 1.3 + intensity * 0.9,
      pulsePhase: Math.random() * Math.PI * 2,
      h, s, l, intensity
    })
  }

  return (
    <div className="container">
      <header className="header">
        <h1 className="h1">Sintetizador de Colores</h1>
        <p className="p">Convierte tus imágenes en sonido ambiental…</p>
        <button className="btn secondary" onClick={()=>setShowHelp(true)}>¿Cómo funciona?</button>
      </header>

      <section className="grid">
        <div className="grid-2">
          <div className="card">
            <h3>Imagen</h3>
            {!imgURL ? (
              <div>
                <button className="btn secondary" onClick={()=>fileRef.current?.click()}><Upload size={18}/> Elegir imagen</button>
                <input ref={fileRef} type="file" accept="image/*" onChange={onUpload} style={{display:'none'}}/>
              </div>
            ):(
              <div>
                <div ref={imgBoxRef} className="imgBox" style={{ '--ratio': imgRatio }}>
                  <img className="img" src={imgURL} alt="subida" onLoad={onImgLoad}/>
                </div>
                <div className="row" style={{marginTop:10}}>
                  <button className="btn secondary" onClick={()=>{ if(imgURL) URL.revokeObjectURL(imgURL); setImgURL(null); setData(null); stopAll(); stopViz(); if(fileRef.current) fileRef.current.value='' }}>Subir otra</button>
                  {/* Visual se maneja automáticamente al reproducir/detener */}
                </div>
              </div>
            )}
            <hr className="hr"/>
            <button className="btn blue" onClick={async()=>{ try{ await testAudio() }catch{} }}>🔊 Probar audio</button>
          </div>

          {data && (
            <div className="card" style={{marginTop:18}}>
              <h3>Controles</h3>
              <div className="row" style={{margin:'10px 0'}}>
                <button className={"btn "+(playing?'red':'')} onClick={togglePlay}>{playing? <><Pause size={18}/> Detener</> : <><Play size={18}/> Reproducir</>}</button>
              </div>
              <div className="small">BPM: {data.bpm} • Brillo: {Math.round(data.avgBrightness*100)}% • Saturación: {Math.round(data.avgSaturation*100)}%</div>
              <div className="row" style={{flexWrap:'wrap', marginTop:8, gap:12}}>
                {Object.entries(mix).map(([k,v])=>(
                  <div key={k} style={{minWidth:200}}>
                    <label className="label">{k.replace(/([A-Z])/g,' $1')}: {v} dB</label>
                    <input className="range" type="range" min="-60" max="0" value={v} onChange={(e)=>setMix(m=>({...m,[k]:parseInt(e.target.value)}))}/>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="grid-2">
          {data ? (
            <>
              <div className="card">
                <h3>Análisis</h3>
                <div className="small">Frialdad: {Math.round(data.coolness*100)}% • Pastel: {Math.round(data.pastelnessRatio*100)}% • Contraste: {Math.round(data.contrast*100)}% • Entropía: {Math.round(data.colorEntropy*100)}% • Carácter: {caracter}</div>
                <div className="colors" style={{marginTop:10}}>
                  {data.dominantColors.slice(0,12).map((c,i)=>(<div key={i} title={`h:${c.h} s:${Math.round(c.s*100)} l:${Math.round(c.l*100)}`} className="colorSwatch" style={{background:hsl(c.h,c.s,c.l)}}/>))}
                </div>
              </div>
              <div className="card" style={{marginTop:18}}>
                <h3>Colores → Notas / Escala</h3>
                <div className="colors" style={{marginTop:10}}>
                  {data.dominantColors.slice(0,12).map((c,i)=>(
                    <div key={i} className="colorSwatch" title={`h:${c.h}`}>
                      <div style={{
                        height:'42px', borderRadius:'10px', border:'1px solid #374151',
                        background:`hsl(${c.h} ${c.s*100}% ${c.l*100}%)`
                      }} />
                      <div className="small">
                        {noteForColor(c.h, scale)} • {mood==='feliz' ? (data.avgBrightness>0.55?'Lidia':'Jónica') : (data.avgSaturation>0.45?'Dórica':'Eólica')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ):(
            <div className="card"><h3>¿Cómo funciona?</h3><p className="small">Brillo→BPM, color cálido/frío→escala feliz/triste, riqueza→energía, contraste→filtros. Pulsa “¿Cómo funciona?” para más detalles.</p></div>
          )}
          {err && <div className="card" style={{marginTop:18, borderColor:'#b91c1c'}}><strong>Error:</strong> <span className="small">{String(err)}</span></div>}
        </div>
      </section>

      <footer className="footer">Web App creada por Claude y corregida por Codex de Chat GPT con ideas de Diego Bastías A.  Agosto 2025</footer>
      <canvas ref={canvasRef} style={{display:'none'}}/>
      {showHelp && (
        <div style={{position:'fixed',inset:0,zIndex:60,background:'rgba(0,0,0,.45)',display:'grid',placeItems:'center'}} onClick={()=>setShowHelp(false)}>
          <div className="card" style={{maxWidth:780, width:'92%', padding:'18px 20px'}} onClick={(e)=>e.stopPropagation()}>
            <h3 style={{margin:'0 0 8px'}}>Cómo funciona</h3>

            <div className="p" style={{textAlign:'left', lineHeight:1.55}}>
              <p><strong>Propósito.</strong> Esta herramienta experimental busca <em>expandir el mundo sonoro</em> traduciendo imágenes a <strong>armonías y texturas</strong>. Lo hace mediante <strong>asimilaciones de acordes</strong> y reglas <strong>matemático–musicales</strong>: así como el <em>matiz</em> del color es un ángulo en un círculo (0–360°), la <em>altura musical</em> se organiza en un ciclo de 12 pasos (octava). Ambos son espacios cíclicos, por eso podemos asociar un tono de color con un grado de una escala.</p>

              <h4 style={{margin:'14px 0 6px'}}>¿Qué medimos en la imagen?</h4>
              <ul style={{margin:'0 0 10px 18px'}}>
                <li><strong>N.º de colores</strong> (<code>N_col</code>): agrupamos el matiz en <code>bins</code> de 6° y contamos cuántos grupos relevantes hay.</li>
                <li><strong>Brillo promedio</strong> (<code>L</code>, 0–1): desde el canal de luminancia (HSL).</li>
                <li><strong>Saturación promedio</strong> (<code>S</code>, 0–1): cuánta “pureza” cromática hay.</li>
                <li><strong>Claridad / Contraste</strong>: diferencia de luminosidad entre colores dominantes.</li>
                <li><strong>Entropía de color</strong> (<code>H</code>, 0–100%): dispersión del histograma de matices; más entropía = paleta más diversa.</li>
                <li><strong>Colores fuertes</strong>: aquellos con <code>S &gt; 0.55</code> y <code>0.25 &lt; L &lt; 0.8</code>.</li>
              </ul>

              <h4 style={{margin:'12px 0 6px'}}>Color → Música (intuición matemática)</h4>
              <ul style={{margin:'0 0 10px 18px'}}>
                <li><strong>Matiz → Grado de escala</strong>: si la escala tiene <code>M</code> notas, usamos
                  <br/><code>i = round((h / 360) * M) mod M</code>, y mapeamos al grado <code>scale[i]</code>.
                </li>
                <li><strong>Saturación → Brillo/actividad del Pad</strong>: mayor <code>S</code> ⇒ más movimiento (micro–arpegios) y timbre un poco más “abierto”.</li>
                <li><strong>Brillo → BPM</strong>: <code>BPM = round(60 + L * 100)</code> (≈ 60–160). Imágenes más claras ⇒ más ágiles.</li>
                <li><strong>Temperatura (cálido/frío) → Modo feliz/triste</strong>:
                  <ul>
                    <li>Predominan cálidos ⇒ <em>feliz</em>: Jónica/Lidia (mayor, más luminosa).</li>
                    <li>Predominan fríos ⇒ <em>triste</em>: Eólica/Dórica (menor, más introspectiva).</li>
                  </ul>
                </li>
                <li><strong>Riqueza cromática (entropía + n.º de colores fuertes) → Carácter</strong>:
                  <ul>
                    <li>Alta riqueza ⇒ <em>más estruendoso</em> (más densidad armónica dentro del ambient).</li>
                    <li>Baja riqueza ⇒ <em>más calmo</em> (ciclos largos y estables).</li>
                  </ul>
                </li>
              </ul>

              <h4 style={{margin:'12px 0 6px'}}>Reglas prácticas (si… entonces…)</h4>
              <ul style={{margin:'0 0 10px 18px'}}>
                <li><strong>Si la imagen tiene muchos colores fuertes</strong> (<code>N_col</code> alto y <code>H</code> &gt; 60%) ⇒ el Pad agrega tensiones (6/9/7) y micro–arpegios un poco más frecuentes, pero sin salir del sonido ambiental.</li>
                <li><strong>Si la imagen es oscura</strong> (<code>L</code> &lt; 0.4) ⇒ BPM cercanos a 60–80, acordes más sostenidos.</li>
                <li><strong>Si la imagen es muy clara</strong> (<code>L</code> ≥ 0.6) ⇒ BPM cercanos a 120–150, respiración del filtro más rápida.</li>
                <li><strong>Si dominan tonos fríos</strong> ⇒ modo menor (Eólica/Dórica); <strong>si dominan cálidos</strong> ⇒ modo mayor (Jónica/Lidia).</li>
                <li><strong>Si el contraste es alto</strong> ⇒ más “profundidad” del filtro del Drone para resaltar capas.</li>
              </ul>

              <h4 style={{margin:'12px 0 6px'}}>De un color a una nota (resumen)</h4>
              <p>Tomamos el <em>ángulo</em> del color (<code>h</code>) en el círculo cromático y lo proyectamos al círculo musical (la escala elegida). Al ser ambos <em>ciclos</em>, la asociación es coherente: <code>h</code> se convierte en un <em>grado</em> que el Pad toca dentro del modo (<em>feliz</em> o <em>triste</em>). El Drone sostiene la raíz grave y “respira” con filtro, de modo que todo permanezca <strong>ambiental</strong> pero con <strong>dinamismo musical</strong>.</p>

              <div style={{marginTop:10, fontSize:12, opacity:.85}}>
                <em>Nota:</em> esta es una aproximación artística–matemática; no “colorea” grabaciones existentes, sino que <strong>compone</strong> un paisaje sonoro a partir de la paleta de tu imagen.
              </div>
            </div>

            <div style={{textAlign:'right', marginTop:12}}>
              <button className="btn" onClick={()=>setShowHelp(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
