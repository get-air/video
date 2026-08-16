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
  build: { target: 'es2022' },
})
