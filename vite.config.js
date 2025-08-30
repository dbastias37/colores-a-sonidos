import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // base: '/', // Para Render Static no es necesario cambiarlo
  build: {
    outDir: 'dist',
    sourcemap: false
  }
})
