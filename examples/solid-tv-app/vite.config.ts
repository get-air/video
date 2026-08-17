import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solid({
    solid: {
      moduleName: '@solidtv/solid',
      generate: 'universal',
      builtIns: [],
    },
  })],
  build: { target: 'es2018' },
  server: { host: '0.0.0.0' },
  preview: { host: '0.0.0.0' },
})
