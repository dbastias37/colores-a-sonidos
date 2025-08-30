# Color Sound Synthesizer (React + Vite + Tone.js)

App web estática que convierte una imagen en un paisaje sonoro tipo ambient (inspiración Aphex Twin).  
- Cada grupo de colores de la imagen se mapea a un conjunto de notas.
- BPM depende del brillo promedio.
- Escalas cambian según temperatura (fríos/cálidos), pastel/brillante.
- Entropía de color controla la densidad de eventos para mantener un ambiente "calmo".
- Botón de **Test Audio** para desbloquear audio en navegadores.

## Desarrollo local
```bash
npm i
npm run dev
# abre la URL que muestra Vite (p.ej. http://localhost:5173)
```

## Build
```bash
npm run build
npm run preview
```

## Deploy en Render (Static Site)
1. Sube este repo a GitHub.
2. En Render: **New +** → **Static Site** → conecta tu repo.
3. Configura:
   - **Build Command**: `npm install && npm run build`
   - **Publish Directory**: `dist`
   - (Opcional) **Node version**: 18 o 20
4. Deploy.

## Notas
- Esta app es 100% estática, no requiere backend.
- En móviles y desktop, algunos navegadores exigen interacción del usuario: usa **Test Audio** o **Play** antes de escuchar.
