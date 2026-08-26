export {}

async function main(): Promise<void> {
  const parameters = new URLSearchParams(window.location.search)
  if (parameters.has('plain')) {
    const { startPlainApp } = await import('./plain')
    await startPlainApp()
    return
  }
  const [rendererModule, textModule, frameworkModule, frameworkDomModule, videoModule, appModule] = await Promise.all([
    import('@get-air/renderer'),
    import('@get-air/renderer/canvas'),
    import('@get-air/framework'),
    import('@get-air/framework/dom'),
    import('@get-air/video/framework'),
    import('./App'),
  ])
  const useCanvasRenderer = parameters.get('renderer') === 'canvas'
  const selected = await rendererModule.createRenderer({
    backends: useCanvasRenderer ? ['canvas'] : ['webgpu', 'webgl'],
    ...videoModule.transparentFrameworkRendererOptions,
    appWidth: 1920,
    appHeight: 1080,
    fontEngines: [textModule.CanvasTextRenderer],
  }, 'app')
  const renderer = frameworkModule.createAirRendererBridge(
    selected.renderer,
    selected.backend,
  )
  const host = frameworkModule.createAirRendererHost(selected.renderer)
  const App = appModule.App
  const semanticBridge = frameworkDomModule.createDOMSemanticBridge(
    document,
    document.getElementById('app') ?? document.body,
  )
  await frameworkModule.createApp({
    host,
    root: host.root,
    renderer,
    semanticBridge,
    view: () => App(),
    platform: 'desktop',
  })
}

void main().catch((error: unknown) => {
  const cause = typeof error === 'object' && error !== null && 'cause' in error
    ? String(error.cause)
    : error instanceof Error
      ? error.message
      : String(error)
  document.documentElement.dataset.airBootstrapError = cause
  console.error('Air video example failed to start:', cause, error)
})
