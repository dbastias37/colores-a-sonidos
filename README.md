# Colores a sonidos

Estudio web de sonificación de imágenes de Diego Bastías A. Sube una foto, pulsa **Reproducir** y escucha una composición ambiental basada en sus colores. React + Vite; sitio estático, sin servidor ni subida de imágenes a servicios externos.

## Uso

- El lago al atardecer es una imagen de ejemplo generada para esta demo. También puedes subir o arrastrar tu propia imagen (hasta 30 MB).
- La escala y el tempo se calculan automáticamente. Puedes elegir otra escala o cambiar el tempo; al soltar el control se prepara una nueva composición.
- **Melodía**, **Armonía**, **Ambiente** y volumen general se mezclan durante la reproducción. Pausa conserva la posición; reinicio vuelve al comienzo. La barra de progreso permite recorrer el ciclo.
- Las imágenes se procesan localmente. Los formatos disponibles dependen del decodificador del navegador; JPG, PNG y WebP son las opciones recomendadas. No se almacena la foto al recargar.

## Qué se mejoró

El motor anterior creaba y programaba numerosos sintetizadores y efectos en tiempo real, junto con un fondo de partículas. La ruta de análisis utilizaba un conteo de tonos como aproximación de entropía, devolvía un nombre distinto al que leía la interfaz y elegía modos aleatorios durante los renders de React.

Ahora:

- Un worker calcula un histograma HSL fijo, ponderado por alfa. Se aplica Shannon: `H = -sum(p * log2(p))`; el porcentaje es `H / log2(296)`. Los 296 grupos incluyen 288 grupos cromáticos y 8 de luminosidad neutra. El mismo denominador permite comparar imágenes; no es un porcentaje de calidad ni de colores existentes.
- La temperatura se pondera por presencia y saturación. Grises, blancos, negros y transparencia no se interpretan como rojo. La previsualización conserva proporciones, usa un máximo de 1440 píxeles en su lado mayor y el análisis un máximo de 256. El bitmap decodificado se libera. La decodificación inicial de una foto excepcionalmente grande todavía depende de la memoria del navegador.
- Una semilla de la imagen hace reproducibles las notas. El recorrido de 32 franjas modifica la melodía de izquierda a derecha. La escala es estable, los acordes comparten sus notas y la entropía controla la densidad.
- `OfflineAudioContext` prepara tres pistas mono de 24 kHz, de 32 pulsos, con envolventes y ecos. Las colas se pliegan al inicio para completar el bucle. El límite por pista reserva margen incluso con todos los controles al máximo.
- Durante Play solo se repiten tres `AudioBufferSourceNode`, con ganancias suaves y compresión global. El audio no necesita temporizadores JavaScript ni actualizaciones de React para disparar notas. Las pistas ocupan como máximo unos 11 MiB en los ajustes actuales; el render temporal requiere memoria adicional.
- El indicador visual se actualiza a 10 Hz solo al reproducir y con la pestaña visible. Se eliminaron del camino activo las partículas, el desenfoque de pantalla completa y Tone.js; se conserva la dependencia declarada por compatibilidad histórica, sin incluirla en el bundle activo.
- Cambiar de imagen cancela su worker y descarta preparaciones antiguas. Los renders de audio se serializan, las URL se revocan y se liberan fuentes/contexto al salir.
- Interfaz adaptable con reproductor accesible en la parte inferior del móvil, ajustes de mezcla, explicación breve, diálogo con Escape y foco nativo, controles etiquetados y respeto a movimiento reducido.

No se puede garantizar audio con la pantalla bloqueada o en segundo plano: iOS/Android pueden suspender el navegador. Al volver se intenta reactivar el contexto; si se necesita un gesto, aparece **Reanudar**. Esta optimización elimina la programación de notas dependiente de la interfaz, pero no sustituye una prueba en un teléfono físico.

La asociación entre colores, modos y emociones es artística, no una equivalencia científica.

## Desarrollo y validación

```bash
npm ci --no-audit
npm run dev
node --test tests/*.test.js
npm run build
```

Las pruebas cubren entropía conocida, ponderación, neutralidad y transparencia, composición reproducible y dentro de la escala, límites del bucle y ciclo de vida de reproducción con un doble de la API de audio. No son una prueba acústica ni una ejecución en Safari/Android. No hay dependencias de prueba adicionales.

## Despliegue en Render (Static Site)

- Build Command: `npm ci --no-audit && npm run build`
- Publish Directory: `dist`

El mismo código funciona como sitio estático en Sites. Su identidad se conserva en `.openai/hosting.json`.

## Archivos principales

- `src/synth/ColorSynth.jsx`: interfaz y gestión de cargas.
- `src/synth/analysis.js`: análisis cromático compartido por worker y fallback.
- `src/synth/image.js`, `src/workers/analyze.worker.js`: imágenes, cancelación y miniaturas.
- `src/audio/composition.js`: composición musical determinista.
- `src/audio/engine.js`: render previo, mezcla y reproducción.

Referencias del motor: [OfflineAudioContext](https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext) y [AudioBufferSourceNode](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode).

Proyecto original creado con Claude y corregido con Codex, a partir de ideas de Diego Bastías A. (agosto de 2025). La revisión de septiembre de 2026 conserva el propósito y reemplaza el motor activo y la interfaz.
