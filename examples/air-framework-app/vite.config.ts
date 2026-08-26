import { defineConfig } from 'vite'
import { air } from '@get-air/framework/vite'

export default defineConfig({
  plugins: [air({ include: /\.[cm]?[jt]sx?$/ })],
  resolve: {
    dedupe: ['@get-air/framework', '@get-air/renderer', 'effect'],
  },
  build: { target: 'es2022' },
  server: { host: '0.0.0.0' },
  preview: { host: '0.0.0.0' },
})
