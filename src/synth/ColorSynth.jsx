import React, { useEffect, useRef, useState } from 'react'
import * as Tone from 'tone'
import { Upload, Play, Pause } from 'lucide-react'

// PERF constants
const PERF = { LOOK_AHEAD: 0.10, MAX_EVENTS_PER_TICK: 10, MAX_SYNTH_VOICES: 8, IMG_MAX_SIZE: 180, SAMPLE_STRIDE: 20, MAX_PARTICLES: 700 }

// Helpers
const hsl = (h,s,l)=>`hsl(${h}, ${Math.round(s*100)}%, ${Math.round(l*100)}%)`
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v))

const SCALES_OFFSETS = {
  ionian:        [0,2,4,5,7,9,11],        // mayor
  lydian:        [0,2,4,6,7,9,11],        // #4
  mixolydian:    [0,2,4,5,7,9,10],        // b7
  dorian:        [0,2,3,5,7,9,10],        // menor + 6
  aeolian:       [0,2,3,5,7,8,10],        // natural minor
  phrygian:      [0,1,3,5,7,8,10],        // b2
  melodicMinor:  [0,2,3,5,7,9,11],        // menor melódica asc.
  majorPent:     [0,2,4,7,9],
  minorPent:     [0,3,5,7,10]
}

function offsetsForHue(h, mood){
  h = ((h%360)+360)%360
  if (h < 30)    return merge([SCALES_OFFSETS.lydian, SCALES_OFFSETS.ionian, SCALES_OFFSETS.majorPent])
  if (h < 60)    return merge([SCALES_OFFSETS.ionian, SCALES_OFFSETS.mixolydian, SCALES_OFFSETS.majorPent])
  if (h < 120)   return merge([SCALES_OFFSETS.mixolydian, SCALES_OFFSETS.ionian])
  if (h < 180)   return merge([SCALES_OFFSETS.dorian, SCALES_OFFSETS.minorPent])      // verdes
  if (h < 210)   return merge([SCALES_OFFSETS.aeolian, SCALES_OFFSETS.dorian])        // cian/teal
  if (h < 255)   return merge([SCALES_OFFSETS.phrygian, SCALES_OFFSETS.aeolian])      // azules
  if (h < 315)   return merge([SCALES_OFFSETS.melodicMinor, SCALES_OFFSETS.dorian])   // púrpuras/magenta
  return            merge([SCALES_OFFSETS.lydian, SCALES_OFFSETS.ionian])
}

function merge(arrOfOffsets){
  const s = new Set()
  arrOfOffsets.flat().forEach(o=>s.add(o))
  return Array.from(s).sort((a,b)=>a-b)
}

function buildScaleFromOffsets(rootNote, offsets){
  const f = Tone.Frequency(rootNote)
  return offsets.map(semi => f.transpose(semi).toNote())
}

function noteForColor(h, pool){
  if (!pool?.length) return '—'
  const idx = Math.floor((h % 360) / (360/pool.length))
  return pool[idx]
}

// --- Escala: helpers para forzar notas a la tonalidad ---
function expandPool(oneOctavePool, octavesUp = 4, octavesDown = 3){
  const out = []
  for (let o=-octavesDown; o<=octavesUp; o++){
    oneOctavePool.forEach(n => out.push(Tone.Frequency(n).transpose(o*12).toNote()))
  }
  return out
}

function nearestInPool(note, pool){
  if (!pool?.length) return note
  const hz = Tone.Frequency(note).toFrequency()
  let best = pool[0], bestDiff = Infinity
  for (const n of pool){
    const d = Math.abs(Tone.Frequency(n).toFrequency() - hz)
    if (d < bestDiff){ best = n; bestDiff = d }
  }
  return best
}

function stepsAboveInPool(note, pool, steps = 1){
  if (!pool?.length) return note
  const hz = Tone.Frequency(note).toFrequency()
  let idx = 0, bestDiff = Infinity
  pool.forEach((n,i)=>{
    const d = Math.abs(Tone.Frequency(n).toFrequency() - hz)
    if (d < bestDiff){ bestDiff = d; idx = i }
  })
  const t = Math.min(pool.length - 1, idx + steps)
  return pool[t]
}

