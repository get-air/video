export {}

async function main(): Promise<void> {
  const parameters = new URLSearchParams(window.location.search)
  if (parameters.has('plain')) {
    const { startPlainApp } = await import('./plain')
    await startPlainApp()
    return
  }
  const [rendererModule, shaderModule, canvasRendererModule, canvasShaderModule, solidModule, videoModule, appModule] = await Promise.all([
    import('@solidtv/renderer/webgl'),
    import('@solidtv/renderer/webgl/shaders'),
    import('@solidtv/renderer/canvas'),
    import('@solidtv/renderer/canvas/shaders'),
    import('@solidtv/solid'),
    import('@get-air/video/solid'),
    import('./App'),
  ])
  const useCanvasRenderer = parameters.get('renderer') === 'canvas'
  const activeShaders = useCanvasRenderer ? canvasShaderModule : shaderModule
  const { renderer, render } = solidModule.createRenderer({
    ...videoModule.transparentSolidRendererOptions,
    appWidth: 1920,
    appHeight: 1080,
    renderEngine: useCanvasRenderer
      ? canvasRendererModule.CanvasCoreRenderer
      : rendererModule.WebGlCoreRenderer,
    fontEngines: [canvasRendererModule.CanvasTextRenderer],
  }, 'app')

  renderer.stage.shManager.registerShaderType('rounded', activeShaders.Rounded)
  renderer.stage.shManager.registerShaderType('roundedWithBorder', activeShaders.RoundedWithBorder)
  await videoModule.registerSolidVideoShader(renderer)
  const App = appModule.App
  render(() => App({ renderer }))
}

void main()
