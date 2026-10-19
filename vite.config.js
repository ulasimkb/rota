import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Pre-bundle both Motion entry points together so LazyMotion's context is
    // shared with the slim `m` components during development
    include: ['motion/react', 'motion/react-m'],
  },
})
