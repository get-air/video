// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'

import { attachTizenVideo } from './tizen'

type AvPlayState = 'NONE' | 'IDLE' | 'READY' | 'PLAYING' | 'PAUSED'

function mockAvPlay(options: { prepareFails?: boolean; live?: boolean; liveWindow?: string } = {}) {
  let state: AvPlayState = 'NONE'
  let listener: {
    oncurrentplaytime?: (milliseconds: number) => void
    onstreamcompleted?: () => void
  } = {}
  const currentTracks = [
    { type: 'VIDEO', index: 0, extra_info: '{"fourCC":"H264","Width":3840,"Height":2160}' },
    { type: 'AUDIO', index: 1, extra_info: '{"fourCC":"AACL","language":"en"}' },
  ]
  const totalTracks = [
    ...currentTracks,
    { type: 'AUDIO', index: 2, extra_info: '{"fourCC":"AACL","language":"es"}' },
    { type: 'TEXT', index: 3, extra_info: '{"fourCC":"TTML","track_lang":"en"}' },
  ]
  const api = {
    open: vi.fn(() => { state = 'IDLE' }),
    close: vi.fn(() => { state = 'NONE' }),
    prepareAsync: vi.fn((success: () => void, failure: (error: unknown) => void) => {
      if (options.prepareFails) {
        failure(new Error('prepare failed'))
        return
      }
      state = 'READY'
      success()
    }),
    play: vi.fn(() => { state = 'PLAYING' }),
    pause: vi.fn(() => { state = 'PAUSED' }),
    stop: vi.fn(() => { state = 'IDLE' }),
    seekTo: vi.fn((_milliseconds: number, success?: () => void) => success?.()),
    getState: vi.fn(() => state),
    getDuration: vi.fn(() => 120_000),
    getCurrentTime: vi.fn(() => 0),
    getTotalTrackInfo: vi.fn(() => {
      if (state === 'READY') throw new Error('getTotalTrackInfo is invalid after prepareAsync')
      return totalTracks
    }),
    getCurrentStreamInfo: vi.fn(() => currentTracks),
    getStreamingProperty: vi.fn((type: 'IS_LIVE' | 'GET_LIVE_DURATION') =>
      type === 'IS_LIVE' ? options.live ? 'true' : 'false' : options.liveWindow ?? ''),
    setStreamingProperty: vi.fn(),
    setSilentSubtitle: vi.fn(),
    setSelectTrack: vi.fn(),
    setDisplayRect: vi.fn(),
    setDisplayMethod: vi.fn(),
    setListener: vi.fn((next: typeof listener) => { listener = next }),
  }
  return {
    api,
    emitCurrentTime: (milliseconds: number) => listener.oncurrentplaytime?.(milliseconds),
    emitCompleted: () => listener.onstreamcompleted?.(),
  }
}

function videoAnchor(): HTMLVideoElement {
  const element = document.createElement('video')
  element.style.visibility = 'visible'
  document.body.append(element)
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: 64,
    y: 36,
    left: 64,
    top: 36,
    right: 704,
    bottom: 396,
    width: 640,
    height: 360,
    toJSON: () => ({}),
  })
  return element
}

afterEach(() => {
  document.body.replaceChildren()
  delete window.webapis
  vi.restoreAllMocks()
})

