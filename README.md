# Color Sound Synthesizer (fixed)

Mejoras clave:
- **Sin cortes** al hacer scroll/visibility: reanuda el contexto y Transport.
- **Sin fugas de memoria**: limpia/reutiliza efectos globales, cancela análisis anterior y revoca ObjectURLs.
- **Más musicalidad**: plucks sincopados, más escalas, mayor rango dinámico sin perder el carácter ambient.
- **Static site** listo para Render.

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

## Render
- Build Command: `npm install && npm run build`
- Publish Directory: `dist`
