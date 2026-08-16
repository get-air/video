import { WebGlCoreRenderer } from '@solidtv/renderer/webgl'
import { createRenderer } from '@solidtv/solid'
import {
  registerSolidVideoShader,
  transparentSolidRendererOptions,
} from '@get-air/video/solid'

import { App } from './App'

const { renderer, render } = createRenderer({
  ...transparentSolidRendererOptions,
  appWidth: 1920,
  appHeight: 1080,
  renderEngine: WebGlCoreRenderer,
  fontEngines: [],
}, 'app')

await registerSolidVideoShader(renderer)
render(() => <App renderer={renderer} />)