describe('Samsung Tizen AVPlay backend', () => {
  it('uses a managed AVPlay object, 1920x1080 geometry, and valid track states', async () => {
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1280)
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(720)
    const avplay = mockAvPlay()
    Object.defineProperty(window, 'webapis', {
      configurable: true,
      value: { avplay: avplay.api },
    })
    const element = videoAnchor()
    const abort = new AbortController()
    const addAbort = vi.spyOn(abort.signal, 'addEventListener')
    const removeAbort = vi.spyOn(abort.signal, 'removeEventListener')

    const controller = await attachTizenVideo(element, {
      source: {
        uri: 'https://media.example/movie.mkv',
        cookies: 'session=private',
        userAgent: 'Air/1.0',
      },
      signal: abort.signal,
    })
    const backendAbort = addAbort.mock.calls.find(([type]) => type === 'abort')?.[1]

    const playerObject = document.querySelector<HTMLObjectElement>(
      'object[data-air-video-plane="tizen-avplay"]',
    )
    expect(playerObject?.type).toBe('application/avplayer')
    expect(playerObject?.style.left).toBe('64px')
    expect(playerObject?.style.width).toBe('640px')
    expect(element.style.visibility).toBe('hidden')
    expect(controller.capabilities).toMatchObject({ drm: false, customHeaders: false })
    expect(avplay.api.setStreamingProperty.mock.calls).toEqual([
      ['COOKIE', 'session=private'],
      ['USER_AGENT', 'Air/1.0'],
    ])
    expect(avplay.api.open.mock.invocationCallOrder[0])
      .toBeLessThan(avplay.api.setStreamingProperty.mock.invocationCallOrder[0])
    expect(avplay.api.setStreamingProperty.mock.invocationCallOrder[1])
      .toBeLessThan(avplay.api.prepareAsync.mock.invocationCallOrder[0])
    expect(avplay.api.setDisplayRect).toHaveBeenLastCalledWith(96, 54, 960, 540)
    expect(avplay.api.getTotalTrackInfo).not.toHaveBeenCalled()
    expect(controller.tracks.map((track) => track.id)).toEqual(['video-0', 'audio-1'])

    await expect(controller.selectTrack('video', 'video-0')).rejects.toMatchObject({
      _tag: 'VideoFeatureUnavailableError',
      feature: 'videoTrackSelection',
    })
    await expect(controller.selectTrack('audio', 'audio-1')).rejects.toMatchObject({
      _tag: 'VideoFeatureUnavailableError',
      feature: 'audioTrackSelectionState',
    })
    await expect(controller.setPlaybackRate(1.25)).rejects.toMatchObject({
      _tag: 'VideoFeatureUnavailableError',
      feature: 'playbackRate',
    })

    await controller.play()
    expect(avplay.api.getTotalTrackInfo).toHaveBeenCalledOnce()
    expect(controller.tracks.map((track) => track.id)).toEqual([
      'video-0', 'audio-1', 'audio-2', 'subtitle-3',
    ])
    expect(controller.tracks.find((track) => track.id === 'audio-2')?.language).toBe('es')

    await controller.selectTrack('subtitle', 'subtitle-3')
    expect(avplay.api.setSilentSubtitle).toHaveBeenLastCalledWith(false)
    expect(avplay.api.setSelectTrack).toHaveBeenLastCalledWith('TEXT', 3)
    await controller.selectTrack('subtitle')
    expect(avplay.api.setSilentSubtitle).toHaveBeenLastCalledWith(true)
    expect(controller.tracks.find((track) => track.id === 'subtitle-3')?.selected).toBe(false)

    avplay.emitCurrentTime(1_500)
    expect(controller.playbackQuality().mediaTimeSeconds).toBe(1.5)
    await controller.destroy()
    expect(avplay.api.stop).toHaveBeenCalledOnce()
    expect(avplay.api.close).toHaveBeenCalledOnce()
    expect(document.querySelector('[data-air-video-plane="tizen-avplay"]')).toBeNull()
    expect(element.style.visibility).toBe('visible')
    expect(removeAbort).toHaveBeenCalledWith('abort', backendAbort)
  })

  it('does not let a failed second attachment stop the active AVPlay owner', async () => {
    const avplay = mockAvPlay()
    Object.defineProperty(window, 'webapis', {
      configurable: true,
      value: { avplay: avplay.api },
    })
    const active = await attachTizenVideo(videoAnchor(), {
      source: 'https://media.example/active.mkv',
    })

    await expect(attachTizenVideo(videoAnchor(), {
      source: 'https://media.example/second.mkv',
    })).rejects.toMatchObject({
      _tag: 'VideoBackendUnavailableError',
      backend: 'tizen',
    })
    await expect(attachTizenVideo(videoAnchor(), {
      source: {
        uri: 'https://media.example/headers.mkv',
        headers: { Authorization: 'Bearer private' },
      },
    })).rejects.toMatchObject({
      _tag: 'VideoFeatureUnavailableError',
      feature: 'customHeaders',
    })

    expect(avplay.api.stop).not.toHaveBeenCalled()
    expect(avplay.api.close).not.toHaveBeenCalled()
    await active.destroy()
    expect(avplay.api.stop).toHaveBeenCalledOnce()
    expect(avplay.api.close).toHaveBeenCalledOnce()
  })

  it('publishes and clamps Samsung live DVR windows without reporting an end', async () => {
    const avplay = mockAvPlay({ live: true, liveWindow: '1180000|1245000' })
    avplay.api.getDuration.mockReturnValue(0)
    Object.defineProperty(window, 'webapis', {
      configurable: true,
      value: { avplay: avplay.api },
    })
    const element = videoAnchor()
    const ended = vi.fn()
    element.addEventListener('ended', ended)
    const controller = await attachTizenVideo(element, {
      source: 'https://media.example/live.m3u8',
    })

    expect(controller.media).toMatchObject({
      durationSeconds: undefined,
      live: true,
      seekable: true,
      seekableStartSeconds: 1180,
      seekableEndSeconds: 1245,
    })
    await controller.seek(2000)
    expect(avplay.api.seekTo).toHaveBeenLastCalledWith(1_245_000, expect.any(Function), expect.any(Function))
    avplay.emitCompleted()
    expect(ended).not.toHaveBeenCalled()
    await controller.destroy()
  })

  it('removes the companion object when asynchronous preparation fails', async () => {
    const avplay = mockAvPlay({ prepareFails: true })
    Object.defineProperty(window, 'webapis', {
      configurable: true,
      value: { avplay: avplay.api },
    })
    const element = videoAnchor()

    await expect(attachTizenVideo(element, { source: 'https://media.example/broken.mkv' }))
      .rejects.toThrow('prepare failed')

    expect(avplay.api.close).toHaveBeenCalledOnce()
    expect(document.querySelector('[data-air-video-plane="tizen-avplay"]')).toBeNull()
    expect(element.style.visibility).toBe('visible')

    const recoveredAvPlay = mockAvPlay()
    Object.defineProperty(window, 'webapis', {
      configurable: true,
      value: { avplay: recoveredAvPlay.api },
    })
    const recovered = await attachTizenVideo(videoAnchor(), {
      source: 'https://media.example/recovered.mkv',
    })
    await recovered.destroy()
    expect(recoveredAvPlay.api.close).toHaveBeenCalledOnce()
  })
})
