// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'

import { attachHtmlVideo } from './html'

function mediaElement(event: 'loadedmetadata' | 'error'): HTMLVideoElement {
  const element = document.createElement('video')
  Object.defineProperties(element, {
    load: {
      configurable: true,
      value: vi.fn(() => queueMicrotask(() => element.dispatchEvent(new Event(event)))),
    },
    pause: { configurable: true, value: vi.fn() },
  })
  return element
}

describe('HTML backend startup', () => {
  it('does not accept a backend until media metadata loads', async () => {
    const element = mediaElement('loadedmetadata')
    element.preload = 'none'
    const controller = await attachHtmlVideo(element, { source: 'movie.mp4' }, 'html')

    expect(controller.capabilities.backend).toBe('html')
    expect(element.preload).toBe('metadata')
    await controller.destroy()
    expect(element.preload).toBe('none')
  })

  it('rejects startup media errors so the next backend can be attempted', async () => {
    const element = mediaElement('error')

    await expect(attachHtmlVideo(element, { source: 'unsupported.mkv' }, 'html'))
      .rejects.toThrow('HTML media playback failed during startup')
  })

  it('reports only portable HTML media capabilities', async () => {
    const html = await attachHtmlVideo(mediaElement('loadedmetadata'), { source: 'movie.mp4' }, 'html')
    expect(html.capabilities).toMatchObject({
      drm: false,
      audioTrackSelection: false,
      playbackRate: true,
      videoZoom: true,
    })
    await html.destroy()

    const webos = await attachHtmlVideo(mediaElement('loadedmetadata'), { source: 'movie.mp4' }, 'webos')
    expect(webos.capabilities).toMatchObject({
      drm: false,
      audioTrackSelection: false,
      playbackRate: false,
      videoZoom: false,
    })
    await webos.destroy()
  })
})
