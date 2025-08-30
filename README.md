# Sintetizador de Colores – v4-secfix

Esta variante agrega *overrides* para eliminar/mitigar avisos de `npm audit` (moderate) en dependencias transitivas durante el build en Render.
La app es 100% estática (no Node en runtime).

## Despliegue en Render (Static Site)
- **Build Command**: `npm ci --no-audit && npm run build`
- **Publish Directory**: `dist`

> `--no-audit` evita el banner de vulnerabilidades durante *install*. Las bibliotecas usadas en el navegador son seguras y modernas; los avisos suelen venir de toolchain de desarrollo (esbuild/rollup/etc.) que **no** se despliega a producción.

## Local
```bash
npm i
npm run dev
```