// ---------- Director de Armonía ----------
const HARM = {
  // offsets diatónicos / modales
  SCALES: {
    ionian:       [0,2,4,5,7,9,11],
    lydian:       [0,2,4,6,7,9,11],
    mixolydian:   [0,2,4,5,7,9,10],
    dorian:       [0,2,3,5,7,9,10],
    aeolian:      [0,2,3,5,7,8,10],
    phrygian:     [0,1,3,5,7,8,10],
    melodicMinor: [0,2,3,5,7,9,11],
  },
  // progresiones por modo (grados romanos)
  PROG: {
    mayor: [
      ['I','vi','IV','V'],
      ['I','V','vi','IV'],
      ['I','III','vi','IV'],
      ['I','ii','V','I'],
    ],
    menor: [
      ['i','VI','III','VII'],
      ['i','iv','VII','III'],
      ['i','ii°','V','i'],
      ['i','VII','VI','VII'],
    ],
    modalWarm: [
      ['I','II','V','I'],
      ['I','V','II','I'],
    ],
    modalCool: [
      ['i','VII','IV','i'],
      ['i','IV','VII','i'],
    ],
  },
  DEG: {
    'I':  [0,4,7,11], 'ii':[2,5,9], 'ii°':[2,5,8], 'iii':[4,7,11],
    'IV':[5,9,12], 'V':[7,11,14], 'vi':[9,12,16], 'vii°':[11,14,17],
    'i':[0,3,7,10], 'iv':[5,8,12], 'v':[7,10,14], 'VI':[8,12,15],
    'III':[3,7,10], 'VII':[10,14,17], 'II':[2,6,9]
  }
}

function hueFamily(h){
  h = ((h%360)+360)%360
  if (h<30) return 'mayor'
  if (h<90) return 'modalWarm'
  if (h<150) return 'mayor'
  if (h<210) return 'modalCool'
  if (h<270) return 'menor'
  if (h<330) return 'modalCool'
  return 'mayor'
}

function chooseProgression(data){
  const hA = data.dominantColors?.[0]?.h ?? 0
  const fam = hueFamily(hA)
  const bank = HARM.PROG[fam==='mayor'?'mayor':(fam==='menor'?'menor':(fam==='modalCool'?'modalCool':'modalWarm'))]
  return bank[(Math.random()*bank.length)|0]
}

// raíz global a partir del mood
function globalRoot(mood){ return (mood==='feliz') ? 'C3' : 'A2' }

