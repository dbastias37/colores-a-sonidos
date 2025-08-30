# Sintetizador de Colores (visual + drums + mixer, **PERF**)

- Optimizaciones agresivas de CPU/Memoria
  - Limpieza total de nodos/loops/secuencias al cambiar imagen (sin fugas).
  - Reutiliza FX y buses; voz máxima por tick; cap de partículas; overlay adaptativo.
  - Análisis de imagen con `createImageBitmap` (cuando existe) + downsampling adaptativo y bins de 12°.
  - Revoke de object URLs y abort flags para análisis concurrentes.
  - Transporte con `swing` y latencia ajustada; eventos micro-desfasados.
- Cobertura de color más amplia (+4 highlights brillantes asegurados).
- Más dinamismo musical: swing, microtiming, octavas, prob. ligadas a tono/sat/entropía.
- UI Montserrat + visualizador en vivo.

## Local
```bash
npm i
npm run dev
```

## Build
```bash
npm run build
npm run preview
```

## Render (Static)
- Build Command: `npm install && npm run build`
- Publish Directory: `dist`
