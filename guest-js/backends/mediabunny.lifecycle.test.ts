// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mediaMocks = vi.hoisted(() => ({
  dispose: vi.fn(),
  nextVideoFrame: vi.fn(),
  returnVideoFrames: vi.fn(async () => ({ done: true, value: undefined })),
}))

vi.mock('mediabunny', () => {
  const videoTrack = {
    type: 'video',
    id: 1,
    number: 1,
    canDecode: vi.fn(async () => true),
    isLive: vi.fn(async () => false),
    isVideoTrack: () => true,
    isAudioTrack: () => false,
    getCodecParameterString: vi.fn(async () => 'avc1.640028'),
    getInternalCodecId: vi.fn(async () => 'avc1'),
    getLanguageCode: vi.fn(async () => 'und'),
    getName: vi.fn(async () => 'Video'),
    getDisposition: vi.fn(async () => ({ default: true, forced: false })),
    getDisplayWidth: vi.fn(async () => 1920),
    getDisplayHeight: vi.fn(async () => 1080),
    computeFrameRateMetrics: vi.fn(async () => ({ averageFrameRate: 30 })),
  }

  class Input {
    constructor(_options: unknown) {}
    canRead = vi.fn(async () => true)
    getFormat = vi.fn(async () => ({ name: 'matroska' }))
    getTracks = vi.fn(async () => [videoTrack])
    getVideoTracks = vi.fn(async () => [videoTrack])
    getAudioTracks = vi.fn(async () => [])
    getDurationFromMetadata = vi.fn(async () => 60)
    computeDuration = vi.fn(async () => 60)
    dispose = mediaMocks.dispose
  }

  class UrlSource {
    constructor(_uri: string, _options: unknown) {}
  }

  class CanvasSink {
    constructor(_track: unknown, _options: unknown) {}
    getCanvas = vi.fn(async () => ({
      canvas: document.createElement('canvas'),
      timestamp: 0,
      duration: 1 / 30,
    }))
    canvases() {
      return {
        next: mediaMocks.nextVideoFrame,
        return: mediaMocks.returnVideoFrames,
        [Symbol.asyncIterator]() { return this },
      }
    }
  }

  class AudioBufferSink {}

  return {
    ALL_FORMATS: [],
    AudioBufferSink,
    CanvasSink,
    Input,
    UrlSource,
  }
})

import { attachMediabunnyVideo } from './mediabunny'

function decodedFrame() {
  return {
    canvas: document.createElement('canvas'),
    timestamp: 0,
    duration: 1 / 30,
  }
}

beforeEach(() => {
  document.body.replaceChildren()
  mediaMocks.dispose.mockReset()
  mediaMocks.nextVideoFrame.mockReset()
  mediaMocks.returnVideoFrames.mockClear()
  mediaMocks.nextVideoFrame
    .mockResolvedValueOnce({ done: false, value: decodedFrame() })
    .mockResolvedValueOnce({ done: false, value: decodedFrame() })
    .mockRejectedValueOnce(new Error('decoder iterator failed'))
  vi.stubGlobal('VideoDecoder', class {})
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    disconnect(): void {}
  })
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(performance.now()))
    return 1
  }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('MediaBunny backend lifecycle', () => {
  it('publishes detached render failures and removes its abort listener on destroy', async () => {
    const element = document.createElement('video')
    document.body.append(element)
    const abort = new AbortController()
    const addAbort = vi.spyOn(abort.signal, 'addEventListener')
    const removeAbort = vi.spyOn(abort.signal, 'removeEventListener')
    const controller = await attachMediabunnyVideo(element, {
      source: 'https://media.example/movie.mkv',
      signal: abort.signal,
    }, { fetch: globalThis.fetch })
    const backendAbort = addAbort.mock.calls.find(([type]) => type === 'abort')?.[1]
    const playbackError = vi.fn()
    controller.on('error', playbackError)

    await controller.play()

    await vi.waitFor(() => expect(playbackError).toHaveBeenCalledOnce())
    expect(playbackError).toHaveBeenCalledWith(expect.objectContaining({
      detail: {
        code: 'mediabunny-video-render',
        message: 'MediaBunny video-render failed: decoder iterator failed',
      },
    }))
    await expect(controller.stats()).resolves.toMatchObject({ playing: false })
    await controller.destroy()
    expect(removeAbort).toHaveBeenCalledWith('abort', backendAbort)
  })
})
