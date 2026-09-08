import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AudioLines, Upload, Play, Pause, RotateCcw, Volume2, VolumeX, Headphones, ArrowUpRight, SlidersHorizontal, Info, X, LoaderCircle, ImagePlus, Music2, Waves, Layers3, ChevronDown } from 'lucide-react'
import { readImage } from './image.js'
import { makeComposition, SCALES, noteName } from '../audio/composition.js'
import { AudioEngine, renderComposition } from '../audio/engine.js'
const EXAMPLE = `${import.meta.env.BASE_URL}examples/lago-al-atardecer.webp`
const percent = value => Math.round(value * 100)
const clock = value => `${Math.floor(value / 60).toString().padStart(2, '0')}:${Math.floor(value % 60).toString().padStart(2, '0')}`

function Range({ label, value, onChange, min = 0, max = 100, suffix = '%', icon: Icon, disabled = false, defer = false }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const shown = defer ? draft : value
  const commit = () => { if (defer && draft !== value) onChange(draft) }
  return <label className="range-field"><span className="range-label"><span>{Icon && <Icon size={16} aria-hidden="true" />}{label}</span><output>{shown}{suffix}</output></span><input type="range" min={min} max={max} value={shown} disabled={disabled} onChange={e => defer ? setDraft(Number(e.target.value)) : onChange(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} style={{ '--fill': `${(shown - min) / (max - min) * 100}%` }} /></label>
}
function Player({ engineRef, state, ready, composition, stageRef, cursorRef, busy, progress, onError }) {
  const [position, setPosition] = useState(0), [volume, setVolume] = useState(75)
  const savedVolume = useRef(75)
  const playing = state === 'playing', interrupted = state === 'interrupted'
  useEffect(() => {
    let timer
    const update = () => {
      const engine = engineRef.current, pos = engine?.position() || 0, duration = engine?.stems?.duration || composition?.duration || 1
      setPosition(pos)
      stageRef.current?.style.setProperty('--scan', `${pos / duration * 100}%`)
      cursorRef.current?.setAttribute('x1', String(pos / duration * 640)); cursorRef.current?.setAttribute('x2', String(pos / duration * 640))
    }
    const visibility = () => { clearInterval(timer); update(); if (!document.hidden && playing) timer = setInterval(update, 100) }
    visibility(); document.addEventListener('visibilitychange', visibility)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visibility) }
  }, [state, composition, engineRef, stageRef, cursorRef, playing])
  const toggle = async () => {
    try { const engine = engineRef.current; if (!engine) return; if (playing) engine.pause(); else await engine.play() }
    catch { onError('No se pudo iniciar el audio. Vuelve a tocar Reproducir o prueba abrir la página en tu navegador.') }
  }
  const changeVolume = v => { setVolume(v); engineRef.current?.setMix('master', v / 100); if (v) savedVolume.current = v }
  const seek = async value => { try { await engineRef.current?.seek(value); setPosition(value) } catch { onError('Toca Reproducir para continuar.') } }
  const duration = engineRef.current?.stems?.duration || composition?.duration || 0
  return <section className="player" aria-label="Reproductor">
    <div className="player-main">
      <button className="play-button" onClick={toggle} disabled={!ready || !!busy} aria-label={playing ? 'Pausar melodía' : interrupted ? 'Reanudar audio' : 'Reproducir melodía'}>
        {busy ? <LoaderCircle className="spin" size={21} /> : playing ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}<span>{busy ? busy === 'image' ? 'Analizando…' : `Preparando ${percent(progress)}%` : playing ? 'Pausar' : interrupted ? 'Reanudar' : 'Reproducir'}</span>
      </button>
      <button className="icon-button restart" aria-label="Volver al inicio" title="Volver al inicio" disabled={!ready || !!busy} onClick={() => seek(0)}><RotateCcw size={19} /></button>
      <div className="playback-status"><span className={playing ? 'status-line active' : 'status-line'}><AudioLines size={15}/>{playing ? 'Escuchando tu imagen' : interrupted ? 'Audio interrumpido' : ready ? 'Lista para escuchar' : 'Prepara tu imagen'}</span><span className="timecode">{clock(position)} <span>/ {clock(duration)}</span><span className="loop-label">EN BUCLE</span></span></div>
      <div className="master-volume"><button type="button" className="icon-button" aria-label={volume ? 'Silenciar' : 'Activar sonido'} onClick={() => changeVolume(volume ? 0 : savedVolume.current)}>{volume ? <Volume2 size={20}/> : <VolumeX size={20}/>}</button><input aria-label="Volumen general" type="range" min="0" max="100" value={volume} onChange={e => changeVolume(Number(e.target.value))} style={{ '--fill': `${volume}%` }}/></div>
    </div>
    <input className="seek" aria-label="Posición de reproducción" type="range" min="0" max={duration || 1} step=".1" value={Math.min(position, duration || 1)} disabled={!ready || !!busy} onChange={e => seek(Number(e.target.value))} style={{ '--fill': `${duration ? position / duration * 100 : 0}%` }}/>
  </section>
}

