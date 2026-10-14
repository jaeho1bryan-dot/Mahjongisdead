import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    proxy: {
      '/ws': { target: 'ws://localhost:3001', ws: true },
      '/health': 'http://localhost:3001',
    },
  },
})
