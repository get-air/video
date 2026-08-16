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
    const abort = new AbortController()
    const addAbort = vi.spyOn(abort.signal, 'addEventListener')
    const removeAbort = vi.spyOn(abort.signal, 'removeEventListener')
    const controller = await attachHtmlVideo(element, {
      source: 'movie.mp4',
      signal: abort.signal,
    }, 'html')
    const backendAbort = addAbort.mock.calls.filter(([type]) => type === 'abort').at(-1)?.[1]

    expect(controller.capabilities.backend).toBe('html')
    expect(element.preload).toBe('metadata')
    await controller.destroy()
    expect(removeAbort).toHaveBeenCalledWith('abort', backendAbort)
    expect(element.preload).toBe('none')
  })

  it('rejects startup media errors so the next backend can be attempted', async () => {
    const element = mediaElement('error')

    await expect(attachHtmlVideo(element, { source: 'unsupported.mkv' }, 'html'))
      .rejects.toThrow('HTML media playback failed during startup')
  })

  it('reports only portable HTML media capabilities', async () => {
    const htmlElement = mediaElement('loadedmetadata')
    const html = await attachHtmlVideo(htmlElement, { source: 'movie.mp4' }, 'html')
    expect(html.capabilities).toMatchObject({
      drm: false,
      audioTrackSelection: false,
      playbackRate: true,
      videoZoom: true,
    })
    await html.setPlaybackRate(1.25)
    expect(htmlElement.playbackRate).toBe(1.25)
    await html.destroy()
    expect(htmlElement.playbackRate).toBe(1)

    const webos = await attachHtmlVideo(mediaElement('loadedmetadata'), { source: 'movie.mp4' }, 'webos')
    expect(webos.capabilities).toMatchObject({
      drm: false,
      audioTrackSelection: false,
      playbackRate: false,
      videoZoom: false,
    })
    await expect(webos.setPlaybackRate(1.25)).rejects.toMatchObject({
      _tag: 'VideoFeatureUnavailableError',
      feature: 'playbackRate',
    })
    await expect(webos.setVideoZoom(1.25)).rejects.toMatchObject({
      _tag: 'VideoFeatureUnavailableError',
      feature: 'videoZoom',
    })
    await webos.destroy()

    const vizioElement = mediaElement('loadedmetadata')
    const vizio = await attachHtmlVideo(vizioElement, { source: 'movie.mp4' }, 'vizio')
    expect(vizio.capabilities.playbackRate).toBe(true)
    await vizio.setPlaybackRate(1.5)
    expect(vizioElement.playbackRate).toBe(1.5)
    await vizio.destroy()
    expect(vizioElement.playbackRate).toBe(1)
  })
})