export default function ColorSynth() {
  const [picture, setPicture] = useState(null), [data, setData] = useState(null), [error, setError] = useState('')
  const [busy, setBusy] = useState('image'), [progress, setProgress] = useState(0), [ready, setReady] = useState(false), [state, setState] = useState('paused')
  const [scale, setScale] = useState('auto'), [tempo, setTempo] = useState(0), [mix, setMix] = useState({ melody: 90, harmony: 65, drone: 40 })
  const [dragging, setDragging] = useState(false)
  const engineRef = useRef(null), loadRef = useRef(null), renderAbort = useRef(null), renderQueue = useRef(Promise.resolve()), fileRef = useRef(null), dialogRef = useRef(null), stageRef = useRef(null), cursorRef = useRef(null), previewURL = useRef(null), mounted = useRef(false)
  const composition = useMemo(() => data ? makeComposition(data, { scale, bpm: tempo || data.bpm }) : null, [data, scale, tempo])

  const loadFile = useCallback(async (file, title, example = false, controller = new AbortController()) => {
    loadRef.current?.abort(); loadRef.current = controller; renderAbort.current?.abort()
    engineRef.current?.clear(); setReady(false); setBusy('image'); setError(''); setProgress(0); setData(null)
    try {
      const result = await readImage(file, controller.signal)
      if (controller.signal.aborted || !mounted.current) return
      if (previewURL.current) URL.revokeObjectURL(previewURL.current)
      previewURL.current = URL.createObjectURL(result.blob)
      setPicture({ url: previewURL.current, title: title || file.name || 'Mi imagen', width: result.width, height: result.height, example })
      setScale('auto'); setTempo(0); setData(result.stats)
    } catch (err) {
      if (err.name !== 'AbortError' && mounted.current && loadRef.current === controller) { setError(err.message); setBusy(''); setData(null) }
    }
  }, [])
  const loadExample = useCallback(async () => {
    const controller = new AbortController(); loadRef.current?.abort(); loadRef.current = controller
    setError(''); setBusy('image'); setReady(false); renderAbort.current?.abort(); engineRef.current?.clear(); setData(null)
    try {
      const response = await fetch(EXAMPLE, { signal: controller.signal })
      if (!response.ok) throw new Error('No se pudo cargar el ejemplo.')
      const blob = await response.blob()
      if (controller.signal.aborted || !mounted.current) return
      // A fresh controller owns decode; this fetch has already finished.
      await loadFile(blob, 'Lago al atardecer', true)
    } catch (err) { if (err.name !== 'AbortError' && mounted.current) { setBusy(''); setError('No pudimos cargar el ejemplo. Puedes subir tu propia imagen.') } }
  }, [loadFile])

  useEffect(() => {
    mounted.current = true; engineRef.current = new AudioEngine(setState)
    loadExample()
    const resume = () => {
      const engine = engineRef.current
      if (!document.hidden && engine?.playing) engine.unlock().catch(() => setState('interrupted'))
    }
    document.addEventListener('visibilitychange', resume); window.addEventListener('pageshow', resume)
    return () => { mounted.current = false; loadRef.current?.abort(); renderAbort.current?.abort(); engineRef.current?.dispose(); if (previewURL.current) URL.revokeObjectURL(previewURL.current); document.removeEventListener('visibilitychange', resume); window.removeEventListener('pageshow', resume) }
  }, [loadExample])

  useEffect(() => {
    if (!composition) return
    const controller = new AbortController(); renderAbort.current?.abort(); renderAbort.current = controller
    engineRef.current?.clear(); setReady(false); setBusy('audio'); setProgress(0)
    // Serialize renders: quick file changes cannot accumulate OfflineAudioContexts.
    renderQueue.current = renderQueue.current.catch(() => {}).then(async () => {
      if (controller.signal.aborted) return
      try {
        const stems = await renderComposition(composition, controller.signal, v => { if (!controller.signal.aborted) setProgress(v) })
        if (controller.signal.aborted || !mounted.current) return
        engineRef.current?.load(stems); setReady(true); setBusy('')
      } catch (err) { if (err.name !== 'AbortError' && !controller.signal.aborted && mounted.current) { setError(err.message); setBusy('') } }
    })
    return () => controller.abort()
  }, [composition])

  const handleFile = file => {
    if (!file) return
    if (file.type && !file.type.startsWith('image/')) { setError('Elige una imagen JPG, PNG, WebP u otro formato compatible.'); return }
    loadFile(file, file.name)
  }
  const changeMix = (key, value) => { setMix(current => ({ ...current, [key]: value })); engineRef.current?.setMix(key, value / 100) }
  const colorNotes = useMemo(() => data && composition ? data.dominantColors.map(c => ({ ...c, note: noteName(composition.root + 12 + composition.scale.notes[c.s < .09 ? 0 : Math.floor(c.h / 360 * composition.scale.notes.length)]) })) : [], [data, composition])
  const playing = state === 'playing'
  return <div className="app-shell">
    <header className="site-header"><a className="brand" href={import.meta.env.BASE_URL} aria-label="Colores a sonidos, inicio"><span className="brand-icon"><AudioLines size={24}/></span><span>colores<span className="brand-light"> a </span>sonidos<span className="brand-dot">.</span></span></a><button className="help-button" onClick={() => dialogRef.current?.showModal()}><Info size={17}/><span>Cómo funciona</span></button></header>
    <main>
      <div className="intro"><div><div className="eyebrow">UN EXPERIMENTO ENTRE COLOR Y MÚSICA</div><h1>Escucha lo que ves<span>.</span></h1><p>Sube una imagen. Descubre su paisaje sonoro.</p></div><button className="upload-button" onClick={() => fileRef.current?.click()}><Upload size={18}/>Subir imagen<ArrowUpRight size={17}/></button></div>
      <input ref={fileRef} type="file" accept="image/*" className="visually-hidden" aria-label="Seleccionar imagen" onChange={e => { handleFile(e.target.files?.[0]); e.target.value = '' }}/>
      {error && <div className="error-message" role="alert"><Info size={20}/><span>{error}</span><button className="icon-button" aria-label="Cerrar aviso" onClick={() => setError('')}><X size={18}/></button></div>}
      <div className="workspace">
        <div className="visual-column">
          <section className={`image-panel ${dragging ? 'dragging' : ''}`} aria-label="Imagen que se convierte en música" onDragOver={e => { e.preventDefault(); setDragging(true) }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) }} onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]) }}>
            <div className="panel-heading"><span><span className="section-number">01</span>Tu imagen</span><button className="text-button" onClick={() => fileRef.current?.click()}><ImagePlus size={16}/>Cambiar</button></div>
            <div ref={stageRef} className={`image-stage ${playing ? 'is-playing' : ''}`}>
              {picture ? <img src={picture.url} alt={picture.example ? 'Lago entre montañas y bosques, bajo un cielo naranja y azul al atardecer' : `Imagen seleccionada: ${picture.title}`} width={picture.width} height={picture.height}/> : <button className="empty-image" onClick={() => fileRef.current?.click()}><ImagePlus size={38}/><span>Elige una imagen para escucharla</span><small>También puedes arrastrarla aquí</small></button>}
              {picture && <><div className="image-topline"><span className="image-badge">{picture.example ? 'PAISAJE DE EJEMPLO' : 'TU PAISAJE SONORO'}</span><span className="image-badge dimensions">{picture.width} × {picture.height}</span></div><div className="image-caption"><div><span className="small-label">{picture.example ? 'IMAGEN GENERADA · DEMO' : 'IMAGEN SELECCIONADA'}</span><h2>{picture.title}</h2></div><span className="sound-mark" aria-hidden="true"><AudioLines size={25}/></span></div><div className="scan-line" aria-hidden="true"/></>}
              {busy === 'image' && <div className="loading-image" role="status"><LoaderCircle size={23} className="spin"/><span>Leyendo los colores…</span></div>}
              {dragging && <div className="drop-overlay"><Upload size={32}/><span>Suelta tu imagen aquí</span></div>}
            </div>
            <div className="score-area"><div className="score-heading"><span><Music2 size={14}/>Recorrido de la melodía</span><span>IZQUIERDA → DERECHA</span></div><svg className="score" viewBox="0 0 640 72" role="img" aria-label="Partitura visual: cada marca representa una nota de la imagen" preserveAspectRatio="none">
              {[12, 28, 44, 60].map(y => <line key={y} x1="0" x2="640" y1={y} y2={y} stroke="#2a2c33" strokeWidth=".6"/>)}
              {composition?.notes.map((n, i) => <rect key={i} x={n.time / composition.duration * 640} y={Math.max(4, 62 - (n.midi - composition.root - 10) * 2)} width={Math.min(18, n.duration / composition.duration * 450)} height="4" rx="2" fill={`hsl(${n.hue} 64% 70%)`} opacity=".85"/>)}
              <line ref={cursorRef} x1="0" x2="0" y1="0" y2="72" stroke="#daf994" opacity={playing ? 1 : .3}/>
            </svg></div>
            <Player engineRef={engineRef} state={state} ready={ready} composition={composition} stageRef={stageRef} cursorRef={cursorRef} busy={busy} progress={progress} onError={setError}/>
          </section>
          <section className="palette-panel" aria-label="Colores y notas"><div className="panel-heading"><span><span className="section-number">02</span>La paleta de tu melodía</span><span className="muted">Color → nota</span></div><div className="palette">{colorNotes.length ? colorNotes.map((c, i) => <div className="palette-color" key={i}><div className="swatch" style={{ background: c.hex }} title={`${c.hex} · ${percent(c.weight)}% de la imagen`}/><span className="note-name">{c.note}</span><span className="hex-code">{c.hex.toUpperCase()}</span></div>) : <p className="muted">Los colores aparecerán al analizar tu imagen.</p>}</div></section>
          <div className="privacy-line"><Headphones size={15}/><span>Mejor con audífonos. Tus imágenes se procesan en tu dispositivo.</span></div>
        </div>
        <aside className="controls-column" aria-label="Ajustes e interpretación musical">
          <section className="control-panel"><div className="panel-heading"><span><SlidersHorizontal size={17}/>Tu sonido</span><span className="tag">AMBIENT</span></div>
            <div className="scale-summary"><span className="eyebrow">EL COLOR MARCA EL TONO</span><h2>{composition?.scale.name || 'Descubriendo el tono…'}</h2><p>{composition?.scale.character || 'Una melodía nacida de tu imagen'}</p></div>
            <label className="select-field"><span>Escala musical</span><span className="select-wrap"><select value={scale} onChange={e => setScale(e.target.value)} disabled={!data || !!busy}><option value="auto">Automática · según la imagen</option>{Object.entries(SCALES).map(([key, s]) => <option key={key} value={key}>{s.name}</option>)}</select><ChevronDown size={16}/></span></label>
            <div className="tempo-control"><Range defer label="Tempo" value={tempo || data?.bpm || 78} min={48} max={112} suffix=" BPM" disabled={!data || !!busy} onChange={setTempo}/>{tempo > 0 && <button className="text-button reset-tempo" onClick={() => setTempo(0)} disabled={!!busy}>Usar tempo de la imagen</button>}</div>
            <div className="control-divider"/>
            <div className="section-subheading"><h3>Capas del sonido</h3><span>MEZCLA</span></div>
            <div className="mixer"><Range icon={Music2} label="Melodía" value={mix.melody} onChange={v => changeMix('melody', v)}/><Range icon={Layers3} label="Armonía" value={mix.harmony} onChange={v => changeMix('harmony', v)}/><Range icon={Waves} label="Ambiente" value={mix.drone} onChange={v => changeMix('drone', v)}/></div>
          </section>
          <section className="analysis-panel"><div className="panel-heading"><span><span className="section-number">03</span>Lo que cuenta tu imagen</span></div><div className="metrics">{[['Diversidad de color', data?.entropy, 'entropy', 'Entropía'], ['Luminosidad', data?.avgBrightness, 'light', 'Ritmo'], ['Saturación', data?.avgSaturation, 'saturation', 'Timbre']].map(([label, v, name, effect]) => <div className="metric" key={name}><div><span>{label}</span><strong>{v == null ? '—' : `${percent(v)}%`}</strong></div><div className={`metric-track ${name}`}><span style={{ width: `${v == null ? 0 : percent(v)}%` }}/></div><small>{effect}</small></div>)}</div><div className="temperature"><span>Temperatura predominante</span><strong>{!data ? '—' : data.neutral ? 'Neutra' : data.coolness > .56 ? 'Fría' : data.coolness < .44 ? 'Cálida' : 'Mixta'}</strong></div></section>
          {!picture?.example && <button className="example-button" onClick={loadExample}><img src={EXAMPLE} alt=""/><span>Prueba el lago al atardecer<small>Escuchar una imagen de ejemplo</small></span><ArrowUpRight size={18}/></button>}
        </aside>
      </div>
    </main>
    <footer><span>Una idea de <strong>Diego Bastías A.</strong></span><span>Color, matemáticas y un poco de curiosidad.</span></footer>
    <dialog ref={dialogRef} className="help-dialog" aria-labelledby="help-title" onClick={e => { if (e.target === e.currentTarget) e.currentTarget.close() }}><div className="dialog-inner"><div className="panel-heading"><span className="eyebrow">DE LA IMAGEN A LA MÚSICA</span><button className="icon-button" aria-label="Cerrar explicación" onClick={() => dialogRef.current.close()}><X size={21}/></button></div><h2 id="help-title">¿Cómo suena una imagen?</h2><p>Esta es una interpretación artística: no existe un sonido único o científicamente correcto para cada color.</p><div className="help-steps"><p><strong>El tono elige la escala.</strong> Los colores cálidos sugieren escalas abiertas; los fríos, escalas más contemplativas. Los grises tienen su propio tratamiento.</p><p><strong>La entropía aporta movimiento.</strong> Medimos cómo se distribuyen los colores. Una paleta diversa genera más notas; una uniforme deja más espacio.</p><p><strong>La luz y la saturación dan carácter.</strong> La luminosidad marca el tempo y el registro. La saturación cambia la intensidad de las notas.</p><p><strong>La imagen se recorre de izquierda a derecha.</strong> Cada zona inspira una parte de la melodía, acompañada por acordes y una base ambiental. El ciclo se repite suavemente.</p></div><p className="help-note">La misma imagen y los mismos ajustes producen la misma composición. Si tu teléfono suspende el audio al bloquearse o cambiar de aplicación, vuelve y toca Reanudar.</p><button className="play-button" onClick={() => dialogRef.current.close()}>Volver a mi imagen</button></div></dialog>
  </div>
}
