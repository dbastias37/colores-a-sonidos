import React, { useState, useRef, useEffect } from 'react';
import * as Tone from 'tone';
import { Upload, Play, Pause, Volume2, Settings } from 'lucide-react';

// Util: crear context con ajustes suaves para evitar dropouts
const ensureAudioContext = async () => {
  if (Tone.context.state !== 'running') {
    await Tone.start();
  }
  // Afinar lookAhead para scheduling estable
  try {
    const ctx = Tone.getContext();
    if (typeof ctx.lookAhead !== 'undefined') ctx.lookAhead = 0.1;
  } catch {}
};

const ColorSoundSynthesizer = () => {
  const [image, setImage] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [colorData, setColorData] = useState(null);
  const [audioSettings, setAudioSettings] = useState({
    volume: -18,
    reverb: 0.35,
    filter: 1200
  });
  const [audioReady, setAudioReady] = useState(false);
  const [audioError, setAudioError] = useState(null);
  
  const canvasRef = useRef(null);
  const synthsRef = useRef([]);            // color voices
  const plucksRef = useRef([]);            // pluck voices
  const ambientSynthRef = useRef(null);    // drone
  const sequenceRef = useRef(null);
  const pluckLoopRef = useRef(null);
  const fileInputRef = useRef(null);

  // Global/Shared nodes (reutilizables para no crear FX cada vez)
  const masterRef = useRef(null);
  const fxRef = useRef({ reverb: null, delay: null, comp: null, limiter: null });
  const wasPlayingRef = useRef(false);
  const currentImageUrlRef = useRef(null);
  const analyzeAbortRef = useRef({ aborted: false });

  // Escalas musicales ampliadas
  const scales = {
    cold: ['C3','D3','Eb3','F3','G3','Ab3','Bb3','C4'],           // minor-ish
    warm: ['C3','D3','E3','F#3','G3','A3','B3','C4'],             // major/lydian
    pastel: ['C3','E3','G3','B3','D4','F#4'],                     // airy major6
    bright: ['C3','D#3','F#3','A3','C4','D#4','F#4'],             // augmented flavor
    dorian: ['C3','D3','Eb3','F3','G3','A3','Bb3','C4'],
    phrygian: ['C3','Db3','Eb3','F3','G3','Ab3','Bb3','C4'],
    lydian: ['C3','D3','E3','F#3','G3','A3','B3','C4'],
    whole: ['C3','D3','E3','F#3','G#3','A#3','C4'],
    hirajoshi: ['C3','Db3','F3','G3','Ab3','C4'],
    pentMinor: ['C3','Eb3','F3','G3','Bb3','C4'],
    pentMajor: ['C3','D3','E3','G3','A3','C4']
  };

  useEffect(() => {
    // Inicializar motor de audio una vez
    (async () => {
      try {
        await ensureAudioContext();
        setupGlobalAudio();
        // Resiliencia a visibility/scroll: reanudar si estaba sonando
        const onVis = async () => {
          if (document.visibilityState === 'visible' && wasPlayingRef.current) {
            try {
              await Tone.context.resume();
              Tone.Transport.start();
            } catch {}
          }
        };
        document.addEventListener('visibilitychange', onVis);
        return () => document.removeEventListener('visibilitychange', onVis);
      } catch (e) {
        setAudioError(e?.message || String(e));
      }
    })();

    return () => {
      // Limpieza total al desmontar
      hardStopAndDispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setupGlobalAudio = () => {
    // Crear o reutilizar master + FX una vez
    if (!masterRef.current) {
      const master = new Tone.Gain(1);
      const comp = new Tone.Compressor(-22, 3);
      const limiter = new Tone.Limiter(-1);
      const reverb = new Tone.Reverb({ roomSize: audioSettings.reverb, wet: 0.35 });
      const delay = new Tone.FeedbackDelay({ delayTime: '8n', feedback: 0.22, wet: 0.12 });

      master.chain(comp, limiter, Tone.Destination);
      fxRef.current = { reverb, delay, comp, limiter };
      masterRef.current = master;
    }
    setAudioReady(true);
  };

  // --- Imagen / Análisis ---

  const analyzeImage = (file) => {
    // cancelar análisis anterior
    analyzeAbortRef.current.aborted = true;
    analyzeAbortRef.current = { aborted: false };

    return new Promise((resolve) => {
      setIsAnalyzing(true);
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

        let totalBrightness = 0;
        let totalSaturation = 0;
        let coolColors = 0;
        let warmColors = 0;
        let pastelColors = 0;
        let brightColors = 0;
        let pixelCount = 0;

        const colorGroups = [];

        for (let i = 0; i < pixels.length; i += 16) {
          if (localAbort.aborted) return;
          const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
          if (pixels[i + 3] === 0) continue;
          const { h, s, l } = rgbToHsl(r, g, b);
          totalBrightness += l;
          totalSaturation += s;
          pixelCount++;

          if (h >= 120 && h <= 300) coolColors++; else warmColors++;

          if (s < 0.3 && l > 0.7) pastelColors++;
          else if (s > 0.7 || l < 0.3) brightColors++;

          const colorGroup = { h: Math.round(h / 30) * 30, s, l, weight: 1 };
          const existing = colorGroups.find(gp => gp.h === colorGroup.h);
          if (existing) {
            existing.weight++;
            existing.s = (existing.s + s) / 2;
            existing.l = (existing.l + l) / 2;
          } else {
            colorGroups.push(colorGroup);
          }
        }

        if (localAbort.aborted) return;

        const avgBrightness = pixelCount ? totalBrightness / pixelCount : 0.5;
        const avgSaturation = pixelCount ? totalSaturation / pixelCount : 0.5;
        const coolness = (coolColors + warmColors) ? coolColors / (coolColors + warmColors) : 0.5;
        const pastelnessRatio = pixelCount ? pastelColors / pixelCount : 0;
        const brightnessRatio = pixelCount ? brightColors / pixelCount : 0;

        colorGroups.sort((a, b) => b.weight - a.weight);
        const dominantColors = colorGroups.slice(0, 8);

        const uniqueHues = new Set(dominantColors.map(c => c.h)).size;
        const colorEntropy = dominantColors.length ? uniqueHues / dominantColors.length : 0.5;

        const analysis = {
          avgBrightness,
          avgSaturation,
          coolness,
          pastelnessRatio,
          brightnessRatio,
          dominantColors,
          colorEntropy,
          bpm: Math.round(60 + (avgBrightness * 100)), // 60-160 BPM
          contrast: Math.abs((dominantColors[0]?.l ?? 0.5) - (dominantColors[1]?.l ?? 0.5))
        };

        if (!localAbort.aborted) {
          setColorData(analysis);
          setIsAnalyzing(false);
          resolve(analysis);
        }
      };

      const url = URL.createObjectURL(file);
      // Revocar URL anterior para evitar fugas
      if (currentImageUrlRef.current) URL.revokeObjectURL(currentImageUrlRef.current);
      currentImageUrlRef.current = url;
      img.src = url;
    });
  };

  const rgbToHsl = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) {
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
        default: h = 0;
      }
      h /= 6;
    }
    return { h: h * 360, s, l };
  };

  // --- Audio Graph ---

  const setupAudioForData = async (data) => {
    try {
      setAudioError(null);
      await ensureAudioContext();
      setupGlobalAudio();

      // Limpia voces previas (mantiene FX/master)
      clearVoices();

      // Ambient base (drone) estable
      const ambient = new Tone.Synth({
        oscillator: { type: 'sine' },
        envelope: { attack: 2.5, decay: 1.2, sustain: 0.85, release: 3.5 }
      });
      const lowpass = new Tone.Filter({ frequency: audioSettings.filter, type: 'lowpass' });
      ambient.chain(lowpass, fxRef.current.delay, fxRef.current.reverb, masterRef.current);
      ambient.volume.value = audioSettings.volume;
      ambientSynthRef.current = ambient;
      // Inicia drone
      ambientSynthRef.current.triggerAttack('C2');

      // Crear voces por color (limitadas)
      const maxVoices = 6;
      data.dominantColors.slice(0, maxVoices).forEach((color, index) => {
        const scale = selectScale(data, color);
        const synth = new Tone.Synth({
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.25, decay: 0.6, sustain: 0.45, release: 1.2 }
        });
        const filt = new Tone.Filter({ frequency: 900, type: 'lowpass' });
        const trem = new Tone.Tremolo(0.5 + data.avgSaturation * 1.5, 0.2).start();
        synth.chain(filt, trem, fxRef.current.delay, fxRef.current.reverb, masterRef.current);
        synth.volume.value = audioSettings.volume - 14 - (index * 2);
        synthsRef.current.push({ synth, filter: filt, scale, color });
      });

      // Plucks sincopados (suaves)
      const nPlucks = 2;
      for (let i=0;i<nPlucks;i++) {
        const pl = new Tone.PluckSynth({
          attackNoise: 1.2,
          dampening: 3500,
          resonance: 0.8
        });
        const pan = new Tone.AutoPanner(0.1 + i*0.05).start();
        pl.chain(pan, fxRef.current.delay, fxRef.current.reverb, masterRef.current);
        pl.volume.value = audioSettings.volume - 18 - i*2;
        plucksRef.current.push(pl);
      }

      return true;
    } catch (e) {
      setAudioError(e?.message || String(e));
      return false;
    }
  };

  const selectScale = (data, color) => {
    // Selección más rica según propiedades
    if (data.pastelnessRatio > 0.35) return scales.pastel;
    if (data.brightnessRatio > 0.5) return scales.bright;
    if (data.coolness > 0.65) return scales.dorian;
    if (data.coolness < 0.35) return scales.lydian;
    if (data.avgSaturation < 0.25) return scales.pentMinor;
    if (color.h % 60 === 0) return scales.whole;
    if (color.h % 90 === 0) return scales.hirajoshi;
    return (color.s > 0.6) ? scales.pentMajor : scales.cold;
  };

  // --- Sequences ---

  const startSequences = (data) => {
    if (sequenceRef.current) { try { sequenceRef.current.dispose(); } catch {} }
    if (pluckLoopRef.current) { try { pluckLoopRef.current.dispose(); } catch {} }

    const step = Math.max(0.1, 60 / Math.max(30, data.bpm)); // segundos por paso

    sequenceRef.current = new Tone.Loop((time) => {
      synthsRef.current.forEach((synthObj) => {
        // Probabilidad basada en entropía + saturación + peso de color
        const baseProb = 0.12 + (data.colorEntropy * 0.18); // 0.12–0.30
        const weightFactor = Math.min(1, synthObj.color.weight / 20);
        const satFactor = 0.25 + (synthObj.color.s * 0.75);
        const probability = baseProb * satFactor * weightFactor;

        if (Math.random() < probability) {
          const note = synthObj.scale[(Math.random()*synthObj.scale.length)|0];
          const dur = ['8n','4n','2n'][Math.floor(Math.random()*3)];
          const baseFreq = 250 + (synthObj.color.h * 2);
          const pitchVar = (Math.random() - 0.5) * data.contrast * 40;
          synthObj.filter.frequency.rampTo(Math.max(180, Math.min(3500, baseFreq + pitchVar)), 0.08);
          synthObj.synth.triggerAttackRelease(note, dur, time);
        }
      });
    }, step);
    sequenceRef.current.start(0);

    // Plucks con síncopa ligera (densidad por brillo)
    const pluckInterval = Math.max(0.18, 0.6 - data.avgBrightness * 0.4);
    pluckLoopRef.current = new Tone.Loop((time) => {
      if (plucksRef.current.length === 0) return;
      if (Math.random() < (0.15 + data.colorEntropy * 0.2)) {
        const idx = Math.floor(Math.random() * plucksRef.current.length);
        const pl = plucksRef.current[idx];
        const scale = selectScale(data, { h: 60 * (1+idx), s: data.avgSaturation });
        const note = scale[(Math.random()*scale.length)|0].replace('3','4'); // subir una octava para pluck
        pl.triggerAttack(note, time);
      }
    }, pluckInterval);
    pluckLoopRef.current.start(0);
  };

  // --- Handlers ---

  const handleImageUpload = async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file || !file.type.startsWith('image/')) return;

    setImage(URL.createObjectURL(file)); // solo para preview visual

    // Preparar nuevo dataset: parar secuencias pero mantener master/FX
    softStop(); // corta secuencias y voces activas
    const analysis = await analyzeImage(file);
    if (!analysis) return;

    const ok = await setupAudioForData(analysis);
    if (ok) {
      startSequences(analysis);
      if (isPlaying) {
        Tone.Transport.start();
      }
    }
  };

  const togglePlayback = async () => {
    if (!colorData) return;
    await ensureAudioContext();
    if (isPlaying) {
      wasPlayingRef.current = false;
      softStop();
      Tone.Transport.stop();
      setIsPlaying(false);
    } else {
      setAudioError(null);
      const ok = await setupAudioForData(colorData);
      if (ok) {
        startSequences(colorData);
        Tone.Transport.start();
        setIsPlaying(true);
        wasPlayingRef.current = true;
      }
    }
  };

  const testAudio = async () => {
    try {
      await ensureAudioContext();
      const t = new Tone.Synth().toDestination();
      t.triggerAttackRelease('C4','8n');
      setTimeout(()=>t.dispose(), 500);
    } catch (e) {
      setAudioError('Audio test failed: ' + e.message);
    }
  };

  const softStop = () => {
    // Detiene loops y libera voces, mantiene master/FX para evitar pops
    try {
      if (sequenceRef.current) { sequenceRef.current.dispose(); sequenceRef.current = null; }
      if (pluckLoopRef.current) { pluckLoopRef.current.dispose(); pluckLoopRef.current = null; }
    } catch {}

    synthsRef.current.forEach(obj => {
      try { obj.synth.triggerRelease?.(); } catch {}
      try { obj.synth.dispose?.(); } catch {}
      try { obj.filter.dispose?.(); } catch {}
    });
    synthsRef.current = [];

    plucksRef.current.forEach(pl => {
      try { pl.dispose?.(); } catch {}
    });
    plucksRef.current = [];

    if (ambientSynthRef.current) {
      try { ambientSynthRef.current.triggerRelease?.(); } catch {}
      try { ambientSynthRef.current.dispose?.(); } catch {}
      ambientSynthRef.current = null;
    }
  };

  const clearVoices = () => {
    // Igual que softStop pero sin tocar Transport
    try {
      if (sequenceRef.current) { sequenceRef.current.dispose(); sequenceRef.current = null; }
      if (pluckLoopRef.current) { pluckLoopRef.current.dispose(); pluckLoopRef.current = null; }
    } catch {}

    synthsRef.current.forEach(obj => {
      try { obj.synth.dispose?.(); } catch {}
      try { obj.filter.dispose?.(); } catch {}
    });
    synthsRef.current = [];

    plucksRef.current.forEach(pl => {
      try { pl.dispose?.(); } catch {}
    });
    plucksRef.current = [];

    if (ambientSynthRef.current) {
      try { ambientSynthRef.current.dispose?.(); } catch {}
      ambientSynthRef.current = null;
    }
  };

  const hardStopAndDispose = () => {
    // Parada total: voces, FX, master, Transport, listeners
    softStop();
    try { Tone.Transport.stop(); Tone.Transport.cancel(0); } catch {}
    try {
      if (fxRef.current.reverb) { fxRef.current.reverb.dispose(); fxRef.current.reverb = null; }
      if (fxRef.current.delay) { fxRef.current.delay.dispose(); fxRef.current.delay = null; }
      if (fxRef.current.comp) { fxRef.current.comp.dispose(); fxRef.current.comp = null; }
      if (fxRef.current.limiter) { fxRef.current.limiter.dispose(); fxRef.current.limiter = null; }
      if (masterRef.current) { masterRef.current.dispose(); masterRef.current = null; }
    } catch {}
    setIsPlaying(false);
    setAudioReady(false);
    if (currentImageUrlRef.current) {
      URL.revokeObjectURL(currentImageUrlRef.current);
      currentImageUrlRef.current = null;
    }
  };

  const updateAudioSettings = (key, value) => {
    setAudioSettings(prev => ({ ...prev, [key]: value }));
    if (key === 'volume') {
      if (ambientSynthRef.current) ambientSynthRef.current.volume.value = value;
      synthsRef.current.forEach((s, i) => { s.synth.volume.value = value - 14 - i*2; });
      plucksRef.current.forEach((pl, i) => { pl.volume.value = value - 18 - i*2; });
    }
    if (key === 'reverb' && fxRef.current.reverb) {
      try { fxRef.current.reverb.set({ roomSize: value, wet: 0.35 }); } catch {}
    }
    if (key === 'filter' && ambientSynthRef.current) {
      // se aplica en su filtro creado en setupAudioForData
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <header className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
            Color Sound Synthesizer
          </h1>
          <p className="text-slate-300 text-lg">
            Ambient soundscapes from images • adaptive tempo & scales
          </p>
        </header>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Upload */}
          <div className="space-y-6">
            <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-2xl p-6">
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <Upload size={20} />
                Upload Image
              </h2>

              {!image ? (
                <div 
                  className="border-2 border-dashed border-slate-600 rounded-xl p-8 text-center cursor-pointer hover:border-purple-400 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="text-slate-400">
                    <Upload size={48} className="mx-auto mb-4" />
                    <p>Click to upload an image</p>
                    <p className="text-sm mt-2">JPG, PNG, GIF up to 10MB</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <img src={image} alt="Uploaded" className="max-w-full h-48 object-cover mx-auto rounded-lg" />
                  <button
                    onClick={() => {
                      setImage(null);
                      setColorData(null);
                      softStop();
                      if (fileInputRef.current) fileInputRef.current.value = '';
                      if (currentImageUrlRef.current) { URL.revokeObjectURL(currentImageUrlRef.current); currentImageUrlRef.current = null; }
                    }}
                    className="w-full py-2 px-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
                  >
                    Upload New Image
                  </button>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />

              <div className="mt-4">
                <label className="block w-full py-3 px-6 bg-purple-600 hover:bg-purple-700 rounded-xl font-semibold transition-colors cursor-pointer text-center">
                  <Upload size={20} className="inline mr-2" />
                  Choose Image File
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {/* Controls */}
            {colorData && (
              <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-2xl p-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Volume2 size={18} />
                  Audio Controls
                </h3>
                <div className="space-y-4">
                  <button
                    onClick={togglePlayback}
                    className={`w-full py-3 px-6 rounded-xl font-semibold transition-all duration-300 flex items-center justify-center gap-2 ${isPlaying ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}`}
                    disabled={isAnalyzing}
                  >
                    {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                    {isAnalyzing ? 'Analyzing...' : isPlaying ? 'Stop Soundscape' : 'Play Soundscape'}
                  </button>

                  <button
                    onClick={testAudio}
                    className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors text-sm"
                  >
                    🔊 Test Audio (Click First!)
                  </button>

                  <div className="text-xs space-y-1">
                    <div className={`flex items-center gap-2 ${audioReady ? 'text-green-400' : 'text-yellow-400'}`}>
                      <div className={`w-2 h-2 rounded-full ${audioReady ? 'bg-green-400' : 'bg-yellow-400'}`}></div>
                      Audio: {audioReady ? 'Ready' : 'Initializing'}
                    </div>
                    <div className="text-slate-400">
                      Tone.js: {typeof Tone !== 'undefined' ? 'Loaded' : 'Loading...'}
                    </div>
                  </div>

                  {audioError && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                      <div className="text-red-400 text-sm">
                        <strong>Audio Error:</strong><br />{audioError}
                      </div>
                    </div>
                  )}

                  <div className="grid gap-3">
                    <div>
                      <label className="block text-sm text-slate-300 mb-2">Volume: {audioSettings.volume}dB</label>
                      <input
                        type="range"
                        min="-40"
                        max="0"
                        value={audioSettings.volume}
                        onChange={(e) => updateAudioSettings('volume', parseInt(e.target.value))}
                        className="w-full accent-purple-400"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-slate-300 mb-2">Reverb: {Math.round(audioSettings.reverb * 100)}%</label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={audioSettings.reverb}
                        onChange={(e) => updateAudioSettings('reverb', parseFloat(e.target.value))}
                        className="w-full accent-purple-400"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Analysis */}
          <div className="space-y-6">
            {colorData && (
              <>
                <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-2xl p-6">
                  <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                    <Settings size={20} />
                    Image Analysis
                  </h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="space-y-2">
                      <div className="flex justify-between"><span className="text-slate-300">BPM:</span><span className="font-mono text-cyan-400">{colorData.bpm}</span></div>
                      <div className="flex justify-between"><span className="text-slate-300">Brightness:</span><span className="font-mono text-cyan-400">{Math.round(colorData.avgBrightness * 100)}%</span></div>
                      <div className="flex justify-between"><span className="text-slate-300">Saturation:</span><span className="font-mono text-cyan-400">{Math.round(colorData.avgSaturation * 100)}%</span></div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between"><span className="text-slate-300">Coolness:</span><span className="font-mono text-purple-400">{Math.round(colorData.coolness * 100)}%</span></div>
                      <div className="flex justify-between"><span className="text-slate-300">Pastel:</span><span className="font-mono text-purple-400">{Math.round(colorData.pastelnessRatio * 100)}%</span></div>
                      <div className="flex justify-between"><span className="text-slate-300">Contrast:</span><span className="font-mono text-purple-400">{Math.round(colorData.contrast * 100)}%</span></div>
                      <div className="flex justify-between"><span className="text-slate-300">Color Entropy:</span><span className="font-mono text-purple-400">{Math.round(colorData.colorEntropy * 100)}%</span></div>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-2xl p-6">
                  <h3 className="text-lg font-semibold mb-4">Dominant Colors</h3>
                  <div className="grid grid-cols-4 gap-2">
                    {colorData.dominantColors.slice(0, 8).map((color, index) => (
                      <div key={index} className="space-y-2">
                        <div className="h-12 rounded-lg border border-slate-600" style={{ backgroundColor: `hsl(${color.h}, ${color.s * 100}%, ${color.l * 100}%)` }} />
                        <div className="text-xs text-center text-slate-400">{color.weight} px</div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-2xl p-6">
              <h3 className="text-lg font-semibold mb-4">How it works</h3>
              <div className="text-sm text-slate-300 space-y-2">
                <p>• Temperature & saturation select scales; brightness → BPM and pluck density.</p>
                <p>• Entropy controls event density for ambient character.</p>
                <p>• Global FX reused to avoid CPU spikes and dropouts.</p>
              </div>
            </div>
          </div>
        </div>

        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  );
};

export default ColorSoundSynthesizer;
