# Sintetizador de Colores – **PERF v3** (anti pantalla blanca)

### Cambios clave para evitar “pantalla blanca”
- **ErrorBoundary** en React + listeners `error` / `unhandledrejection` con mensaje visible.
- **Pantalla de pre-carga** (preboot) que se oculta cuando React monta; si hay fallo, muestra el error.
- **Fallback CSS** en `index.html` (fondo oscuro) por si Tailwind no carga.
- Mantiene todas las optimizaciones de memoria/CPU y el espectro de color ampliado.

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
