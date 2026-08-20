// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { Effect } from 'effect'

import { VideoLoadError } from './errors'
import type {
  AttachVideoOptions,
  BackendVideoController,
  PlayerCapabilities,
  VideoControllerEventMap,
} from './index'
import { SwitchingVideoController } from './switching'

const capabilities: PlayerCapabilities = {
  backend: 'html',
  containers: 'platform',
  codecs: 'platform',
  drm: 'platform',
  hdr: 'platform',
  playbackRate: true,
  volume: true,
  videoFit: true,
  videoZoom: true,
  audioTrackSelection: true,
  subtitleTrackSelection: false,
  customHeaders: false,
  frameAccurateSeeking: false,
}

function backend(element: HTMLVideoElement, id: string) {
  const target = new EventTarget()
  const destroy = vi.fn(async () => undefined)
  const value = Object.assign(target, {
    element,
    sessionId: id,
    capabilities,
    media: { seekable: true, live: false, tracks: [], chapters: [] },
    tracks: [],
    play: vi.fn(async () => undefined),
    pause: vi.fn(),
    seek: vi.fn(async () => undefined),
    selectTrack: vi.fn(async () => undefined),
    setVolume: vi.fn(async () => undefined),
    setPlaybackRate: vi.fn(async () => undefined),
    setVideoFit: vi.fn(async () => undefined),
    setVideoZoom: vi.fn(async () => undefined),
    stats: vi.fn(async () => ({ sessionId: id, encodedBytesBuffered: 0,
      bufferedAheadSeconds: 0, decodedFrameCopies: 0, droppedFrames: 0,
      visible: true, playing: false })),
    bufferedAhead: vi.fn(() => 0),
    playbackQuality: vi.fn(() => ({ presentedFrames: 0, measuredFps: 0,
      totalVideoFrames: 0, droppedVideoFrames: 0, droppedFramePercent: 0 })),
    refreshLayout: vi.fn(),
    registerControls: vi.fn(() => () => undefined),
    destroy,
    on<K extends keyof VideoControllerEventMap>(
      type: K,
      listener: (event: VideoControllerEventMap[K]) => void,
    ) {
      target.addEventListener(type, listener as EventListener)
      return () => target.removeEventListener(type, listener as EventListener)
    },
  }) as BackendVideoController
  return { value, destroy }
}

describe('SwitchingVideoController', () => {
  it('keeps its identity while replacing a source and backend', async () => {
    const element = document.createElement('video')
    const first = backend(element, 'first')
    const second = backend(element, 'second')
    const attach = vi.fn((_options: AttachVideoOptions) => Effect.succeed(second.value))
    const controller = new SwitchingVideoController(
      first.value,
      { source: 'one.mp4', backend: 'html' },
      attach,
      { fetch: globalThis.fetch },
    )
    const changed = vi.fn()
    controller.on('backendchange', changed)

    await controller.load('two.mkv', { backend: ['html', 'native-surface'] })

    expect(first.destroy).toHaveBeenCalledOnce()
    expect(attach).toHaveBeenCalledWith(expect.objectContaining({
      source: 'two.mkv',
      backend: ['html', 'native-surface'],
    }))
    expect(controller.sessionId).toBe('second')
    expect(changed).toHaveBeenCalledOnce()
    await controller.setPlaybackRate(1.25)
    expect(second.value.setPlaybackRate).toHaveBeenCalledWith(1.25)
  })

  it('parses shared SRT tracks and emits active cues', async () => {
    const element = document.createElement('video')
    const active = backend(element, 'subtitles')
    const controller = new SwitchingVideoController(
      active.value,
      {
        source: 'movie.mkv',
        subtitles: [{
          id: 'english',
          language: 'en',
          content: '1\n00:00:01,000 --> 00:00:02,500\nHello Air!\n',
        }],
      },
      () => Effect.succeed(active.value),
      { fetch: globalThis.fetch },
    )
    const cue = vi.fn()
    controller.on('subtitlecuechange', cue)
    await controller.selectTrack('subtitle', 'english')
    active.value.dispatchEvent(new CustomEvent('timeupdate', {
      detail: { currentTime: 1.5 },
    }))

    expect(controller.tracks.find((track) => track.id === 'english')?.selected).toBe(true)
    expect(cue).toHaveBeenLastCalledWith(expect.objectContaining({
      detail: expect.objectContaining({
        trackId: 'english',
        cues: [expect.objectContaining({ text: 'Hello Air!' })],
      }),
    }))
  })

  it('enters a typed recoverable state when replacement attachment fails', async () => {
    const element = document.createElement('video')
    const first = backend(element, 'first')
    const recovered = backend(element, 'recovered')
    let attempt = 0
    const attach = vi.fn((_options: AttachVideoOptions) => {
      attempt += 1
      return attempt === 1
        ? Effect.fail(new VideoLoadError({
          backend: 'html',
          message: 'Replacement failed',
        }))
        : Effect.succeed(recovered.value)
    })
    const controller = new SwitchingVideoController(
      first.value,
      { source: 'one.mp4', backend: 'html' },
      attach,
      { fetch: globalThis.fetch },
    )

    await expect(controller.load('broken.mp4')).rejects.toMatchObject({
      _tag: 'VideoLoadError',
      message: 'Replacement failed',
    })
    await expect(controller.play()).rejects.toMatchObject({
      _tag: 'VideoControllerStateError',
      state: 'load-failed',
      operation: 'play video',
    })
    expect(() => controller.sessionId).toThrow(expect.objectContaining({
      _tag: 'VideoControllerStateError',
      state: 'load-failed',
    }))
    expect(first.destroy).toHaveBeenCalledOnce()

    await controller.load('recovered.mp4')

    expect(controller.sessionId).toBe('recovered')
    expect(first.destroy).toHaveBeenCalledOnce()
    expect(attach).toHaveBeenCalledTimes(2)
    await controller.destroy()
  })
})
