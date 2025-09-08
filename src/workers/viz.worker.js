
// Viz worker: visual idéntica, corre fuera del main thread en móvil
let canvas, ctx
let W = 0, H = 0, DPR = 1
let running = false
let lastTime = 0
let particles = []
let palette = []

const clamp = (v,a,b)=>Math.max(a,Math.min(b,v))
const hsl = (h,s,l)=>`hsl(${h}, ${Math.round(s*100)}%, ${Math.round(l*100)}%)`

function allocParticle(){ return { x:0,y:0,vx:0,vy:0,r:6,baseR:6,life:1, pulsePhase:0, h:0,s:0,l:0 } }

function emit(h, s, l, intensity = 0.5){
  if (!W || !H) return
  const side = Math.random()
  let x, y, vx, vy
  if (side < 0.25) { x = -20; y = Math.random() * H; vx = 0.6 + Math.random() * 0.6; vy = (Math.random() - 0.5) * 0.4 }
  else if (side < 0.5) { x = W + 20; y = Math.random() * H; vx = -(0.6 + Math.random() * 0.6); vy = (Math.random() - 0.5) * 0.4 }
  else if (side < 0.75) { x = Math.random() * W; y = -20; vx = (Math.random() - 0.5) * 0.4; vy = 0.6 + Math.random() * 0.6 }
  else { x = Math.random() * W; y = H + 20; vx = (Math.random() - 0.5) * 0.4; vy = -(0.6 + Math.random() * 0.6) }

  const baseR = 10 + intensity * 22 * (0.6 + Math.random() * 0.8)
  const p = allocParticle()
  p.x = x; p.y = y; p.vx = vx; p.vy = vy
  p.r = baseR; p.baseR = baseR
  p.life = 1.3 + intensity * 0.9
  p.pulsePhase = Math.random() * Math.PI * 2
  p.h = h; p.s = s; p.l = l
  particles.push(p)
}

function loop(ts){
  if (!ctx || !running) { return }
  const dt = (ts - (lastTime || ts)) / 1000
  lastTime = ts
  const minStep = 1/60, target = 1/45
  if (dt < minStep) { schedule(); return }

  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = 'rgba(4, 8, 20, 0.08)'
  ctx.fillRect(0, 0, W, H)

  const t = ts/1000
  const speedScale = 1.0
  const windXBase = Math.sin(t * 0.2) * 0.05
  const windYBase = Math.cos(t * 0.15) * 0.04

  if (palette && palette.length && Math.random() < 0.08) {
    const c = palette[(Math.random()*palette.length)|0]
    emit(c.h, c.s, c.l, 0.5)
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]
    const windX = windXBase + Math.sin(p.y * 0.002 + t * 0.6) * 0.08
    const windY = windYBase + Math.cos(p.x * 0.002 - t * 0.4) * 0.06
    p.vx += windX * 0.02
    p.vy += windY * 0.02
    p.x += p.vx * speedScale
    p.y += p.vy * speedScale
    p.life -= 0.006
    if (p.life <= 0 || p.x < -60 || p.y < -60 || p.x > W+60 || p.y > H+60) {
      particles.splice(i,1)
      continue
    }
    p.pulsePhase += 0.04 + Math.random()*0.02
    const pulse = (Math.sin(p.pulsePhase)+1)*0.5
    p.r = p.baseR * (0.7 + 0.3*pulse)

    ctx.globalCompositeOperation = 'lighter'
    ctx.beginPath()
    ctx.fillStyle = hsl(p.h, p.s, clamp(p.l * (0.8+0.2*pulse), 0, 1))
    ctx.arc(p.x, p.y, p.r, 0, Math.PI*2)
    ctx.fill()

    ctx.beginPath()
    ctx.fillStyle = hsl(p.h, p.s, clamp(p.l * 1.1, 0, 1))
    ctx.arc(p.x, p.y, p.r*0.5, 0, Math.PI*2)
    ctx.fill()
  }
  schedule()
}

function schedule(){
  if (!running) return
  setTimeout(()=>{
    try{ loop(performance.now()) }catch(e){}
  }, 16)
}

onmessage = (e) => {
  const msg = e.data || {}
  if (msg.type === 'init'){
    canvas = msg.canvas
    W = msg.width|0; H = msg.height|0; DPR = msg.dpr||1
    if (canvas){
      ctx = canvas.getContext('2d', { alpha: true })
      canvas.width = W; canvas.height = H
    }
  } else if (msg.type === 'resize'){
    W = msg.width|0; H = msg.height|0; DPR = msg.dpr||1
    if (canvas){
      canvas.width = W; canvas.height = H
    }
  } else if (msg.type === 'config'){
    palette = msg.palette || []
    particles.length = 0
    if (palette && palette.length){
      palette.forEach(c=> emit(c.h, c.s, c.l, 0.6))
    }
  } else if (msg.type === 'start'){
    if (!running){
      running = true
      lastTime = performance.now()
      schedule()
    }
  } else if (msg.type === 'stop'){
    running = false
  }
}
