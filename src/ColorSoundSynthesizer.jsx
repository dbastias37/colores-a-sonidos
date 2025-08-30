import React, { useState, useRef, useEffect } from 'react';
import * as Tone from 'tone';
import { Upload, Play, Pause, Volume2, Settings } from 'lucide-react';

const ColorSoundSynthesizer = () => {
  const [image, setImage] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [colorData, setColorData] = useState(null);
  const [audioSettings, setAudioSettings] = useState({
    volume: -20,
    reverb: 0.3,
    filter: 1000
  });
  const [audioReady, setAudioReady] = useState(false);
  const [audioError, setAudioError] = useState(null);

  const canvasRef = useRef(null);
  const synthsRef = useRef([]);
  const ambientSynthRef = useRef(null);
  const sequenceRef = useRef(null);
  const fileInputRef = useRef(null);

  // Escalas musicales para diferentes tipos de colores
  const scales = {
    cold: ['C3', 'D3', 'Eb3', 'F3', 'G3', 'Ab3', 'Bb3', 'C4'],
    warm: ['C3', 'D3', 'E3', 'F#3', 'G3', 'A3', 'B3', 'C4'],
    pastel: ['C3', 'E3', 'G3', 'B3', 'D4', 'F#4'],
    bright: ['C3', 'D#3', 'F#3', 'A3', 'C4', 'D#4', 'F#4']
  };

  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, []);

  const analyzeImage = (file) => {
    return new Promise((resolve) => {
      setIsAnalyzing(true);
      const img = new Image();
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      img.onload = () => {
        // Resize for performance
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

        // Sample every 4th pixel for performance (skip alpha channel too)
        for (let i = 0; i < pixels.length; i += 16) {
          const r = pixels[i];
          const g = pixels[i + 1];
          const b = pixels[i + 2];

          if (pixels[i + 3] === 0) continue; // Skip transparent pixels

          // Convert to HSL
          const { h, s, l } = rgbToHsl(r, g, b);

          totalBrightness += l;
          totalSaturation += s;
          pixelCount++;

          // Classify color temperature (roughly)
          if ((h >= 120 && h <= 300)) {
            coolColors++;
          } else {
            warmColors++;
          }

          // Classify saturation and lightness
          if (s < 0.3 && l > 0.7) {
            pastelColors++;
          } else if (s > 0.7 || l < 0.3) {
            brightColors++;
          }

          // Group similar colors
          const colorGroup = {
            h: Math.round(h / 30) * 30, // Group hues in 30-degree chunks
            s,
            l,
            weight: 1
          };

          const existing = colorGroups.find(g => g.h === colorGroup.h);
          if (existing) {
            existing.weight++;
            existing.s = (existing.s + s) / 2;
            existing.l = (existing.l + l) / 2;
          } else {
            colorGroups.push(colorGroup);
          }
        }

        const avgBrightness = pixelCount ? totalBrightness / pixelCount : 0.5;
        const avgSaturation = pixelCount ? totalSaturation / pixelCount : 0.5;
        const coolness = (coolColors + warmColors) ? coolColors / (coolColors + warmColors) : 0.5;
        const pastelnessRatio = pixelCount ? pastelColors / pixelCount : 0;
        const brightnessRatio = pixelCount ? brightColors / pixelCount : 0;

        // Sort color groups by weight and take top ones
        colorGroups.sort((a, b) => b.weight - a.weight);
        const dominantColors = colorGroups.slice(0, 8);

        // Entropía de color: variedad de tonos dominantes (0..1)
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

        setColorData(analysis);
        setIsAnalyzing(false);
        resolve(analysis);
      };

      img.src = URL.createObjectURL(file);
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
      }
      h /= 6;
    }
    return { h: h * 360, s, l };
  };

  const setupAudio = async (data) => {
    try {
      setAudioError(null);

      // Start Tone.js audio context
      if (Tone.context.state !== 'running') {
        await Tone.start();
      }

      // Clean up existing synths
      synthsRef.current.forEach(synth => {
        try { synth.synth?.dispose(); } catch {}
      });
      synthsRef.current = [];

      if (ambientSynthRef.current) {
        try { ambientSynthRef.current.dispose(); } catch {}
        ambientSynthRef.current = null;
      }

      // Effects comunes
      const globalReverb = new Tone.Reverb({ roomSize: audioSettings.reverb, wet: 0.4 });
      const globalDelay = new Tone.FeedbackDelay({ delayTime: '8n', feedback: 0.25, wet: 0.15 });

      // Ambient base synth (drone)
      const ambient = new Tone.Synth({
        oscillator: { type: 'sine' },
        envelope: { attack: 2, decay: 1, sustain: 0.8, release: 3 }
      });
      const ambientFilter = new Tone.Filter({ frequency: audioSettings.filter, type: 'lowpass' });
      ambient.chain(ambientFilter, globalDelay, globalReverb, Tone.Destination);
      ambient.volume.value = audioSettings.volume;
      ambientSynthRef.current = ambient;

      // Create color-based synths (máx 6 por rendimiento)
      data.dominantColors.forEach((color, index) => {
        if (index >= 6) return;

        let scale;
        if (data.pastelnessRatio > 0.3) scale = scales.pastel;
        else if (data.brightnessRatio > 0.4) scale = scales.bright;
        else if (data.coolness > 0.6) scale = scales.cold;
        else scale = scales.warm;

        const synth = new Tone.Synth({
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.3, decay: 0.5, sustain: 0.4, release: 1 }
        });

        // Cadena individual para poder modular filtro por color
        const filt = new Tone.Filter({ frequency: 800, type: 'lowpass' });
        const del = new Tone.FeedbackDelay({ delayTime: '8n', feedback: 0.2, wet: 0.1 });
        const rev = new Tone.Reverb({ roomSize: Math.max(0.2, audioSettings.reverb - 0.1), wet: 0.2 });

        synth.chain(filt, del, rev, Tone.Destination);
        synth.volume.value = audioSettings.volume - 15 - (index * 2);

        synthsRef.current.push({ synth, filter: filt, scale, color });
      });

      setAudioReady(true);

      // Start ambient drone immediately
      ambientSynthRef.current.triggerAttack('C2');

      return true;

    } catch (error) {
      setAudioError(error?.message || String(error));
      setAudioReady(false);
      return false;
    }
  };

  const startSequence = (data) => {
    if (sequenceRef.current) {
      try { sequenceRef.current.dispose(); } catch {}
    }

    const stepSeconds = Math.max(0.1, 60 / Math.max(30, data.bpm)); // seguridad

    sequenceRef.current = new Tone.Loop((time) => {
      synthsRef.current.forEach((synthObj, index) => {
        // Probabilidad base controlada por entropía de color (0.15–0.30)
        const baseProb = 0.15 + (data.colorEntropy * 0.15);
        const weightFactor = Math.min(1, synthObj.color.weight / 20);
        const satFactor = 0.3 + (synthObj.color.s * 0.7);
        const probability = baseProb * satFactor * weightFactor;

        if (Math.random() < probability) {
          const noteIndex = Math.floor(Math.random() * synthObj.scale.length);
          const note = synthObj.scale[noteIndex];
          const duration = ['8n', '4n', '2n'][Math.floor(Math.random() * 3)];

          // Modulación de filtro según tono (h) + contraste → timbre
          const pitchVariation = (Math.random() - 0.5) * data.contrast * 50;
          const baseFreq = 300 + (synthObj.color.h * 2); // limitar para ambiente
          if (synthObj.filter) {
            synthObj.filter.frequency.rampTo(Math.max(200, Math.min(4000, baseFreq + pitchVariation)), 0.1);
          }
          synthObj.synth.triggerAttackRelease(note, duration, time);
        }
      });
    }, stepSeconds);

    sequenceRef.current.start(0);
  };

  const handleImageUpload = async (event) => {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
      const imageUrl = URL.createObjectURL(file);
      setImage(imageUrl);

      const analysis = await analyzeImage(file);
      console.log('Image analysis:', analysis);
    }
  };

  const togglePlayback = async () => {
    if (!colorData) return;

    if (isPlaying) {
      stopAudio();
    } else {
      setAudioError(null);

      const success = await setupAudio(colorData);
      if (success) {
        startSequence(colorData);
        Tone.Transport.start();
        setIsPlaying(true);
      }
    }
  };

  const testAudio = async () => {
    try {
      setAudioError(null);
      await Tone.start();
      const testSynth = new Tone.Synth().toDestination();
      testSynth.triggerAttackRelease('C4', '8n');
      setTimeout(() => testSynth.dispose(), 1000);
    } catch (error) {
      setAudioError('Audio test failed: ' + error.message);
    }
  };

  const stopAudio = () => {
    try {
      if (sequenceRef.current) {
        try { sequenceRef.current.dispose(); } catch {}
        sequenceRef.current = null;
      }

      synthsRef.current.forEach(synthObj => {
        try {
          synthObj.synth?.triggerRelease?.();
          synthObj.synth?.dispose?.();
          synthObj.filter?.dispose?.();
        } catch {}
      });
      synthsRef.current = [];

      if (ambientSynthRef.current) {
        try {
          ambientSynthRef.current.triggerRelease?.();
          ambientSynthRef.current.dispose?.();
        } catch {}
        ambientSynthRef.current = null;
      }

      Tone.Transport.stop();
      setIsPlaying(false);
      setAudioReady(false);

    } catch (error) {
      setAudioError('Error stopping audio: ' + error.message);
    }
  };

  const updateAudioSettings = (key, value) => {
    setAudioSettings(prev => ({ ...prev, [key]: value }));

    if (ambientSynthRef.current && key === 'volume') {
      ambientSynthRef.current.volume.value = value - 5;
      synthsRef.current.forEach((synthObj, index) => {
        synthObj.synth.volume.value = value - 10 - (index * 3);
      });
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
            Transform images into ambient soundscapes • Each color becomes a musical voice
          </p>
        </header>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Image Upload Section */}
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
                      stopAudio();
                      if (fileInputRef.current) fileInputRef.current.value = '';
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

              {/* Alternative visible upload button */}
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

                  {/* Audio Test Button */}
                  <button
                    onClick={testAudio}
                    className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors text-sm"
                  >
                    🔊 Test Audio (Click First!)
                  </button>

                  {/* Audio Status */}
                  <div className="text-xs space-y-1">
                    <div className={`flex items-center gap-2 ${audioReady ? 'text-green-400' : 'text-yellow-400'}`}>
                      <div className={`w-2 h-2 rounded-full ${audioReady ? 'bg-green-400' : 'bg-yellow-400'}`}></div>
                      Audio: {audioReady ? 'Ready' : 'Initializing'}
                    </div>
                    <div className="text-slate-400">
                      Tone.js: {typeof Tone !== 'undefined' ? 'Loaded' : 'Loading...'}
                    </div>
                  </div>

                  {/* Audio Error Display */}
                  {audioError && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                      <div className="text-red-400 text-sm">
                        <strong>Audio Error:</strong><br />
                        {audioError}
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
                        step="0.1"
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

          {/* Analysis Results */}
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
                      <div className="flex justify-between">
                        <span className="text-slate-300">BPM:</span>
                        <span className="font-mono text-cyan-400">{colorData.bpm}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-300">Brightness:</span>
                        <span className="font-mono text-cyan-400">{Math.round(colorData.avgBrightness * 100)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-300">Saturation:</span>
                        <span className="font-mono text-cyan-400">{Math.round(colorData.avgSaturation * 100)}%</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-slate-300">Coolness:</span>
                        <span className="font-mono text-purple-400">{Math.round(colorData.coolness * 100)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-300">Pastel:</span>
                        <span className="font-mono text-purple-400">{Math.round(colorData.pastelnessRatio * 100)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-300">Contrast:</span>
                        <span className="font-mono text-purple-400">{Math.round(colorData.contrast * 100)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-300">Color Entropy:</span>
                        <span className="font-mono text-purple-400">{Math.round(colorData.colorEntropy * 100)}%</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-2xl p-6">
                  <h3 className="text-lg font-semibold mb-4">Dominant Colors</h3>
                  <div className="grid grid-cols-4 gap-2">
                    {colorData.dominantColors.slice(0, 8).map((color, index) => (
                      <div key={index} className="space-y-2">
                        <div 
                          className="h-12 rounded-lg border border-slate-600"
                          style={{ backgroundColor: `hsl(${color.h}, ${color.s * 100}%, ${color.l * 100}%)` }}
                        />
                        <div className="text-xs text-center text-slate-400">
                          {color.weight} px
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-2xl p-6">
              <h3 className="text-lg font-semibold mb-4">How it works</h3>
              <div className="text-sm text-slate-300 space-y-2">
                <p>• <span className="text-cyan-400">Cool colors</span> → Minor scales, slower attack</p>
                <p>• <span className="text-orange-400">Warm colors</span> → Major scales, brighter tones</p>
                <p>• <span className="text-pink-300">Pastel colors</span> → Soft envelopes, low-pass filtering</p>
                <p>• <span className="text-yellow-400">Bright colors</span> → Sharp attacks, high-pass filtering</p>
                <p>• <span className="text-purple-400">Image brightness</span> → Controls BPM (60-160)</p>
                <p>• <span className="text-green-400">Saturation</span> → Affects note probability and effects</p>
                <p>• <span className="text-blue-300">Color entropy</span> → Controls event density to keep it ambient</p>
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
