// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'

import { attachHtmlVideo } from './html'
import { probeMediabunnyTrackDecodability } from './mediabunny'

vi.mock('./mediabunny', () => ({
  probeMediabunnyTrackDecodability: vi.fn(),
}))

function mediaElement(event: 'canplay' | 'error'): HTMLVideoElement {
  const element = document.createElement('video')
  Object.defineProperties(element, {
    load: {
      configurable: true,
      value: vi.fn(() => queueMicrotask(() => element.dispatchEvent(new Event(event)))),
    },
    pause: { configurable: true, value: vi.fn() },
    videoWidth: { configurable: true, value: 1920 },
    videoHeight: { configurable: true, value: 1080 },
  })
  return element
}

describe('HTML backend startup', () => {
  it('does not accept a backend until media can play', async () => {
    const element = mediaElement('canplay')
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
    expect(element.preload).toBe('auto')
    await controller.destroy()
    expect(removeAbort).toHaveBeenCalledWith('abort', backendAbort)
    expect(element.preload).toBe('none')
  })

  it('rejects startup media errors so the next backend can be attempted', async () => {
    const element = mediaElement('error')

    await expect(attachHtmlVideo(element, { source: 'unsupported.mkv' }, 'html'))
      .rejects.toThrow('HTML media playback failed during startup')
  })

  it('rejects silent partial playback when a present media kind cannot decode', async () => {
    vi.stubGlobal('VideoDecoder', class VideoDecoder {})
    vi.mocked(probeMediabunnyTrackDecodability).mockResolvedValueOnce({
      supported: false,
      hasVideo: true,
      hasAudio: true,
    })
    const fetch = vi.fn()

    await expect(attachHtmlVideo(
      mediaElement('canplay'),
      { source: 'movie.mkv' },
      'html',
      { fetch },
    )).rejects.toMatchObject({
      _tag: 'VideoFeatureUnavailableError',
      feature: 'completeCodecSupport',
    })

    vi.unstubAllGlobals()
  })

  it('rejects false-positive HTML startup when a video never produces dimensions', async () => {
    vi.stubGlobal('VideoDecoder', class VideoDecoder {})

    const element = mediaElement('canplay')
    Object.defineProperty(element, 'videoWidth', { configurable: true, value: 0 })
    await expect(attachHtmlVideo(
      element,
      { source: 'movie.mkv' },
      'html',
      { fetch: vi.fn() },
    )).rejects.toMatchObject({
      _tag: 'VideoFeatureUnavailableError',
      feature: 'videoFrameDecode',
    })

    vi.unstubAllGlobals()
  })

  it('rejects HTML when cross-origin track verification is inconclusive', async () => {
    vi.stubGlobal('VideoDecoder', class VideoDecoder {})
    vi.mocked(probeMediabunnyTrackDecodability).mockResolvedValueOnce(undefined)

    await expect(attachHtmlVideo(
      mediaElement('canplay'),
      { source: 'https://media.example/movie.mkv' },
      'html',
      { fetch: vi.fn() },
    )).rejects.toMatchObject({
      _tag: 'VideoFeatureUnavailableError',
      feature: 'completeCodecSupport',
    })

    vi.unstubAllGlobals()
  })

  it('reports only portable HTML media capabilities', async () => {
    const htmlElement = mediaElement('canplay')
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

    const webos = await attachHtmlVideo(mediaElement('canplay'), { source: 'movie.mp4' }, 'webos')
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

    const vizioElement = mediaElement('canplay')
    const vizio = await attachHtmlVideo(vizioElement, { source: 'movie.mp4' }, 'vizio')
    expect(vizio.capabilities.playbackRate).toBe(true)
    await vizio.setPlaybackRate(1.5)
    expect(vizioElement.playbackRate).toBe(1.5)
    await vizio.destroy()
    expect(vizioElement.playbackRate).toBe(1)
  })
})
