export {}

const parameters = new URLSearchParams(window.location.search)

if (parameters.has('qualification')) {
  const { startQualificationApp } = await import('./qualification')
  await startQualificationApp()
} else {
  const [rendererModule, solidModule, videoModule, appModule] = await Promise.all([
    import('@solidtv/renderer/webgl'),
    import('@solidtv/solid'),
    import('@get-air/video/solid'),
    import('./App'),
  ])
  const { renderer, render } = solidModule.createRenderer({
    ...videoModule.transparentSolidRendererOptions,
    appWidth: 1920,
    appHeight: 1080,
    renderEngine: rendererModule.WebGlCoreRenderer,
    fontEngines: [],
  }, 'app')

  await videoModule.registerSolidVideoShader(renderer)
  const App = appModule.App
  render(() => App({ renderer }))
}
