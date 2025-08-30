import React, { useState, useRef, useEffect } from 'react';
import * as Tone from 'tone';
import { Upload, Play, Pause, Volume2, Settings, SlidersHorizontal } from 'lucide-react';

// Asegura el contexto de audio y suaviza el scheduling
const ensureAudioContext = async () => {
  if (Tone.context.state !== 'running') {
    await Tone.start();
  }
  try {
    const ctx = Tone.getContext();
    if (typeof ctx.lookAhead !== 'undefined') ctx.lookAhead = 0.1;
  } catch {}
};

const SintetizadorDeColores = () => {
  // Estado general
  const [imagen, setImagen] = useState(null);
  const [reproduciendo, setReproduciendo] = useState(false);
  const [analizando, setAnalizando] = useState(false);
  const [datosColor, setDatosColor] = useState(null);
  const [ajustesAudio, setAjustesAudio] = useState({ volume: -18, reverb: 0.35, filter: 1200 });
  const [audioListo, setAudioListo] = useState(false);
  const [audioError, setAudioError] = useState(null);

  // Mixer (dB)
  const [mixer, setMixer] = useState({
    droneDb: -24,
    coloresDb: -16,
    plucksDb: -20,
    padDb: -22,
    campanasDb: -24,
    ruidoDb: -35,
    bateriaDb: -28,
  });

  // Refs
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const wasPlayingRef = useRef(false);
  const currentImageUrlRef = useRef(null);
  const analyzeAbortRef = useRef({ aborted: false });

  // Nodos
  const masterRef = useRef(null);
  const fxRef = useRef({ reverb: null, delay: null, comp: null, limiter: null });
  const busesRef = useRef({ drone: null, colores: null, plucks: null, pad: null, campanas: null, ruido: null, bateria: null });

  // Instrumentos de tono/ambiente
  const ambientSynthRef = useRef(null);
  const synthsRef = useRef([]);     // voces por color
  const plucksRef = useRef([]);     // plucks
  const padRef = useRef(null);      // AMSynth pad
  const campanasRef = useRef(null); // FMSynth bells
  const ruidoRef = useRef({ noise: null, autoFilter: null, filter: null });

  // Drumkit
  const kickRef = useRef(null);
  const snareRef = useRef(null);
  const hatRef = useRef(null);

  // Loops
  const loopColoresRef = useRef(null);
  const loopPlucksRef = useRef(null);
  const loopPadRef = useRef(null);
  const loopCampanasRef = useRef(null);
  const seqKickRef = useRef(null);
  const seqSnareRef = useRef(null);
  const seqHatRef = useRef(null);

  // Escalas
  const escalas = {
    frio: ['C3','D3','Eb3','F3','G3','Ab3','Bb3','C4'],
    calido: ['C3','D3','E3','F#3','G3','A3','B3','C4'],
    pastel: ['C3','E3','G3','B3','D4','F#4'],
    brillante: ['C3','D#3','F#3','A3','C4','D#4','F#4'],
    dorica: ['C3','D3','Eb3','F3','G3','A3','Bb3','C4'],
    frigia: ['C3','Db3','Eb3','F3','G3','Ab3','Bb3','C4'],
    lidia: ['C3','D3','E3','F#3','G3','A3','B3','C4'],
    whole: ['C3','D3','E3','F#3','G#3','A#3','C4'],
    hira: ['C3','Db3','F3','G3','Ab3','C4'],
    pentMenor: ['C3','Eb3','F3','G3','Bb3','C4'],
    pentMayor: ['C3','D3','E3','G3','A3','C4']
  };

  useEffect(() => {
    // Inicializa audio + manejador de visibilidad
    (async () => {
      try {
        await ensureAudioContext();
        setupGlobalAudio();
        const onVis = async () => {
          if (document.visibilityState === 'visible' && wasPlayingRef.current) {
            try { await Tone.context.resume(); Tone.Transport.start(); } catch {}
          }
        };
        document.addEventListener('visibilitychange', onVis);
        return () => document.removeEventListener('visibilitychange', onVis);
      } catch (e) {
        setAudioError(e?.message || String(e));
      }
    })();
    return () => hardStopAndDispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Aplica mezclador cuando cambian los sliders
  useEffect(() => {
    try {
      const setBusDb = (bus, db) => bus?.gain?.rampTo(Tone.dbToGain(db), 0.05);
      const B = busesRef.current;
      if (!B) return;
      setBusDb(B.drone, mixer.droneDb);
      setBusDb(B.colores, mixer.coloresDb);
      setBusDb(B.plucks, mixer.plucksDb);
      setBusDb(B.pad, mixer.padDb);
      setBusDb(B.campanas, mixer.campanasDb);
      setBusDb(B.ruido, mixer.ruidoDb);
      setBusDb(B.bateria, mixer.bateriaDb);
    } catch {}
  }, [mixer]);

  const setupGlobalAudio = () => {
    if (!masterRef.current) {
      const master = new Tone.Gain(1);
      const comp = new Tone.Compressor(-22, 3);
      const limiter = new Tone.Limiter(-1);
      const reverb = new Tone.Reverb({ roomSize: ajustesAudio.reverb, wet: 0.3 });
      const delay = new Tone.FeedbackDelay({ delayTime: '8n', feedback: 0.2, wet: 0.12 });
      master.chain(comp, limiter, Tone.Destination);
      fxRef.current = { reverb, delay, comp, limiter };
      masterRef.current = master;

      // Buses (mezclador)
      const makeBus = (db) => new Tone.Gain(Tone.dbToGain(db));
      busesRef.current = {
        drone: makeBus(mixer.droneDb),
        colores: makeBus(mixer.coloresDb),
        plucks: makeBus(mixer.plucksDb),
        pad: makeBus(mixer.padDb),
        campanas: makeBus(mixer.campanasDb),
        ruido: makeBus(mixer.ruidoDb),
        bateria: makeBus(mixer.bateriaDb),
      };
      Object.values(busesRef.current).forEach(bus => {
        bus.chain(fxRef.current.delay, fxRef.current.reverb, masterRef.current);
      });
    }
    setAudioListo(true);
  };

  // ---------- Análisis de imagen ----------

  const analizarImagen = (file) => {
    // cancelar análisis anterior
    analyzeAbortRef.current.aborted = true;
    analyzeAbortRef.current = { aborted: false };

    return new Promise((resolve) => {
      setAnalizando(true);
      const localAbort = analyzeAbortRef.current;

      const img = new Image();
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      img.onload = () => {
        if (localAbort.aborted) return;
        const maxSize = 200;
        const ratio = Math.min(maxSize / img.width, maxSize / img.height);
        canvas.width = Math.max(1, Math.floor(img.width * ratio));
        canvas.height = Math.max(1, Math.floor(img.height * ratio));

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const pixels = imageData.data;

        let totalBrightness = 0, totalSaturation = 0, cool = 0, warm = 0, pastel = 0, bright = 0, count = 0;
        const grupos = [];

        for (let i = 0; i < pixels.length; i += 16) {
          if (localAbort.aborted) return;
          const r = pixels[i], g = pixels[i+1], b = pixels[i+2];
          if (pixels[i+3] === 0) continue;
          const { h, s, l } = rgbToHsl(r, g, b);
          totalBrightness += l; totalSaturation += s; count++;
          if (h >= 120 && h <= 300) cool++; else warm++;
          if (s < 0.3 && l > 0.7) pastel++; else if (s > 0.7 || l < 0.3) bright++;

          const grp = { h: Math.round(h/15)*15, s, l, weight: 1 }; // más fino para drums
          const ex = grupos.find(gp => gp.h === grp.h);
          if (ex) { ex.weight++; ex.s = (ex.s + s)/2; ex.l = (ex.l + l)/2; }
          else grupos.push(grp);
        }

        if (localAbort.aborted) return;

        const avgB = count ? totalBrightness / count : 0.5;
        const avgS = count ? totalSaturation / count : 0.5;
        const coolness = (cool+warm) ? cool / (cool+warm) : 0.5;
        const pastelness = count ? pastel / count : 0;
        const brightness = count ? bright / count : 0;

        grupos.sort((a,b) => b.weight - a.weight);
        const dominantes = grupos.slice(0, 10);
        const uniqueHues = new Set(dominantes.map(c => c.h)).size;
        const entropia = dominantes.length ? uniqueHues / dominantes.length : 0.5;

        const analisis = {
          avgBrightness: avgB,
          avgSaturation: avgS,
          coolness,
          pastelnessRatio: pastelness,
          brightnessRatio: brightness,
          dominantColors: dominantes,
          colorEntropy: entropia,
          bpm: Math.round(60 + (avgB * 100)),
          contrast: Math.abs((dominantes[0]?.l ?? 0.5) - (dominantes[1]?.l ?? 0.5))
        };

        if (!localAbort.aborted) {
          setDatosColor(analisis);
          setAnalizando(false);
          resolve(analisis);
        }
      };

      const url = URL.createObjectURL(file);
      if (currentImageUrlRef.current) URL.revokeObjectURL(currentImageUrlRef.current);
      currentImageUrlRef.current = url;
      img.src = url;
    });
  };

  const rgbToHsl = (r, g, b) => {
    r/=255; g/=255; b/=255;
    const max=Math.max(r,g,b), min=Math.min(r,g,b);
    let h,s,l=(max+min)/2;
    if(max===min){ h=s=0; }
    else{
      const d=max-min;
      s=l>0.5? d/(2-max-min) : d/(max+min);
      switch(max){
        case r: h=(g-b)/d + (g<b?6:0); break;
        case g: h=(b-r)/d + 2; break;
        case b: h=(r-g)/d + 4; break;
        default: h=0;
      }
      h/=6;
    }
    return { h:h*360, s, l };
  };

  // ---------- Audio ----------

  const seleccionarEscala = (d, color) => {
    if (d.pastelnessRatio > 0.35) return escalas.pastel;
    if (d.brightnessRatio > 0.5) return escalas.brillante;
    if (d.coolness > 0.65) return escalas.dorica;
    if (d.coolness < 0.35) return escalas.lidia;
    if (d.avgSaturation < 0.25) return escalas.pentMenor;
    if (color.h % 60 === 0) return escalas.whole;
    if (color.h % 90 === 0) return escalas.hira;
    return (color.s > 0.6) ? escalas.pentMayor : escalas.frio;
  };

  const setupAudioParaDatos = async (d) => {
    try {
      setAudioError(null);
      await ensureAudioContext();
      setupGlobalAudio();
      limpiarVoces(); // conserva FX y buses

      // Alinear BPM del transport para coherencia de duraciones tipo '8n', '16n'
      Tone.Transport.bpm.rampTo(d.bpm, 0.1);

      // DRONE
      const ambient = new Tone.Synth({ oscillator:{ type:'sine' }, envelope:{ attack:2.5, decay:1.2, sustain:0.85, release:3.5 } });
      const lowpass = new Tone.Filter({ frequency: ajustesAudio.filter, type:'lowpass' });
      ambient.chain(lowpass, busesRef.current.drone);
      ambient.volume.value = ajustesAudio.volume;
      ambientSynthRef.current = ambient;
      ambient.triggerAttack('C2');

      // COLORES
      d.dominantColors.slice(0,6).forEach((color, idx) => {
        const escala = seleccionarEscala(d, color);
        const synth = new Tone.Synth({ oscillator:{ type:'triangle' }, envelope:{ attack:0.25, decay:0.6, sustain:0.45, release:1.2 } });
        const filt = new Tone.Filter({ frequency: 900, type:'lowpass' });
        const trem = new Tone.Tremolo(0.5 + d.avgSaturation * 1.5, 0.2).start();
        synth.chain(filt, trem, busesRef.current.colores);
        synth.volume.value = ajustesAudio.volume - 14 - (idx*2);
        synthsRef.current.push({ synth, filter: filt, escala, color });
      });

      // PLUCKS
      for (let i=0;i<2;i++){
        const pl = new Tone.PluckSynth({ attackNoise:1.2, dampening:3500, resonance:0.8 });
        const pan = new Tone.AutoPanner(0.1 + i*0.05).start();
        pl.chain(pan, busesRef.current.plucks);
        pl.volume.value = ajustesAudio.volume - 18 - i*2;
        plucksRef.current.push(pl);
      }

      // PAD (AMSynth)
      const pad = new Tone.AMSynth({ oscillator:{ type:'sine' }, envelope:{ attack:1.5, decay:1.2, sustain:0.9, release:4 } });
      pad.chain(busesRef.current.pad);
      padRef.current = pad;

      // CAMPANAS (FMSynth)
      const bells = new Tone.FMSynth({
        harmonicity: 8, modulationIndex: 2,
        envelope: { attack: 0.01, decay: 1.2, sustain: 0.0, release: 2.5 },
        modulation: { type: 'sine' },
        modulationEnvelope: { attack: 0.01, decay: 0.2, sustain: 0 }
      });
      bells.chain(busesRef.current.campanas);
      campanasRef.current = bells;

      // RUIDO (pink) con AutoFilter lento
      const noise = new Tone.Noise('pink');
      const autoF = new Tone.AutoFilter(0.06, 200, 2).start(); // lento
      const rf = new Tone.Filter({ frequency: 900, type:'lowpass' });
      noise.chain(autoF, rf, busesRef.current.ruido);
      ruidoRef.current = { noise, autoFilter: autoF, filter: rf };
      noise.start(); // control por bus

      // DRUMS (kick/snare/hats) muy leves
      const kick = new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 6, oscillator: { type: 'sine' }, envelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.4 } });
      kick.chain(busesRef.current.bateria);
      kickRef.current = kick;

      const snare = new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.2, sustain: 0 }
      });
      const snareHP = new Tone.Filter({ type: 'highpass', frequency: 1800 });
      snare.chain(snareHP, busesRef.current.bateria);
      snareRef.current = snare;

      const hat = new Tone.MetalSynth({
        frequency: 250, envelope: { attack: 0.001, decay: 0.05, release: 0.01 },
        harmonicity: 5.1, modulationIndex: 32, resonance: 3000, octaves: 1.5
      });
      hat.chain(busesRef.current.bateria);
      hatRef.current = hat;

      // Construir patrones de batería en base a colores fuertes
      const patterns = construirPatronesBateria(d);
      crearSecuenciasDrum(patterns);

      return true;
    } catch (e) {
      setAudioError(e?.message || String(e));
      return false;
    }
  };

  // --- Patrones de batería a partir de colores ---

  const construirPatronesBateria = (d) => {
    const steps = 16;
    const kick = Array(steps).fill(0);
    const snare = Array(steps).fill(0);
    const hat = Array(steps).fill(0);

    // Determinar colores "fuertes" (no pastel, suficiente saturación y luz media)
    const fuertes = d.dominantColors
      .filter(c => c.s > 0.55 && c.l > 0.25 && c.l < 0.8)
      .slice(0, 6);

    const totalPeso = fuertes.reduce((acc, c) => acc + (c.weight || 1), 0) || 1;

    // util: Euclidean rhythm
    const euclid = (pulses, len, rot=0) => {
      const pattern = Array(len).fill(0);
      let bucket = 0;
      for (let i=0;i<len;i++){
        bucket += pulses;
        if (bucket >= len) { bucket -= len; pattern[(i+rot)%len] = 1; }
      }
      return pattern;
    };

    const addPattern = (arr, pat, weight, vel=1) => {
      for (let i=0;i<arr.length;i++) arr[i] += (pat[i] ? weight*vel : 0);
    };

    const rotFromHue = (h) => Math.floor(((h % 360) / 360) * steps) % steps;

    fuertes.forEach(c => {
      const w = (c.weight || 1) / totalPeso;
      const rot = rotFromHue(c.h);
      // Mapeo por grupos de color
      if (c.h < 20 || c.h >= 340) {
        // ROJO → patrones de bombo densos y directos (E(5,16))
        addPattern(kick, euclid(5, steps, rot), w, 1.0);
        addPattern(hat, euclid(7, steps, rot+2), w*0.5);
      } else if (c.h < 50) {
        // NARANJO → síncopa en snare (E(3,8) sobre 16) + kick ligero
        const sn = euclid(3, 8, Math.floor(rot/2));
        // expandir a 16
        const sn16 = sn.flatMap(v => [v,0]);
        addPattern(snare, sn16, w, 0.9);
        addPattern(kick, euclid(3, steps, rot+1), w*0.5);
      } else if (c.h < 90) {
        // AMARILLO → hats con pulso estable (E(5,16))
        addPattern(hat, euclid(5, steps, rot), w, 0.9);
      } else if (c.h < 165) {
        // VERDE → kick quebrado y hats entrecortados
        addPattern(kick, euclid(4, steps, rot+1), w*0.8);
        addPattern(hat, euclid(3, steps, rot+3), w*0.6);
      } else if (c.h < 210) {
        // CIAN → hats abiertos ocasionales (representados con mayor vel)
        addPattern(hat, euclid(2, steps, rot+2), w*1.2);
      } else if (c.h < 270) {
        // AZUL → snare en 3 con fantasmas
        const base = Array(steps).fill(0); base[4] = 1; base[12] = 1; // 2 y 4 en 16
        addPattern(snare, base, w, 1.0);
        addPattern(snare, euclid(2, steps, rot+5), w*0.4); // ghosts
      } else {
        // MORADO → contratiempos ligeros en hats
        addPattern(hat, euclid(4, steps, rot+4), w*0.8);
      }
    });

    // Normalizar y umbral para convertir en golpes discretos
    const thresh = (arr, t) => arr.map(v => v >= t ? 1 : 0);

    // El umbral depende de cuántos colores fuertes hay (menos colores → más fácil disparar)
    const n = Math.max(1, fuertes.length);
    const kT = 0.4 / Math.sqrt(n);
    const sT = 0.45 / Math.sqrt(n);
    const hT = 0.35 / Math.sqrt(n);

    return {
      kick: thresh(kick, kT),
      snare: thresh(snare, sT),
      hat: thresh(hat, hT),
      // Velocidades suaves por defecto
      velKick: kick.map(v => v ? 0.25 : 0),
      velSnare: snare.map(v => v ? 0.18 : 0),
      velHat: hat.map(v => v ? 0.12 : 0),
    };
  };

  const crearSecuenciasDrum = ({kick, snare, hat, velKick, velSnare, velHat}) => {
    // Limpiar secuencias previas
    try { seqKickRef.current?.dispose?.(); } catch {}
    try { seqSnareRef.current?.dispose?.(); } catch {}
    try { seqHatRef.current?.dispose?.(); } catch {}
    seqKickRef.current = null; seqSnareRef.current = null; seqHatRef.current = null;

    // Crear Sequence con 16 pasos cada '16n'
    seqKickRef.current = new Tone.Sequence((time, step) => {
      if (!kickRef.current) return;
      if (kick[step]) kickRef.current.triggerAttackRelease('C1', '8n', time, velKick[step] || 0.2);
    }, Array.from({length:16}, (_,i)=>i), '16n');

    seqSnareRef.current = new Tone.Sequence((time, step) => {
      if (!snareRef.current) return;
      if (snare[step]) snareRef.current.triggerAttackRelease('8n', time, velSnare[step] || 0.15);
    }, Array.from({length:16}, (_,i)=>i), '16n');

    seqHatRef.current = new Tone.Sequence((time, step) => {
      if (!hatRef.current) return;
      if (hat[step]) hatRef.current.triggerAttackRelease('16n', time, velHat[step] || 0.1);
    }, Array.from({length:16}, (_,i)=>i), '16n');

    seqKickRef.current.start(0);
    seqSnareRef.current.start(0);
    seqHatRef.current.start(0);
  };

  // ---------- Loops armónicos/ambient ----------
  const iniciarLoops = (d) => {
    if (loopColoresRef.current) { try { loopColoresRef.current.dispose(); } catch {} }
    if (loopPlucksRef.current) { try { loopPlucksRef.current.dispose(); } catch {} }
    if (loopPadRef.current) { try { loopPadRef.current.dispose(); } catch {} }
    if (loopCampanasRef.current) { try { loopCampanasRef.current.dispose(); } catch {} }

    const paso = Math.max(0.1, 60 / Math.max(30, d.bpm));

    loopColoresRef.current = new Tone.Loop((time) => {
      synthsRef.current.forEach((obj) => {
        const baseProb = 0.12 + (d.colorEntropy * 0.18);
        const peso = Math.min(1, obj.color.weight/20);
        const sat = 0.25 + (obj.color.s * 0.75);
        const prob = baseProb * sat * peso;
        if (Math.random() < prob) {
          const nota = obj.escala[(Math.random()*obj.escala.length)|0];
          const dur = ['8n','4n','2n'][Math.floor(Math.random()*3)];
          const baseFreq = 250 + (obj.color.h * 2);
          const varPitch = (Math.random()-0.5) * d.contrast * 40;
          obj.filter.frequency.rampTo(Math.max(180, Math.min(3500, baseFreq + varPitch)), 0.08);
          obj.synth.triggerAttackRelease(nota, dur, time);
        }
      });
    }, paso);
    loopColoresRef.current.start(0);

    const intervaloPluck = Math.max(0.18, 0.6 - d.avgBrightness*0.4);
    loopPlucksRef.current = new Tone.Loop((time) => {
      if (plucksRef.current.length === 0) return;
      if (Math.random() < (0.15 + d.colorEntropy * 0.2)) {
        const idx = (Math.random()*plucksRef.current.length)|0;
        const pl = plucksRef.current[idx];
        const escala = seleccionarEscala(d, { h: 60*(1+idx), s: d.avgSaturation });
        const nota = escala[(Math.random()*escala.length)|0].replace('3','4');
        pl.triggerAttack(nota, time);
      }
    }, intervaloPluck);
    loopPlucksRef.current.start(0);

    const intervaloPad = 8;
    loopPadRef.current = new Tone.Loop((time) => {
      if (!padRef.current) return;
      if (Math.random() < 0.4) {
        const escala = seleccionarEscala(d, { h: 120, s: d.avgSaturation });
        const root = escala[(Math.random()*escala.length)|0];
        const quinta = Tone.Frequency(root).transpose(7).toNote();
        padRef.current.triggerAttackRelease(root, '2n', time);
        if (Math.random() < 0.6) padRef.current.triggerAttackRelease(quinta, '2n', time + 0.1);
      }
    }, intervaloPad);
    loopPadRef.current.start(0);

    const pasoCampanas = 2.5;
    loopCampanasRef.current = new Tone.Loop((time) => {
      if (!campanasRef.current) return;
      if (Math.random() < 0.08) {
        const escala = seleccionarEscala(d, { h: 240, s: d.avgSaturation });
        const nota = escala[(Math.random()*escala.length)|0].replace('3','5');
        campanasRef.current.triggerAttackRelease(nota, '8n', time);
      }
    }, pasoCampanas);
    loopCampanasRef.current.start(0);
  };

  // ---------- Controles ----------

  const manejarSubidaImagen = async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    setImagen(URL.createObjectURL(file));
    softStop(); // corta secuencias/voces anteriores
    const analisis = await analizarImagen(file);
    if (!analisis) return;
    const ok = await setupAudioParaDatos(analisis);
    if (ok) {
      iniciarLoops(analisis);
      if (reproduciendo) Tone.Transport.start();
    }
  };

  const alternarReproduccion = async () => {
    if (!datosColor) return;
    await ensureAudioContext();
    if (reproduciendo) {
      wasPlayingRef.current = false;
      softStop();
      Tone.Transport.stop();
      setReproduciendo(false);
    } else {
      setAudioError(null);
      const ok = await setupAudioParaDatos(datosColor);
      if (ok) {
        iniciarLoops(datosColor);
        Tone.Transport.start();
        setReproduciendo(true);
        wasPlayingRef.current = true;
      }
    }
  };

  const probarAudio = async () => {
    try {
      await ensureAudioContext();
      const t = new Tone.Synth().toDestination();
      t.triggerAttackRelease('C4','8n');
      setTimeout(()=>t.dispose(), 500);
    } catch (e) {
      setAudioError('Fallo en prueba de audio: ' + e.message);
    }
  };

  // ---------- Limpiezas ----------

  const softStop = () => {
    // Ambient sequences
    try { loopColoresRef.current?.dispose?.(); loopColoresRef.current = null; } catch {}
    try { loopPlucksRef.current?.dispose?.(); loopPlucksRef.current = null; } catch {}
    try { loopPadRef.current?.dispose?.(); loopPadRef.current = null; } catch {}
    try { loopCampanasRef.current?.dispose?.(); loopCampanasRef.current = null; } catch {}
    // Drum sequences
    try { seqKickRef.current?.dispose?.(); seqKickRef.current = null; } catch {}
    try { seqSnareRef.current?.dispose?.(); seqSnareRef.current = null; } catch {}
    try { seqHatRef.current?.dispose?.(); seqHatRef.current = null; } catch {}

    // Ambient instruments
    synthsRef.current.forEach(o => { try { o.synth.triggerRelease?.(); o.synth.dispose?.(); o.filter?.dispose?.(); } catch {} });
    synthsRef.current = [];
    plucksRef.current.forEach(pl => { try { pl.dispose?.(); } catch {} });
    plucksRef.current = [];
    if (ambientSynthRef.current) { try { ambientSynthRef.current.triggerRelease?.(); ambientSynthRef.current.dispose?.(); } catch {} ambientSynthRef.current = null; }
    if (padRef.current) { try { padRef.current.dispose?.(); } catch {} padRef.current = null; }
    if (campanasRef.current) { try { campanasRef.current.dispose?.(); } catch {} campanasRef.current = null; }

    // Drum instruments
    if (kickRef.current) { try { kickRef.current.dispose?.(); } catch {} kickRef.current = null; }
    if (snareRef.current) { try { snareRef.current.dispose?.(); } catch {} snareRef.current = null; }
    if (hatRef.current) { try { hatRef.current.dispose?.(); } catch {} hatRef.current = null; }

    // Ruido
    if (ruidoRef.current.noise) { try { ruidoRef.current.noise.stop(); } catch {} }
    if (ruidoRef.current.autoFilter) { try { ruidoRef.current.autoFilter.dispose?.(); } catch {} }
    if (ruidoRef.current.filter) { try { ruidoRef.current.filter.dispose?.(); } catch {} }
    if (ruidoRef.current.noise) { try { ruidoRef.current.noise.dispose?.(); } catch {} }
    ruidoRef.current = { noise:null, autoFilter:null, filter:null };
  };

  const hardStopAndDispose = () => {
    softStop();
    try { Tone.Transport.stop(); Tone.Transport.cancel(0); } catch {}
    try {
      // FX y buses solo aquí
      if (fxRef.current.reverb) { fxRef.current.reverb.dispose(); fxRef.current.reverb = null; }
      if (fxRef.current.delay) { fxRef.current.delay.dispose(); fxRef.current.delay = null; }
      if (fxRef.current.comp) { fxRef.current.comp.dispose(); fxRef.current.comp = null; }
      if (fxRef.current.limiter) { fxRef.current.limiter.dispose(); fxRef.current.limiter = null; }
      if (masterRef.current) { masterRef.current.dispose(); masterRef.current = null; }
      if (busesRef.current) {
        Object.values(busesRef.current).forEach(b => { try { b.dispose?.(); } catch {} });
        busesRef.current = { drone:null, colores:null, plucks:null, pad:null, campanas:null, ruido:null, bateria:null };
      }
    } catch {}
    setReproduciendo(false);
    setAudioListo(false);
    if (currentImageUrlRef.current) { URL.revokeObjectURL(currentImageUrlRef.current); currentImageUrlRef.current = null; }
  };

  // ---------- UI ----------

  const actualizarAjuste = (k, v) => {
    setAjustesAudio(p => ({ ...p, [k]: v }));
    if (k === 'reverb' && fxRef.current.reverb) { try { fxRef.current.reverb.set({ roomSize: v, wet: 0.3 }); } catch {} }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <header className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">Sintetizador de Colores</h1>
          <p className="text-slate-300 text-lg">Convierte tus imágenes en paisajes sonoros ambient</p>
        </header>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Columna izquierda: carga y controles */}
          <div className="space-y-6">
            <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-2xl p-6">
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2"><Upload size={20}/> Cargar imagen</h2>
              {!imagen ? (
                <div className="border-2 border-dashed border-slate-600 rounded-xl p-8 text-center cursor-pointer hover:border-purple-400 transition-colors" onClick={() => fileInputRef.current?.click()}>
                  <div className="text-slate-400">
                    <Upload size={48} className="mx-auto mb-4" />
                    <p>Haz clic para seleccionar una imagen</p>
                    <p className="text-sm mt-2">JPG, PNG, GIF hasta 10MB</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <img src={imagen} alt="Subida" className="max-w-full h-48 object-cover mx-auto rounded-lg" />
                  <button onClick={() => { setImagen(null); setDatosColor(null); softStop(); if (fileInputRef.current) fileInputRef.current.value=''; if (currentImageUrlRef.current) { URL.revokeObjectURL(currentImageUrlRef.current); currentImageUrlRef.current=null; } }} className="w-full py-2 px-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors">Subir otra imagen</button>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" onChange={async (e)=>{ await manejarSubidaImagen(e); }} className="hidden" />
              <div className="mt-4">
                <label className="block w-full py-3 px-6 bg-purple-600 hover:bg-purple-700 rounded-xl font-semibold transition-colors cursor-pointer text-center">
                  <Upload size={20} className="inline mr-2" />
                  Elegir archivo
                  <input type="file" accept="image/*" onChange={async (e)=>{ await manejarSubidaImagen(e); }} className="hidden" />
                </label>
              </div>
            </div>

            {datosColor && (
              <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-2xl p-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Volume2 size={18}/> Controles de audio
                </h3>
                <div className="space-y-4">
                  <button onClick={alternarReproduccion} className={`w-full py-3 px-6 rounded-xl font-semibold transition-all duration-300 flex items-center justify-center gap-2 ${reproduciendo ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}`} disabled={analizando}>
                    {reproduciendo ? <Pause size={20}/> : <Play size={20}/>}
                    {analizando ? 'Analizando…' : (reproduciendo ? 'Detener' : 'Reproducir')}
                  </button>
                  <button onClick={probarAudio} className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors text-sm">🔊 Probar audio (haz clic primero)</button>
                  <div className="text-xs space-y-1">
                    <div className={`flex items-center gap-2 ${audioListo ? 'text-green-400' : 'text-yellow-400'}`}>
                      <div className={`w-2 h-2 rounded-full ${audioListo ? 'bg-green-400' : 'bg-yellow-400'}`}></div>
                      Audio: {audioListo ? 'Listo' : 'Inicializando'}
                    </div>
                    <div className="text-slate-400">Tone.js: {typeof Tone !== 'undefined' ? 'Cargado' : 'Cargando…'}</div>
                  </div>
                  {audioError && <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm"><strong>Error de audio:</strong><br/>{audioError}</div>}
                  <div className="grid gap-3">
                    <div>
                      <label className="block text-sm text-slate-300 mb-2">Reverb: {Math.round(ajustesAudio.reverb*100)}%</label>
                      <input type="range" min="0" max="1" step="0.05" value={ajustesAudio.reverb} onChange={(e)=>actualizarAjuste('reverb', parseFloat(e.target.value))} className="w-full accent-purple-400"/>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Mesa de control (mezclador) */}
            {datosColor && (
              <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-2xl p-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <SlidersHorizontal size={18}/> Mesa de control
                </h3>
                <div className="grid sm:grid-cols-2 gap-4">
                  {[
                    { key:'droneDb', label:'Drone' },
                    { key:'coloresDb', label:'Colores' },
                    { key:'plucksDb', label:'Plucks' },
                    { key:'padDb', label:'Pad' },
                    { key:'campanasDb', label:'Campanas' },
                    { key:'ruidoDb', label:'Ruido' },
                    { key:'bateriaDb', label:'Batería' },
                  ].map(({key,label}) => (
                    <div key={key}>
                      <label className="block text-sm text-slate-300 mb-2">{label}: {mixer[key]} dB</label>
                      <input type="range" min="-60" max="0" value={mixer[key]} onChange={(e)=>setMixer(prev=>({ ...prev, [key]: parseInt(e.target.value) }))} className="w-full accent-purple-400"/>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Columna derecha: análisis y explicación */}
          <div className="space-y-6">
            {datosColor && (
              <>
                <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-2xl p-6">
                  <h3 className="text-xl font-semibold mb-4 flex items-center gap-2"><Settings size={20}/> Análisis de imagen</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="space-y-2">
                      <div className="flex justify-between"><span className="text-slate-300">BPM:</span><span className="font-mono text-cyan-400">{datosColor.bpm}</span></div>
                      <div className="flex justify-between"><span className="text-slate-300">Brillo:</span><span className="font-mono text-cyan-400">{Math.round(datosColor.avgBrightness*100)}%</span></div>
                      <div className="flex justify-between"><span className="text-slate-300">Saturación:</span><span className="font-mono text-cyan-400">{Math.round(datosColor.avgSaturation*100)}%</span></div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between"><span className="text-slate-300">Frialdad:</span><span className="font-mono text-purple-400">{Math.round(datosColor.coolness*100)}%</span></div>
                      <div className="flex justify-between"><span className="text-slate-300">Pastel:</span><span className="font-mono text-purple-400">{Math.round(datosColor.pastelnessRatio*100)}%</span></div>
                      <div className="flex justify-between"><span className="text-slate-300">Contraste:</span><span className="font-mono text-purple-400">{Math.round(datosColor.contrast*100)}%</span></div>
                      <div className="flex justify-between"><span className="text-slate-300">Entropía de color:</span><span className="font-mono text-purple-400">{Math.round(datosColor.colorEntropy*100)}%</span></div>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-2xl p-6">
                  <h3 className="text-lg font-semibold mb-4">Colores dominantes</h3>
                  <div className="grid grid-cols-4 gap-2">
                    {datosColor.dominantColors.slice(0,8).map((c, i)=>(
                      <div key={i} className="space-y-2">
                        <div className="h-12 rounded-lg border border-slate-600" style={{ backgroundColor: `hsl(${c.h}, ${c.s*100}%, ${c.l*100}%)` }} />
                        <div className="text-xs text-center text-slate-400">{c.weight} px</div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-2xl p-6">
              <h3 className="text-lg font-semibold mb-4">Propósito y fórmula</h3>
              <div className="text-sm text-slate-300 space-y-2">
                <p><strong>Propósito:</strong> Explorar la traducción de imágenes a sonido ambiental, generando texturas suaves y evolutivas sin ruido molesto.</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>Brillo → BPM</strong> (60–160) y densidad de eventos.</li>
                  <li><strong>Temperatura y saturación → escala musical</strong> (dórica, frígia, lidia, pentatónicas, whole, hirajoshi).</li>
                  <li><strong>Entropía de color → densidad base</strong> (más entropía, más eventos moderados).</li>
                  <li><strong>Contraste → timbre</strong> mediante modulación de filtros.</li>
                  <li><strong>Colores fuertes → ritmos</strong>: rojos, verdes, azules, naranjos, etc. aportan patrones coherentes en bombo/caja/hi-hat.</li>
                </ul>
                <p className="text-slate-400 text-xs mt-3">La app prioriza texturas calmas: las probabilidades son bajas para evitar acumulación y clipping.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer de créditos */}
        <footer className="mt-10 text-center text-slate-400 text-xs opacity-70">
          Web App creada por Claude y corregida por Codex de Chat GPT con ideas de Diego Bastías A.  Agosto 2025
        </footer>

        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  );
};

export default SintetizadorDeColores;