// construye notas del acorde con voz conducida cerca del registro previo
function chordNotesFromDegree(rootNote, degree, addTension=true, prevVoices=[], pool=null){
  const f = Tone.Frequency(rootNote)
  const offs = HARM.DEG[degree] || [0,4,7]
  const chord = offs.map(semi => f.transpose(semi).toNote())

  // Tensiones más seguras: 9 y 13 (evitamos 11 salvo modo Lydian)
  if (addTension && Math.random()<.6) {
    const tChoices = [9,14]
    let tNote = f.transpose(tChoices[(Math.random()*tChoices.length)|0]).toNote()
    if (pool) tNote = nearestInPool(tNote, pool)
    chord.push(tNote)
  }

  const target = []
  chord.forEach(n=>{
    const Hz = Tone.Frequency(n).toFrequency()
    const prevHz = prevVoices.length
      ? prevVoices.reduce((a,b)=>a+Tone.Frequency(b).toFrequency(),0)/prevVoices.length
      : Hz
    let m = Hz
    while (m < prevHz-300) m *= 2
    while (m > prevHz+300) m /= 2
    let note = Tone.Frequency(m).toNote()
    if (pool) note = nearestInPool(note, pool)
    target.push(note)
  })
  return target.slice(0, 4)
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
  const strong = data ? data.dominantColors.filter(c=>c.s>.55 && c.l>.25 && c.l<.8) : []
  const uniqueHues = strong.length ? new Set(strong.map(c=>c.h)).size : 0
  const richness = data ? uniqueHues / Math.max(1, data.dominantColors.length) : 0
  const energy = data ? Math.min(1, 0.4 + data.avgSaturation*0.4 + richness*0.6) : 0
  const caracter = energy > 0.65 ? 'estruendoso' : 'calmo'
  const rootNote = (mood==='feliz')?'C3':'A2'
  const scalePool = data ? (()=>{ const hA = data.dominantColors[0]?.h ?? 0; const hB = data.dominantColors[1]?.h ?? hA; const offs = merge([ offsetsForHue(hA, mood), offsetsForHue(hB, mood) ]); return buildScaleFromOffsets(rootNote, offs) })() : []
  // Pool diatónico extendido a varias octavas para “lock” absoluto
  const diatonicPool = expandPool(scalePool, 4, 3)

  // mixer
  const [mix, setMix] = useState({ drone:-12, pad:-8 })
  const busGainsRef = useRef({ drone: null, pad: null })

  function applyUserMix(key, db){ // llamado SOLO desde onChange del slider
    const node = busGainsRef.current[key]
    if (node) node.gain.value = Tone.dbToGain(db)
  }

  const fileRef = useRef(null)
  const canvasRef = useRef(null)
  const preUrlRef = useRef(null)
  const abortRef = useRef({aborted:false})
  const wasPlayingRef = useRef(false)
  const isResettingRef = useRef(false)
  const prerollRef   = useRef({ buffer:null, player:null })
  const xfadeRef     = useRef({ a:null, b:null })  // buses de crossfade
  const masterLiveRef= useRef(null)                // salida del motor vivo

  // audio nodes/buses
  const fx = useRef({})
  const buses = useRef({})
  const ambient = useRef(null)
  const pad = useRef(null)
  const padLoop = useRef(null)
  const breathLoop = useRef(null)
  const arpLoop = useRef(null)
  const barRef = useRef({ idx:0, degreeCycle:[], heldHue:null, heldScale:null, prevVoices:[] })
  const extraRefs = useRef({})

  // viz
  // --- Visual autónomo: orbes por paleta ---
  const VISIBLE_BOOST = /Mobi|Android/i.test(navigator.userAgent) ? 1.1 : 1.2   // +20% visibilidad
  const portalCanvasRef = useRef(null)   // nodo <canvas> real en el portal
  const rafRef = useRef(null)
  const particlesRef = useRef([])
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 })
  const ctxRef = useRef(null)
  const vizStateRef = useRef({ running:false, lastTime:0, _acc:0 })
  const poolRef = useRef([])
  const workerRef = useRef(null)

  // ---------- helpers de dispose ----------
  function safeDispose(node){ try{ node?.dispose?.() }catch{} }
  function disconnect(node){ try{ node?.disconnect?.() }catch{} }

  // Limpia el canvas del portal
  function clearPortalCanvas(){
    try{
      const c = portalCanvasRef?.current
      if (c){
        const ctx = c.getContext('2d')
        ctx?.clearRect(0,0,c.width,c.height)
      }
    }catch{}
  }

  const SPR = {
    RADII: [12, 16, 20, 24, 28, 32],
    CACHE: new Map(),
  }
  function spriteKey(h,s,l,r){ return `${Math.round(h)}|${Math.round(s*100)}|${Math.round(l*100)}|${r}` }
  function getSprite(h,s,l,baseR){
    const r = SPR.RADII.reduce((a,b)=> Math.abs(b-baseR)<Math.abs(a-baseR)?b:a, SPR.RADII[0])
    const key = spriteKey(h,s,l,r)
    const cached = SPR.CACHE.get(key)
    if (cached) return cached
    const size = r*2
    const off = (typeof OffscreenCanvas!=='undefined') ? new OffscreenCanvas(size, size) : document.createElement('canvas')
    off.width=size; off.height=size
    const c = off.getContext('2d')
    const g = c.createRadialGradient(r, r, 0, r, r, r)
    g.addColorStop(0, `hsla(${h|0}, ${Math.round(s*100)}%, ${Math.round(l*100)}%, 0.55)`)
    g.addColorStop(1, `hsla(${h|0}, ${Math.round(s*100)}%, ${Math.round(l*100)}%, 0)`)
    c.fillStyle = g
    c.beginPath(); c.arc(r,r,r,0,Math.PI*2); c.fill()
    SPR.CACHE.set(key, off)
    return off
  }

  function allocParticle(){ return poolRef.current.pop() || {} }
  function freeParticle(p){ poolRef.current.push(p) }

  useEffect(()=>{
    try{ workerRef.current = new Worker(new URL('../workers/analyze.worker.js', import.meta.url), { type:'module' }) }catch{}
    return ()=>{ workerRef.current?.terminate(); workerRef.current=null }
  },[])

  useEffect(()=>{
    try { const ctx = Tone.getContext(); ctx.lookAhead = PERF.LOOK_AHEAD; ctx.latencyHint = 'balanced' } catch{}
    return ()=>{ hardStop() }
  }, [])

  useEffect(()=>{
    const portal = document.getElementById('bg-viz-portal')
    if (portal && !portalCanvasRef.current) {
      const c = document.createElement('canvas')
      portal.innerHTML = ''
      portal.appendChild(c)
      portalCanvasRef.current = c
    }
    const onResize = debounce(()=>resizeViz(),120)
    window.addEventListener('resize', onResize, { passive:true })
    const onVis = () => {
      if (document.visibilityState !== 'visible') { vizStateRef.current.running=false }
      else { vizStateRef.current.running=true; vizStateRef.current.lastTime=performance.now(); rafRef.current=requestAnimationFrame(t=>loop(t)) }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      stopViz()
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVis)
      if (portalCanvasRef.current?.parentNode) {
        portalCanvasRef.current.parentNode.removeChild(portalCanvasRef.current)
      }
      portalCanvasRef.current = null
    }
  }, [])

  function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms) } }


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

  let lastNote = null
  function safePick(scaleArray){
    for (let t=0; t<5; t++){
      const n = scaleArray[(Math.random()*scaleArray.length)|0]
      if (n!==lastNote){ lastNote = n; return n }
    }
    return scaleArray[0]
  }

  function rebuildHarmonyCycle(data){
    const mood = (data.coolness < 0.5) ? 'feliz' : 'triste'
    const prog = chooseProgression(data)
    const root = globalRoot(mood)
    barRef.current.degreeCycle = prog
    barRef.current.idx = 0
    barRef.current.heldHue = data.dominantColors?.[0]?.h ?? 0
    barRef.current.prevVoices = []
    return { mood, root, prog }
  }

  const setupAudioGraph = () => {
    if (fx.current.master) return
    const master = new Tone.Gain(1)
    const makeup = new Tone.Gain(Tone.dbToGain(4)) // +1 dB extra
    const comp = new Tone.Compressor(-20, 3)
    const limiter = new Tone.Limiter(-1)
    master.chain(makeup, comp, limiter)
    limiter.connect(Tone.Destination)
    masterLiveRef.current = limiter
    fx.current = { master, makeup, comp, limiter, reverb: new Tone.Reverb({roomSize:.32, wet:.30}), delay: new Tone.FeedbackDelay({delayTime:'8n', feedback:.20, wet:.12}) }
    buses.current = {
      drone: new Tone.Gain(Tone.dbToGain(mix.drone)),
      pad:   new Tone.Gain(Tone.dbToGain(mix.pad))
    }
    busGainsRef.current = { drone: buses.current.drone, pad: buses.current.pad }
    Object.values(buses.current).forEach(b => b.chain(fx.current.delay, fx.current.reverb, fx.current.master))
  }

  async function renderPrerollOffline(data, rootNote, chordNotes, dur = 2.2){
    const buffer = await Tone.Offline(({ transport }) => {
      const out = new Tone.Gain(1).toDestination()

      const droneSine = new Tone.Synth({ oscillator:{type:'sine'}, envelope:{attack:1.2,decay:.6,sustain:.95,release:3.2} }).connect(out)
      const droneTri  = new Tone.Synth({ oscillator:{type:'triangle'}, envelope:{attack:1.4,decay:.8,sustain:.85,release:3.2} }).connect(out)
      droneTri.detune.value = 8

      const pad = new Tone.PolySynth(Tone.AMSynth, {
        maxPolyphony: 6,
        options:{ envelope:{ attack:1.0, decay:.9, sustain:.9, release:3.8 } }
      }).connect(out)

      // disparos
      droneSine.triggerAttack(rootNote, 0)
      droneTri.triggerAttack(rootNote, 0)
      chordNotes.forEach((n,i)=> pad.triggerAttackRelease(n, '2n', 0.12 + i*0.02, 0.7))

      transport.start(0)
    }, dur)

    return buffer
  }

  async function buildPreroll(data){
    try{
      const mood = (data.coolness < 0.5) ? 'feliz' : 'triste'
      const rootNote = (mood==='feliz') ? 'C2' : 'G1'
      const chordNotes = ['C3','E3','G3','B3']
      const audioBuffer = await renderPrerollOffline(data, rootNote, chordNotes, 2.2)

      disposePreroll()
      const player = new Tone.Player({
        url: audioBuffer,
        autostart: false,
        loop: false,
        fadeIn: 0.02,
        fadeOut: 0.15
      })

      const a = new Tone.Gain(1).toDestination()
      const b = new Tone.Gain(0).toDestination()
      player.connect(a)

      prerollRef.current = { buffer: audioBuffer, player }
      xfadeRef.current = { a, b }

      if (masterLiveRef.current){
        masterLiveRef.current.disconnect()
        masterLiveRef.current.connect(b)
      }
    }catch(e){
      disposePreroll()
      console.warn('Preroll offline falló (seguimos sin preroll):', e)
    }
  }

  function disposePreroll(){
    try{ prerollRef.current.player?.dispose() }catch{}
    try{ xfadeRef.current.a?.dispose() }catch{}
    try{ xfadeRef.current.b?.dispose() }catch{}
    try{
      if (masterLiveRef.current){
        masterLiveRef.current.disconnect()
        masterLiveRef.current.connect(Tone.Destination)
      }
    }catch{}
    prerollRef.current = { buffer:null, player:null }
    xfadeRef.current   = { a:null, b:null }
  }

  // ---------- Image analysis ----------
  const analyzeImageLegacy = async (file)=>{
    abortRef.current.aborted = true
    abortRef.current = {aborted:false}
    const local = abortRef.current
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
      return result
    }catch(e){ setErr('Análisis: '+(e.message||String(e))); return null }
    finally{ if (preUrlRef.current) { URL.revokeObjectURL(preUrlRef.current); preUrlRef.current=null } }
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

  const analyzeWithWorker = (file) => new Promise(async (resolve,reject)=>{
    if (!workerRef.current) return reject(new Error('sin worker'))
    try{
      const bitmap = await createImageBitmap(file, { resizeWidth: 768, resizeHeight: 768, resizeQuality: 'high' })
      const w = workerRef.current
      const onMsg = (ev)=>{
        const m = ev.data
        w.removeEventListener('message', onMsg)
        if (m.ok) resolve(m.data); else reject(new Error(m.error))
      }
      w.addEventListener('message', onMsg)
      w.postMessage({ fileOrBitmap: bitmap })
    }catch(err){ reject(err) }
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

      // Capa 1: seno base (fundamental)
      const droneSine = new Tone.Synth({
        oscillator:{ type:'sine' },
        envelope:{ attack:1.8, decay:1.0, sustain:.95, release:3.8 }
      })
      // Capa 2: triángulo suave un pelín desafinado para “cuerpo”
      const droneTri = new Tone.Synth({
        oscillator:{ type:'triangle' },
        envelope:{ attack:2.2, decay:1.2, sustain:.85, release:3.8 }
      })
      const detune = 5 + energy*3 // cents
      droneTri.detune.value = detune

      // Filtros/efectos muy sutiles para claridad y aire
      const eq = new Tone.EQ3({ low:-1, mid:0, high:+2 }) // un poco de brillo
      const hp = new Tone.Filter({ frequency: 40, type:'highpass' }) // quita “rumble”
      const lp = new Tone.Filter({ frequency: 1200 + energy*800, type:'lowpass' })
      const chorus = new Tone.Chorus({ frequency: 0.15, delayTime: 4, depth: 0.2, wet: 0.2 }).start()

      // mezcla de capas → filtros → bus drone
      const mixDrone = new Tone.Gain(0.9)
      droneSine.connect(mixDrone)
      droneTri.connect(mixDrone)
      mixDrone.chain(hp, lp, eq, chorus, buses.current.drone)

      ambient.current = { sine: droneSine, tri: droneTri, out: mixDrone }
      // un poco más fuerte que antes:
      droneSine.volume.value = -12
      droneTri.volume.value  = -12

      const rootNoteDrone = (mood==='feliz')?'C2':'G1'
      ambient.current.sine.triggerAttack(rootNoteDrone)
      ambient.current.tri.triggerAttack(rootNoteDrone)

      const padVoices = 6
      pad.current = new Tone.PolySynth(Tone.AMSynth, {
        maxPolyphony: padVoices,
        volume: Tone.gainToDb(0.4),
        options: { envelope:{ attack:1.2, decay:1, sustain:.9, release:4.2 } }
      }).connect(buses.current.pad)

      const { mood: baseMood, root } = rebuildHarmonyCycle(d)

      // Pad B “breath”
      const padB = new Tone.PolySynth(Tone.AMSynth, {
        maxPolyphony: 4,
        options:{ envelope:{ attack:1.6, decay:1.1, sustain:.85, release:4.5 } }
      })
      const padBGain = new Tone.Gain(Tone.dbToGain(-10))
      const padBFilter = new Tone.Filter({ type:'lowpass', frequency: 1400, Q: 0.4 })
      const breathLFO = new Tone.LFO({ frequency: 0.07, min: 600, max: 2200 }).start()
      breathLFO.connect(padBFilter.frequency)
      padB.chain(padBFilter, padBGain, buses.current.pad)

      padLoop.current?.dispose?.()
      padLoop.current = new Tone.Loop((time)=>{
        const { degreeCycle, idx, prevVoices } = barRef.current
        const deg = degreeCycle[idx % degreeCycle.length]
        const chord = chordNotesFromDegree(root, deg, true, prevVoices, diatonicPool)
        chord.forEach((n,i)=>{
          const nudge = (Math.random()-.5)*0.02
          pad.current.triggerAttackRelease(n, '1m', time+nudge, 0.75)
        })
        barRef.current.prevVoices = chord
        barRef.current.idx = (idx+1) % degreeCycle.length
      }, '1m').start(0)

      breathLoop.current?.dispose?.()
      breathLoop.current = new Tone.Loop((time)=>{
        const { prevVoices } = barRef.current
        if (!prevVoices?.length) return
        const top = prevVoices[prevVoices.length-1]
        // Movimientos por GRADOS (no semitonos): 1–4 grados arriba dentro de la escala
        const steps = [1,2,3,4][(Math.random()*4)|0]
        const tNote = stepsAboveInPool(top, diatonicPool, steps)
        const dur = Math.random()<.4 ? '2n.' : '1n'
        const nudge = (Math.random()-.5)*0.02
        padB.triggerAttackRelease(tNote, dur, time+nudge, 0.55)
      }, '2n').start('0:1')

      extraRefs.current = { padB, padBGain, padBFilter, breathLFO, breathLoop: breathLoop.current }

      lastNote = null
      arpLoop.current?.dispose?.()
      arpLoop.current = new Tone.Loop((time)=>{
        if (Math.random()<.35) return
        const { prevVoices } = barRef.current
        if (!prevVoices?.length) return
        const pool = prevVoices
        const n = safePick(pool)
        const durn = (Math.random()<.5)?'8n':'4n'
        const nudge = (Math.random()-.5)*0.015
        pad.current.triggerAttackRelease(n, durn, time+nudge, 0.42)
      }, '8n').start('0:2')

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
    if (!workerRef.current){
      try{
        workerRef.current = new Worker(new URL('../workers/analyze.worker.js', import.meta.url), { type:'module' })
      }catch{}
    }
    if (imgURL) URL.revokeObjectURL(imgURL)
    setImgURL(URL.createObjectURL(f))
    stopAll()
    setAnalyzing(true)
    try{
      const d = await analyzeWithWorker(f)
      setData(d)
      buildPreroll(d)
    }catch{
      const d = await analyzeImageLegacy(f)
      if (d){ setData(d); buildPreroll(d) }
    }finally{
      setAnalyzing(false)
    }
  }

  const togglePlay = async ()=>{
    if (!data) return
    if (playing){ stopAll(); stopViz(); Tone.Transport.stop(); setPlaying(false); wasPlayingRef.current=false; disposePreroll(); return }
    const ok = await setupFromData(data)
    if (ok){
      const now = Tone.now()
      const pr = prerollRef.current.player
      const a = xfadeRef.current.a, b = xfadeRef.current.b
      if (pr && a && b){
        try{
          pr.start(now)
          Tone.Transport.start(now + 0.12)
          a.gain.setValueAtTime(1, now)
          b.gain.setValueAtTime(0, now)
          a.gain.linearRampTo(0, 1.2, now + 0.12)
          b.gain.linearRampTo(1, 1.2, now + 0.12)
          setTimeout(()=>{ disposePreroll() }, 1600)
        }catch{
          Tone.Transport.start(now + 0.05)
        }
      }else{
        Tone.Transport.start(now + 0.05)
      }
      startViz()
      setPlaying(true); wasPlayingRef.current=true;
    }
  }

  const testAudio = async ()=>{
    try{ await Tone.start(); const t=new Tone.Synth().toDestination(); t.triggerAttackRelease('C4','8n'); setTimeout(()=>t.dispose(),400) }catch(e){ setErr('Audio: '+e.message) }
  }

  // cleanup helpers
  const stopAll = ()=>{
    try{ padLoop.current?.dispose?.(); padLoop.current=null }catch{}
    try{ breathLoop.current?.dispose?.(); breathLoop.current=null }catch{}
    try{ arpLoop.current?.dispose?.(); arpLoop.current=null }catch{}
    try{ safeDispose(extraRefs.current?.padB) }catch{}
    try{ safeDispose(extraRefs.current?.padBGain) }catch{}
    try{ safeDispose(extraRefs.current?.padBFilter) }catch{}
    try{ safeDispose(extraRefs.current?.breathLFO) }catch{}
    try{ safeDispose(extraRefs.current?.breathLoop) }catch{}
    extraRefs.current = {}
    if (ambient.current){
      try{
        ambient.current.sine.triggerRelease?.()
        ambient.current.tri.triggerRelease?.()
        ambient.current.sine.dispose?.()
        ambient.current.tri.dispose?.()
        ambient.current.out.dispose?.()
      }catch{}
      ambient.current=null
    }
    if (pad.current){ try{ pad.current.dispose?.() }catch{}; pad.current=null }
    try{ Tone.Transport.cancel(0) }catch{}
    disposePreroll()
  }
  const softStop = ()=> stopAll()
  const hardStop = ()=>{ stopAll(); try{ Tone.Transport.stop(); Tone.Transport.cancel(0) }catch{}; stopViz(); if(preUrlRef.current){ URL.revokeObjectURL(preUrlRef.current); preUrlRef.current=null } }

  async function hardResetApp(keepAudioCtx = true){
    if (isResettingRef.current) return
    isResettingRef.current = true
    try{
      // 1) Audio programado
      try{
        Tone.Transport.stop()
        Tone.Transport.cancel(0)
      }catch{}

      // 2) Detener TODO lo creado por nosotros
      try{
        // Loops del pad / arpegio
        try{ padLoop?.current?.dispose?.() }catch{}
        try{ breathLoop?.current?.dispose?.() }catch{}
        try{ arpLoop?.current?.dispose?.() }catch{}

        // Drone (dos capas en la versión actual)
        try{ ambient.current?.sine?.triggerRelease?.() }catch{}
        try{ ambient.current?.tri?.triggerRelease?.() }catch{}
        safeDispose(ambient.current?.sine)
        safeDispose(ambient.current?.tri)
        ambient.current = null

        // Pad
        safeDispose(pad.current); pad.current = null
        safeDispose(extraRefs.current?.padB)
        safeDispose(extraRefs.current?.padBGain)
        safeDispose(extraRefs.current?.padBFilter)
        safeDispose(extraRefs.current?.breathLFO)
        safeDispose(extraRefs.current?.breathLoop)
        extraRefs.current = {}

        // FX y buses (no toques sliders/state)
        disconnect(buses.current?.drone); disconnect(buses.current?.pad)
        safeDispose(buses.current?.drone); safeDispose(buses.current?.pad)
        buses.current = {}

        // Master/fx si los recreas cada play (si los reúsas, omite dispose)
        safeDispose(fx.current?.reverb)
        safeDispose(fx.current?.delay)
        safeDispose(fx.current?.comp)
        safeDispose(fx.current?.makeup)
        safeDispose(fx.current?.limiter)
        safeDispose(fx.current?.master)
        fx.current = {}
      }catch{}

      // 3) Pre-buffer / crossfade
      try{ disposePreroll() }catch{}

      // 4) Visual autónomo
      try{ stopViz() }catch{}
      clearPortalCanvas()
      try{ particlesRef.current.length = 0 }catch{}
      try{ poolRef?.current && (poolRef.current.length = 0) }catch{}
      try{ SPR?.CACHE?.clear?.() }catch{}

      // 5) Worker de análisis
      try{ workerRef.current?.terminate?.(); workerRef.current = null }catch{}

      // 6) Blob/URL anteriores
      try{
        if (imgURL) { URL.revokeObjectURL(imgURL) }
        if (preUrlRef?.current){ URL.revokeObjectURL(preUrlRef.current); preUrlRef.current = null }
      }catch{}

      // 7) Estado de UI (sin mover sliders)
      setData(null)
      setImgURL(null)
      setPlaying(false)
      wasPlayingRef.current = false
      if (fileRef.current) fileRef.current.value = ''

      // 8) AudioContext: opcional suspender para ahorrar CPU (no lo cierres)
      if (!keepAudioCtx){
        try{ await Tone.getContext().rawContext.suspend() }catch{}
      }
    }finally{
      isResettingRef.current = false
    }
  }

  const startViz = () => {
    const c = portalCanvasRef.current
    if (!c) return
    resizeViz()
    ctxRef.current = c.getContext('2d', { alpha: true })
    cancelAnimationFrame(rafRef.current)
    particlesRef.current.length = 0
    if (data?.dominantColors) {
      data.dominantColors.forEach(c=>emit(c.h, c.s, c.l, 0.6))
    }
    vizStateRef.current.running = true
    vizStateRef.current.lastTime = performance.now()
    rafRef.current = requestAnimationFrame(loop)
  }

  function loop(ts){
    const ctx = ctxRef.current
    if (!ctx){ rafRef.current = requestAnimationFrame(loop); return }
    const vs = vizStateRef.current
    if (!vs.running){ rafRef.current = requestAnimationFrame(loop); return }
    const { w, h } = sizeRef.current
    const dt = (ts - (vs.lastTime || ts)) / 1000
    vs.lastTime = ts
    vs._acc = (vs._acc || 0) + dt
    const minStep = 1/60, target = 1/45
    if (vs._acc < minStep){ rafRef.current=requestAnimationFrame(loop); return }
    const steps = Math.min(3, Math.floor(vs._acc / target))
    vs._acc -= steps*target

    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = 'rgba(4, 8, 20, 0.08)'
    ctx.fillRect(0,0,w,h)

    for(let s=0; s<steps; s++){
      const t = (ts - vs._acc*1000 + s*target*1000) * 0.0003
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
          const last = particlesRef.current.pop()
          if (i < particlesRef.current.length) particlesRef.current[i] = last
          freeParticle(p)
        }
      }
    }

    ctx.globalCompositeOperation = 'lighter'
    for (let i=0;i<particlesRef.current.length;i++){
      const p = particlesRef.current[i]
      const spr = getSprite(p.h, p.s, p.l, p.baseR)
      const w2 = p.r*2
      ctx.globalAlpha = Math.min(0.6, 0.35 * p.intensity * VISIBLE_BOOST)
      ctx.drawImage(spr, p.x - p.r, p.y - p.r, w2, w2)
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'

    const MAX = PERF.MAX_PARTICLES || 700
    if (particlesRef.current.length > MAX) {
      particlesRef.current.length = MAX
    }

    rafRef.current = requestAnimationFrame(loop)
  }

  const stopViz = () => {
    vizStateRef.current.running = false
    cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    particlesRef.current.length = 0
  }

  const resizeViz = () => {
    const c = portalCanvasRef.current
    if (!c) return
    const DPR = Math.min(window.devicePixelRatio || 1, (/Mobi|Android/i.test(navigator.userAgent)? 1.25 : 1.5))
    const scale = 0.66
    c.width = Math.floor(window.innerWidth * scale * DPR)
    c.height = Math.floor(window.innerHeight * scale * DPR)
    sizeRef.current = { w: c.width, h: c.height, dpr: DPR }
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
    const p = allocParticle()
    p.x = x; p.y = y; p.vx = vx; p.vy = vy
    p.r = baseR; p.baseR = baseR
    p.life = 1.3 + intensity * 0.9
    p.pulsePhase = Math.random() * Math.PI * 2
    p.h = h; p.s = s; p.l = l; p.intensity = intensity
    particlesRef.current.push(p)
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
                  <img className="img" src={imgURL} alt="subida" decoding="async" fetchpriority="high" loading="eager" onLoad={onImgLoad}/>
                </div>
                <div className="row" style={{marginTop:10}}>
                  <button
                    className="btn secondary"
                    onClick={async ()=>{
                      await hardResetApp(true)
                      fileRef.current?.click()
                    }}
                  >Subir otra</button>
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
                    <input className="range" type="range" min="-60" max="0" value={v} onChange={(e)=>{ const val=parseInt(e.target.value,10); setMix(m=>({...m,[k]:val})); applyUserMix(k, val) }} />
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
                        {noteForColor(c.h, scalePool)}
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
