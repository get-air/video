// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'

import { attachTizenVideo } from './tizen'

type AvPlayState = 'NONE' | 'IDLE' | 'READY' | 'PLAYING' | 'PAUSED'

function mockAvPlay(options: { prepareFails?: boolean } = {}) {
  let state: AvPlayState = 'NONE'
  let listener: {
    oncurrentplaytime?: (milliseconds: number) => void
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
    setSilentSubtitle: vi.fn(),
    setSelectTrack: vi.fn(),
    setDisplayRect: vi.fn(),
    setDisplayMethod: vi.fn(),
    setListener: vi.fn((next: typeof listener) => { listener = next }),
  }
  return {
    api,
    emitCurrentTime: (milliseconds: number) => listener.oncurrentplaytime?.(milliseconds),
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

    const controller = await attachTizenVideo(element, { source: 'https://media.example/movie.mkv' })

    const playerObject = document.querySelector<HTMLObjectElement>(
      'object[data-air-video-plane="tizen-avplay"]',
    )
    expect(playerObject?.type).toBe('application/avplayer')
    expect(playerObject?.style.left).toBe('64px')
    expect(playerObject?.style.width).toBe('640px')
    expect(element.style.visibility).toBe('hidden')
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
  })
})
