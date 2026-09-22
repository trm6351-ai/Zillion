import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { aiReviewPlugin } from './server/vitePlugin.ts'

export default defineConfig({
  plugins: [react(), aiReviewPlugin()],
})
