import React, { useEffect, useRef, useState } from 'react'
import * as Tone from 'tone'
import { Upload, Play, Pause } from 'lucide-react'

// PERF constants
const PERF = { LOOK_AHEAD: 0.05, MAX_EVENTS_PER_TICK: 10, MAX_SYNTH_VOICES: 8, IMG_MAX_SIZE: 180, SAMPLE_STRIDE: 20, MAX_PARTICLES: 700 }

// Helpers
const hsl = (h,s,l)=>`hsl(${h}, ${Math.round(s*100)}%, ${Math.round(l*100)}%)`
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v))

export default function ColorSynth(){
  const [imgURL, setImgURL] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [data, setData] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [err, setErr] = useState(null)

  // mixer
  const [mix, setMix] = useState({ drone:-20, colors:-12, plucks:-14, pad:-16, bells:-16, noise:-28, drums:-14 })

  const fileRef = useRef(null)
  const canvasRef = useRef(null)
  const preUrlRef = useRef(null)
  const abortRef = useRef({aborted:false})
  const wasPlayingRef = useRef(false)

  const countsRef = useRef({ total:0, colores:0, plucks:0, pad:0, bells:0, drums:0 })
  const [counts, setCounts] = useState({ total:0, colores:0, plucks:0, pad:0, bells:0, drums:0 })
  const flushCounts = ()=>{ setCounts({...countsRef.current}) }

  const noteHit = (kind) => {
    const c = countsRef.current
    c.total += 1
    if (kind && c[kind] !== undefined) c[kind] += 1
    if (!noteHit._raf) {
      noteHit._raf = requestAnimationFrame(()=>{ flushCounts(); noteHit._raf = null })
    }
  }

  // audio nodes/buses
  const fx = useRef({})
  const buses = useRef({})
  const ambient = useRef(null)
  const voices = useRef([])
  const plucks = useRef([])
  const pad = useRef(null)
  const bells = useRef(null)
  const noise = useRef(null)
  const kick = useRef(null); const snare = useRef(null); const hat = useRef(null)
  const loopColors = useRef(null); const loopPlucks = useRef(null); const loopPad = useRef(null); const loopBells = useRef(null)
  const seqK = useRef(null); const seqS = useRef(null); const seqH = useRef(null)

  // viz
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
    setDb(B.drone,mix.drone)
    setDb(B.colors,mix.colors)
    setDb(B.plucks,mix.plucks)
    setDb(B.pad,mix.pad)
    setDb(B.bells,mix.bells)
    setDb(B.noise,mix.noise)
    setDb(B.drums,mix.drums)
  },[mix])

  const setupAudioGraph = () => {
    if (fx.current.master) return
    const master = new Tone.Gain(1)
    const makeup = new Tone.Gain(Tone.dbToGain(3)) // ~+3 dB
    const comp = new Tone.Compressor(-20, 3)
    const limiter = new Tone.Limiter(-1)
    master.chain(makeup, comp, limiter, Tone.Destination)
    fx.current = { master, makeup, comp, limiter, reverb: new Tone.Reverb({roomSize:.32, wet:.30}), delay: new Tone.FeedbackDelay({delayTime:'8n', feedback:.20, wet:.12}) }
    const makeBus = (db)=> new Tone.Gain(Tone.dbToGain(db))
    buses.current = {
      drone: makeBus(mix.drone), colors: makeBus(mix.colors), plucks: makeBus(mix.plucks),
      pad: makeBus(mix.pad), bells: makeBus(mix.bells), noise: makeBus(mix.noise), drums: makeBus(mix.drums)
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
      const merged = (stats.dominantColors.concat(extra)).slice(0,14)
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
    const stride = PERF.SAMPLE_STRIDE*4
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
      const k = Math.round(sH/12)*12
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
    const stride = PERF.SAMPLE_STRIDE*8
    const out = []; const used = new Set(existing.map(c=>c.h))
    for (let i=0;i<data.length;i+=stride){
      if (local.aborted) break
      const a=data[i+3]; if (a===0) continue
      const r=data[i],g=data[i+1],b=data[i+2]
      const {h,s,l} = rgbToHsl(r,g,b)
      if (l>.78 && s>.55){ const k=Math.round(h/12)*12; if(!used.has(k)){ used.add(k); out.push({h:k,s,l,weight:1}); if(out.length>=4) break } }
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

  // ---------- Audio ----------
  const scales = {
    frio:['C3','D3','Eb3','F3','G3','Ab3','Bb3','C4'],
    calido:['C3','D3','E3','F#3','G3','A3','B3','C4'],
    pastel:['C3','E3','G3','B3','D4','F#4'],
    brillante:['C3','D#3','F#3','A3','C4','D#4','F#4'],
    dorica:['C3','D3','Eb3','F3','G3','A3','Bb3','C4'],
    frigia:['C3','Db3','Eb3','F3','G3','Ab3','Bb3','C4'],
    lidia:['C3','D3','E3','F#3','G3','A3','B3','C4'],
    whole:['C3','D3','E3','F#3','G#3','A#3','C4'],
    hira:['C3','Db3','F3','G3','Ab3','C4'],
    pmen:['C3','Eb3','F3','G3','Bb3','C4'],
    pmay:['C3','D3','E3','G3','A3','C4']
  }

  const chooseScale = (d, c)=>{
    if (d.pastelnessRatio>.35) return scales.pastel
    if (d.brightnessRatio>.5) return scales.brillante
    if (d.coolness>.65) return scales.dorica
    if (d.coolness<.35) return scales.lidia
    if (d.avgSaturation<.25) return scales.pmen
    if (c.h%60===0) return scales.whole
    if (c.h%90===0) return scales.hira
    return (c.s>.6) ? scales.pmay : scales.frio
  }

  const setupFromData = async (d)=>{
    try{
      setErr(null)
      await Tone.start() // user gesture required; call only on play
      setupAudioGraph()

      softStop()

      Tone.Transport.bpm.rampTo(d.bpm, .15)
      Tone.Transport.swing = Math.min(.35, Math.max(0, d.avgSaturation*.3))
      Tone.Transport.swingSubdivision = '8n'

      ambient.current = new Tone.Synth({oscillator:{type:'sine'}, envelope:{attack:2.2,decay:1.1,sustain:.85,release:3.2}})
      const lp = new Tone.Filter({frequency:1100,type:'lowpass'})
      ambient.current.chain(lp, buses.current.drone)
      ambient.current.volume.value = -20
      ambient.current.triggerAttack('C2')

      const nVoices = Math.min(PERF.MAX_SYNTH_VOICES, d.dominantColors.length)
      for (let i=0;i<nVoices;i++){
        const color = d.dominantColors[i]
        const scale = chooseScale(d,color)
        const s = new Tone.Synth({oscillator:{type:'triangle'}, envelope:{attack:.22,decay:.55,sustain:.42,release:1}})
        const ft = new Tone.Filter({frequency:880,type:'lowpass'})
        const trem = new Tone.Tremolo(.5 + d.avgSaturation*1.2, .18).start()
        s.chain(ft, trem, buses.current.colors)
        s.volume.value = -20 - i*1.5
        voices.current.push({s, ft, color, scale})
      }

      for (let i=0;i<2;i++){
        const p = new Tone.PluckSynth({attackNoise:1, dampening:3200, resonance:.85})
        const pan = new Tone.AutoPanner(0.1 + i*0.05).start()
        p.chain(pan, buses.current.plucks)
        p.volume.value = -24 - i*2
        plucks.current.push(p)
      }

      pad.current = new Tone.AMSynth({oscillator:{type:'sine'}, envelope:{attack:1.3,decay:1.1,sustain:.9,release:3.5}}).connect(buses.current.pad)
      bells.current = new Tone.FMSynth({harmonicity:8,modulationIndex:2,envelope:{attack:0.01,decay:1,sustain:0,release:2.2},modulation:{type:'sine'},modulationEnvelope:{attack:0.01,decay:0.2,sustain:0}}).connect(buses.current.bells)
      noise.current = new Tone.Noise('pink')
      const af = new Tone.AutoFilter(0.06, 200, 2).start()
      const rf = new Tone.Filter({frequency:850,type:'lowpass'})
      noise.current.chain(af, rf, buses.current.noise); noise.current.start()

      kick.current = new Tone.MembraneSynth({pitchDecay:0.03,octaves:6,oscillator:{type:'sine'},envelope:{attack:0.001,decay:0.45,sustain:0,release:0.35}}).connect(buses.current.drums)
      snare.current = new Tone.NoiseSynth({noise:{type:'white'}, envelope:{attack:0.001,decay:0.18,sustain:0}}); const shp=new Tone.Filter({type:'highpass',frequency:1900}); snare.current.chain(shp, buses.current.drums)
      hat.current = new Tone.MetalSynth({frequency:250,envelope:{attack:0.001,decay:0.045,release:0.008},harmonicity:5.1,modulationIndex:32,resonance:2600,octaves:1.5}).connect(buses.current.drums)

      const patt = buildDrums(d)
      makeDrumSeq(patt)

      startLoops(d)
      return true
    }catch(e){ setErr(e.message||String(e)); return false }
  }

  const buildDrums = (d)=>{
    const steps = 16
    const K=Array(steps).fill(0), S=Array(steps).fill(0), H=Array(steps).fill(0)
    const strong = d.dominantColors.filter(c=>c.s>.55 && c.l>.25 && c.l<.8).slice(0,8)
    const total = strong.reduce((a,c)=>a+(c.weight||1),0)||1
    const euclid=(pulses,len,rot=0)=>{ const out=Array(len).fill(0); let buck=0; for(let i=0;i<len;i++){ buck+=pulses; if(buck>=len){ buck-=len; out[(i+rot)%len]=1 } } return out }
    const add=(arr,pat,w,vel=1)=>{ for(let i=0;i<arr.length;i++) arr[i]+= (pat[i]? w*vel:0) }
    const rot=(h)=>Math.floor(((h%360)/360)*steps)%steps
    strong.forEach(c=>{
      const w=(c.weight||1)/total; const r=rot(c.h)
      if (c.h<20||c.h>=340){ add(K,euclid(5,steps,r),w,1); add(H,euclid(7,steps,r+2),w*.5) }
      else if (c.h<50){ const sn=euclid(3,8,Math.floor(r/2)).flatMap(v=>[v,0]); add(S,sn,w,.9); add(K,euclid(3,steps,r+1),w*.5) }
      else if (c.h<90){ add(H,euclid(5,steps,r),w,.9) }
      else if (c.h<165){ add(K,euclid(4,steps,r+1),w*.8); add(H,euclid(3,steps,r+3),w*.6) }
      else if (c.h<210){ add(H,euclid(2,steps,r+2),w*1.2) }
      else if (c.h<270){ const base=Array(steps).fill(0); base[4]=1; base[12]=1; add(S,base,w,1); add(S,euclid(2,steps,r+5),w*.4) }
      else { add(H,euclid(4,steps,r+4),w*.8) }
    })
    const thr = (arr,t)=>arr.map(v=>v>=t?1:0)
    const n=Math.max(1,strong.length)
    const tK= .42/(Math.sqrt(n)+.2), tS=.48/(Math.sqrt(n)+.2), tH=.36/(Math.sqrt(n)+.2)
    return {K:thr(K,tK),S:thr(S,tS),H:thr(H,tH), vK:K.map(v=>v ? .22 : 0), vS:S.map(v=>v ? .16 : 0), vH:H.map(v=>v ? .1 : 0)}
  }

  const makeDrumSeq = ({K,S,H,vK,vS,vH})=>{
    try{ seqK.current?.dispose?.(); seqS.current?.dispose?.(); seqH.current?.dispose?.(); }catch{}
    seqK.current = new Tone.Sequence((t,step)=>{ if(K[step]) { kick.current?.triggerAttackRelease('C1','8n',t,vK[step]||.2); noteHit('drums'); emit(0, .6, .35, .6) } }, Array.from({length:16},(_,i)=>i), '16n').start(0)
    seqS.current = new Tone.Sequence((t,step)=>{ if(S[step]) { snare.current?.triggerAttackRelease('8n',t,vS[step]||.15); noteHit('drums'); emit(220,.6,.6,.55) } }, Array.from({length:16},(_,i)=>i), '16n').start(0)
    seqH.current = new Tone.Sequence((t,step)=>{ if(H[step]) { hat.current?.triggerAttackRelease('16n',t,vH[step]||.1); noteHit('drums'); emit(55,.7,.7,.28) } }, Array.from({length:16},(_,i)=>i), '16n').start(0)
  }

  const startLoops = (d)=>{
    loopColors.current?.dispose?.(); loopPlucks.current?.dispose?.(); loopPad.current?.dispose?.(); loopBells.current?.dispose?.()
    const step = Math.max(.10, 60/Math.max(35,d.bpm))
    loopColors.current = new Tone.Loop((time)=>{
      let ev=0
      voices.current.forEach(v=>{
        if (ev>=PERF.MAX_EVENTS_PER_TICK) return
        const base = .18 + (d.colorEntropy*.22)
        const weight = Math.min(1,(v.color.weight||1)/20)
        const sat = .22 + v.color.s*.7
        if (Math.random() < base*weight*sat) {
          const idx = (Math.random()*v.scale.length)|0
          let note = v.scale[idx]
          if (v.color.h<60) note = Tone.Frequency(note).transpose(12).toNote()
          else if (v.color.h>240) note = Tone.Frequency(note).transpose(-12).toNote()
          const dur = ['8n','4n','2n'][(Math.random()*3)|0]
          const baseF = 230 + v.color.h*2
          const varP = (Math.random()-.5)*d.contrast*35
          v.ft.frequency.rampTo(clamp(baseF+varP,180,3200), .06)
          const nudge = (Math.random()-.5)*.02
          v.s.triggerAttackRelease(note, dur, time+nudge)
          noteHit('colores')
          emit(v.color.h, v.color.s, v.color.l, .5)
          ev++
        }
      })
    }, step).start(0)

    const intPl = Math.max(.16, .50 - d.avgBrightness*.35)
    loopPlucks.current = new Tone.Loop((time)=>{
      if (plucks.current.length===0) return
      if (Math.random() < (.14 + d.colorEntropy*.18)) {
        const i=(Math.random()*plucks.current.length)|0
        const sc = chooseScale(d, {h:60*(1+i), s:d.avgSaturation})
        const note = sc[(Math.random()*sc.length)|0].replace('3','4')
        const nudge=(Math.random()-.5)*.02
        plucks.current[i].triggerAttack(note, time+nudge)
        noteHit('plucks')
        emit(120+i*60, .5, .6, .45)
      }
    }, intPl).start(0)

    loopPad.current = new Tone.Loop((time)=>{
      if (!pad.current) return
      if (Math.random() < .50){
        const sc = chooseScale(d, {h:120, s:d.avgSaturation})
        const root = sc[(Math.random()*sc.length)|0]
        const fifth = Tone.Frequency(root).transpose(7).toNote()
        pad.current.triggerAttackRelease(root,'2n',time)
        if (Math.random()<.55) pad.current.triggerAttackRelease(fifth,'2n',time+.08)
        noteHit('pad')
        emit(d.coolness>.5?180:30,.3,.5,.55)
      }
    }, 8.5).start(0)

    loopBells.current = new Tone.Loop((time)=>{
      if (!bells.current) return
      if (Math.random() < .12){
        const sc = chooseScale(d, {h:240, s:d.avgSaturation})
        const note = sc[(Math.random()*sc.length)|0].replace('3','5')
        bells.current.triggerAttackRelease(note, '8n', time)
        noteHit('bells')
        emit(260,.5,.7,.5)
      }
    }, 2.8).start(0)
  }

  // ---------- UI actions ----------
  const onUpload = async (e)=>{
    const f = e.target.files?.[0]; if (!f||!f.type.startsWith('image/')) return
    if (imgURL) URL.revokeObjectURL(imgURL)
    setImgURL(URL.createObjectURL(f))
    stopAll()
    countsRef.current = { total:0, colores:0, plucks:0, pad:0, bells:0, drums:0 }
    setCounts(countsRef.current)
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
    try{ loopColors.current?.dispose?.(); loopColors.current=null }catch{}
    try{ loopPlucks.current?.dispose?.(); loopPlucks.current=null }catch{}
    try{ loopPad.current?.dispose?.(); loopPad.current=null }catch{}
    try{ loopBells.current?.dispose?.(); loopBells.current=null }catch{}
    try{ seqK.current?.dispose?.(); seqK.current=null }catch{}
    try{ seqS.current?.dispose?.(); seqS.current=null }catch{}
    try{ seqH.current?.dispose?.(); seqH.current=null }catch{}
    voices.current.forEach(v=>{ try{ v.s.triggerRelease?.(); v.s.dispose?.(); v.ft?.dispose?.() }catch{} })
    voices.current=[]; plucks.current.forEach(p=>{try{p.dispose?.()}catch{}}); plucks.current=[]
    if (ambient.current){ try{ ambient.current.triggerRelease?.(); ambient.current.dispose?.() }catch{}; ambient.current=null }
    if (pad.current){ try{ pad.current.dispose?.() }catch{}; pad.current=null }
    if (bells.current){ try{ bells.current.dispose?.() }catch{}; bells.current=null }
    if (kick.current){ try{ kick.current.dispose?.() }catch{}; kick.current=null }
    if (snare.current){ try{ snare.current.dispose?.() }catch{}; snare.current=null }
    if (hat.current){ try{ hat.current.dispose?.() }catch{}; hat.current=null }
    if (noise.current){ try{ noise.current.stop(); noise.current.dispose?.() }catch{}; noise.current=null }
    countsRef.current = { total:0, colores:0, plucks:0, pad:0, bells:0, drums:0 }
    setCounts(countsRef.current)
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

    const loop = (ts) => {
      const { w, h } = sizeRef.current
      ctx.clearRect(0, 0, w, h)

      // “viento” muy leve y +5% movimiento
      const t = ts * 0.0003
      const windXBase = Math.sin(t) * 0.15
      const windYBase = Math.cos(t * 0.8) * 0.10
      const speedScale = 1.05

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

        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r)
        g.addColorStop(0, `hsla(${p.h|0}, ${Math.round(p.s*100)}%, ${Math.round(p.l*100)}%, ${0.35 * p.intensity})`)
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
        <p className="p">Convierte tus imágenes en sonido ambiental. Primero sube una imagen y luego toca “Probar audio” o “Reproducir”.</p>
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
                <div className="imgBox"><img className="img" src={imgURL} alt="subida"/></div>
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
              <div className="small" style={{marginTop:6}}>
                Notas: <strong>{counts.total}</strong> — Colores: {counts.colores} • Plucks: {counts.plucks} • Pad: {counts.pad} • Campanas: {counts.bells} • Drums: {counts.drums}
              </div>
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
            <div className="card">
              <h3>Análisis</h3>
              <div className="small">Frialdad: {Math.round(data.coolness*100)}% • Pastel: {Math.round(data.pastelnessRatio*100)}% • Contraste: {Math.round(data.contrast*100)}% • Entropía: {Math.round(data.colorEntropy*100)}%</div>
              <div className="colors" style={{marginTop:10}}>
                {data.dominantColors.slice(0,12).map((c,i)=>(<div key={i} title={`h:${c.h} s:${Math.round(c.s*100)} l:${Math.round(c.l*100)}`} className="colorSwatch" style={{background:hsl(c.h,c.s,c.l)}}/>))}
              </div>
            </div>
          ):(
            <div className="card"><h3>¿Cómo funciona?</h3><p className="small">Brillo→BPM, saturación/temperatura→escala (dórica, frígia, lidia, pentas, whole, hirajoshi), entropía→densidad, contraste→filtros. Colores fuertes generan ritmos (kick/snare/hat).</p></div>
          )}
          {err && <div className="card" style={{marginTop:18, borderColor:'#b91c1c'}}><strong>Error:</strong> <span className="small">{String(err)}</span></div>}
        </div>
      </section>

      <footer className="footer">Web App creada por Claude y corregida por Codex de Chat GPT con ideas de Diego Bastías A.  Agosto 2025</footer>
      <canvas ref={canvasRef} style={{display:'none'}}/>
    </div>
  )
}
