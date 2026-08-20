// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { layerHttpTransport } from '@get-air/http/effect'
import { Effect, Layer, Schema } from 'effect'

import {
  attachVideoEffect,
  layerVideoBackends,
  VideoPlayerService,
} from './effect'
import type {
  BackendVideoController,
  PlayerCapabilities,
  VideoBackendAdapter,
  VideoControllerEventMap,
  VideoRoutingAttempt,
} from './index'
import { createVideoClient, markVideoPlayerError } from './index'

class TestAdapterProtocolMismatchError extends Schema.TaggedError<TestAdapterProtocolMismatchError>()(
  'TestAdapterProtocolMismatchError',
  {
    expectedProtocolVersion: Schema.Int,
    actualProtocolVersion: Schema.Int,
    message: Schema.String,
  },
) {}

declare module './index' {
  interface VideoPlayerErrorMap {
    TestAdapterProtocolMismatchError: TestAdapterProtocolMismatchError
  }
}

function protocolMismatchError(): TestAdapterProtocolMismatchError {
  return markVideoPlayerError(new TestAdapterProtocolMismatchError({
    expectedProtocolVersion: 2,
    actualProtocolVersion: 1,
    message: 'The adapter and native plugin use different protocols',
  }))
}

const capabilities: PlayerCapabilities = {
  backend: 'native-surface',
  containers: 'platform',
  codecs: 'platform',
  drm: false,
  hdr: 'platform',
  playbackRate: false,
  volume: true,
  videoFit: true,
  videoZoom: true,
  audioTrackSelection: true,
  subtitleTrackSelection: true,
  customHeaders: true,
  frameAccurateSeeking: false,
}

function fakeBackend(element: HTMLVideoElement, sequence: number): BackendVideoController {
  const events = new EventTarget()
  return Object.assign(events, {
    element,
    sessionId: `native-${sequence}`,
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
    stats: vi.fn(async () => ({ sessionId: `native-${sequence}`,
      encodedBytesBuffered: 0, bufferedAheadSeconds: 0, decodedFrameCopies: 0,
      droppedFrames: 0, visible: true, playing: false })),
    bufferedAhead: vi.fn(() => 0),
    playbackQuality: vi.fn(() => ({ presentedFrames: 0, measuredFps: 0,
      totalVideoFrames: 0, droppedVideoFrames: 0, droppedFramePercent: 0 })),
    refreshLayout: vi.fn(),
    registerControls: vi.fn(() => () => undefined),
    destroy: vi.fn(async () => undefined),
    on<K extends keyof VideoControllerEventMap>(
      type: K,
      listener: (event: VideoControllerEventMap[K]) => void,
    ) {
      events.addEventListener(type, listener as EventListener)
      return () => events.removeEventListener(type, listener as EventListener)
    },
  }) as BackendVideoController
}

describe('external backend adapters', () => {
  it('uses the caller-provided HTML, native, and transcode fallback order', async () => {
    const opened: string[] = []
    const attempts: VideoRoutingAttempt[] = []
    const html: VideoBackendAdapter = {
      id: 'html',
      route: 'html',
      isAvailable: () => true,
      open: async () => {
        opened.push('html')
        throw new Error('HTML cannot decode this source')
      },
    }
    const native: VideoBackendAdapter = {
      id: 'native-surface',
      route: 'native',
      isAvailable: () => true,
      open: async ({ element }) => {
        opened.push('native')
        return fakeBackend(element, 1)
      },
    }
    const transcode: VideoBackendAdapter = {
      id: 'transcode',
      route: 'transcode',
      isAvailable: () => true,
      open: async ({ element }) => {
        opened.push('transcode')
        return fakeBackend(element, 2)
      },
    }
    const client = createVideoClient({ adapters: [html, native, transcode] })

    const controller = await client.attach(document.createElement('video'), {
      source: 'movie.mkv',
      backend: ['html', 'native-surface', 'transcode'],
      routing: { onAttempt: (attempt) => attempts.push(attempt) },
    })

    expect(opened).toEqual(['html', 'native'])
    expect(attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ backend: 'html', route: 'html', phase: 'failed' }),
      expect.objectContaining({
        backend: 'native-surface',
        route: 'native',
        phase: 'selected',
      }),
    ]))
    expect(attempts.every((attempt) => attempt.elapsedMs >= 0)).toBe(true)
    await controller.destroy()
  })

  it('keeps a named platform adapter outside core while preserving fallback and load', async () => {
    let sequence = 0
    const adapter: VideoBackendAdapter = {
      id: 'native-surface',
      isAvailable: () => true,
      open: vi.fn(async ({ element }) => fakeBackend(element, ++sequence)),
    }
    const client = createVideoClient({ adapters: [adapter] })
    const controller = await client.attach(document.createElement('video'), {
      source: 'movie.mkv',
      backend: ['not-installed', 'native-surface'],
    })

    expect(controller.capabilities.backend).toBe('native-surface')
    expect(controller.sessionId).toBe('native-1')
    await controller.load('next.mkv', { backend: 'native-surface' })
    expect(controller.sessionId).toBe('native-2')
    expect(adapter.open).toHaveBeenCalledTimes(2)
    await controller.destroy()
  })

  it('returns a typed failure for an unregistered backend', async () => {
    const client = createVideoClient()
    await expect(client.attach(document.createElement('video'), {
      source: 'movie.mkv',
      backend: 'not-installed',
    })).rejects.toMatchObject({
      _tag: 'VideoBackendUnavailableError',
      backend: 'not-installed',
    })
  })

  it('preserves a marked adapter error and its fields at the Promise boundary', async () => {
    const failure = protocolMismatchError()
    const adapter: VideoBackendAdapter = {
      id: 'protocol-promise',
      isAvailable: () => true,
      open: async () => { throw failure },
    }
    const client = createVideoClient({ adapters: [adapter] })

    let caught: unknown
    try {
      await client.attach(document.createElement('video'), {
        source: 'movie.mkv',
        backend: 'protocol-promise',
      })
    } catch (cause) {
      caught = cause
    }

    expect(caught).toBeInstanceOf(TestAdapterProtocolMismatchError)
    expect(caught).toMatchObject({
      _tag: 'TestAdapterProtocolMismatchError',
      expectedProtocolVersion: 2,
      actualProtocolVersion: 1,
    })
  })

  it('exposes marked adapter errors to Effect catchTag without losing fields', async () => {
    const failure = protocolMismatchError()
    const adapter: VideoBackendAdapter = {
      id: 'protocol-effect',
      isAvailable: () => true,
      open: async () => { throw failure },
    }
    const InfrastructureLive = Layer.mergeAll(
      layerHttpTransport({ fetch: globalThis.fetch }),
      layerVideoBackends([adapter]),
    )
    const MainLive = VideoPlayerService.Default.pipe(
      Layer.provideMerge(InfrastructureLive),
    )
    const recovered = attachVideoEffect(document.createElement('video'), {
      source: 'movie.mkv',
      backend: 'protocol-effect',
    }).pipe(
      Effect.catchTag('TestAdapterProtocolMismatchError', (error) => Effect.succeed({
        expectedProtocolVersion: error.expectedProtocolVersion,
        actualProtocolVersion: error.actualProtocolVersion,
        message: error.message,
      })),
      Effect.provide(MainLive),
    )

    await expect(Effect.runPromise(recovered)).resolves.toEqual({
      expectedProtocolVersion: 2,
      actualProtocolVersion: 1,
      message: failure.message,
    })
  })

  it('wraps an unmarked tagged Error instead of trusting its shape', async () => {
    const failure = new TestAdapterProtocolMismatchError({
      expectedProtocolVersion: 2,
      actualProtocolVersion: 1,
      message: 'Unmarked protocol failure',
    })
    const adapter: VideoBackendAdapter = {
      id: 'protocol-unmarked',
      isAvailable: () => true,
      open: async () => { throw failure },
    }
    const client = createVideoClient({ adapters: [adapter] })

    await expect(client.attach(document.createElement('video'), {
      source: 'movie.mkv',
      backend: 'protocol-unmarked',
    })).rejects.toMatchObject({
      _tag: 'VideoLoadError',
      backend: 'protocol-unmarked',
      cause: 'Unmarked protocol failure',
    })
  })

  it('preserves marked adapter errors from controller operations', async () => {
    const failure = protocolMismatchError()
    const backend = fakeBackend(document.createElement('video'), 1)
    backend.play = vi.fn(async () => { throw failure })
    const adapter: VideoBackendAdapter = {
      id: 'protocol-operation',
      isAvailable: () => true,
      open: async () => backend,
    }
    const client = createVideoClient({ adapters: [adapter] })
    const controller = await client.attach(backend.element, {
      source: 'movie.mkv',
      backend: 'protocol-operation',
    })

    let caught: unknown
    try {
      await controller.play()
    } catch (cause) {
      caught = cause
    }
    expect(caught).toBeInstanceOf(TestAdapterProtocolMismatchError)
    expect(caught).toMatchObject({
      _tag: 'TestAdapterProtocolMismatchError',
      expectedProtocolVersion: 2,
      actualProtocolVersion: 1,
    })
    await controller.destroy()
  })

  it('continues past an unregistered adapter in an ordered chain', async () => {
    const adapter: VideoBackendAdapter = {
      id: 'native-surface',
      isAvailable: () => true,
      open: async ({ element }) => fakeBackend(element, 1),
    }
    const client = createVideoClient({ adapters: [adapter] })
    const controller = await client.attach(document.createElement('video'), {
      source: 'movie.mkv',
      backend: ['not-installed', 'native-surface'],
    })
    expect(controller.capabilities.backend).toBe('native-surface')
    await controller.destroy()
  })

  it('treats rejected availability probes as candidate failures', async () => {
    const rejectedProbe: VideoBackendAdapter = {
      id: 'probe-rejected',
      isAvailable: vi.fn(async () => {
        throw new Error('Probe crashed')
      }),
      open: vi.fn(async ({ element }) => fakeBackend(element, 1)),
    }
    const fallback: VideoBackendAdapter = {
      id: 'probe-fallback',
      isAvailable: vi.fn(() => true),
      open: vi.fn(async ({ element }) => fakeBackend(element, 2)),
    }
    const client = createVideoClient({ adapters: [rejectedProbe, fallback] })
    const controller = await client.attach(document.createElement('video'), {
      source: 'movie.mkv',
      backend: ['probe-rejected', 'probe-fallback'],
    })

    expect(controller.sessionId).toBe('native-2')
    expect(rejectedProbe.open).not.toHaveBeenCalled()
    expect(fallback.open).toHaveBeenCalledOnce()
    await controller.destroy()
  })

  it('does not probe later candidates after an earlier adapter opens', async () => {
    const first: VideoBackendAdapter = {
      id: 'probe-first',
      isAvailable: vi.fn(() => true),
      open: vi.fn(async ({ element }) => fakeBackend(element, 1)),
    }
    const laterProbe = vi.fn(async () => {
      throw new Error('Must remain lazy')
    })
    const later: VideoBackendAdapter = {
      id: 'probe-later',
      isAvailable: laterProbe,
      open: vi.fn(async ({ element }) => fakeBackend(element, 2)),
    }
    const client = createVideoClient({ adapters: [first, later] })
    const controller = await client.attach(document.createElement('video'), {
      source: 'movie.mkv',
      backend: ['probe-first', 'probe-later'],
    })

    expect(controller.sessionId).toBe('native-1')
    expect(laterProbe).not.toHaveBeenCalled()
    await controller.destroy()
  })

  it('continues to a native adapter when HTML cannot honor explicit cookies', async () => {
    const fallback: VideoBackendAdapter = {
      id: 'cookie-native',
      isAvailable: () => true,
      open: vi.fn(async ({ element }) => fakeBackend(element, 1)),
    }
    const client = createVideoClient({ adapters: [fallback] })
    const controller = await client.attach(document.createElement('video'), {
      source: { uri: 'movie.mkv', cookies: 'session=private' },
      backend: ['html', 'cookie-native'],
    })

    expect(controller.capabilities.backend).toBe('native-surface')
    expect(fallback.open).toHaveBeenCalledOnce()
    await controller.destroy()
  })

  it('aborts an in-flight adapter open and disposes a late controller', async () => {
    const signal = new AbortController()
    const late = fakeBackend(document.createElement('video'), 1)
    let resolveOpen!: (controller: BackendVideoController) => void
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const opening = new Promise<BackendVideoController>((resolve) => { resolveOpen = resolve })
    const adapter: VideoBackendAdapter = {
      id: 'slow-native',
      isAvailable: () => true,
      open: vi.fn(() => {
        markStarted()
        return opening
      }),
    }
    const client = createVideoClient({ adapters: [adapter] })
    const attaching = client.attach(late.element, {
      source: 'movie.mkv',
      backend: 'slow-native',
      signal: signal.signal,
    })
    await started

    signal.abort(new DOMException('View unmounted', 'AbortError'))
    await expect(attaching).rejects.toMatchObject({
      _tag: 'VideoLoadError',
      backend: 'slow-native',
    })
    resolveOpen(late)
    await vi.waitFor(() => expect(late.destroy).toHaveBeenCalledOnce())
  })

  it('moves the stable controller to destroyed when its signal aborts', async () => {
    const signal = new AbortController()
    const active = fakeBackend(document.createElement('video'), 1)
    const adapter: VideoBackendAdapter = {
      id: 'abort-native',
      isAvailable: () => true,
      open: async () => active,
    }
    const client = createVideoClient({ adapters: [adapter] })
    const controller = await client.attach(active.element, {
      source: 'movie.mkv',
      backend: 'abort-native',
      signal: signal.signal,
    })

    signal.abort()
    await vi.waitFor(() => expect(active.destroy).toHaveBeenCalledOnce())
    await expect(controller.play()).rejects.toMatchObject({
      _tag: 'VideoControllerStateError',
      state: 'destroyed',
    })
  })

  it('honors and retains per-load transport overrides', async () => {
    const defaultHttp = { fetch: vi.fn(async () => new Response()) }
    const overrideHttp = { fetch: vi.fn(async () => new Response()) }
    let sequence = 0
    const adapter: VideoBackendAdapter = {
      id: 'transport-aware',
      isAvailable: () => true,
      open: vi.fn(async ({ element }) => fakeBackend(element, ++sequence)),
    }
    const client = createVideoClient({ adapters: [adapter], http: defaultHttp })
    const controller = await client.attach(document.createElement('video'), {
      source: 'one.mkv',
      backend: 'transport-aware',
    })
    expect(vi.mocked(adapter.open).mock.calls[0]?.[0].http).toBe(defaultHttp)

    await controller.load('two.mkv', { http: overrideHttp })
    await controller.load('three.mkv')

    expect(vi.mocked(adapter.open).mock.calls[1]?.[0].http).toBe(overrideHttp)
    expect(vi.mocked(adapter.open).mock.calls[2]?.[0].http).toBe(overrideHttp)
    await controller.destroy()
  })

  it('exposes stable load and controller operations as Effects', async () => {
    let sequence = 0
    const adapter: VideoBackendAdapter = {
      id: 'effect-native',
      isAvailable: () => true,
      open: vi.fn(async ({ element }) => fakeBackend(element, ++sequence)),
    }
    const InfrastructureLive = Layer.mergeAll(
      layerHttpTransport({ fetch: globalThis.fetch }),
      layerVideoBackends([adapter]),
    )
    const MainLive = VideoPlayerService.Default.pipe(
      Layer.provideMerge(InfrastructureLive),
    )
    const controller = await Effect.runPromise(attachVideoEffect(
      document.createElement('video'),
      { source: 'one.mkv', backend: 'effect-native' },
    ).pipe(Effect.provide(MainLive)))

    expect(await Effect.runPromise(controller.sessionId)).toBe('native-1')
    await Effect.runPromise(controller.load('two.mkv'))
    expect(await Effect.runPromise(controller.sessionId)).toBe('native-2')
    await Effect.runPromise(controller.play())
    await Effect.runPromise(controller.setPlaybackRate(1.25))
    await Effect.runPromise(controller.destroy())
    expect(adapter.open).toHaveBeenCalledTimes(2)
  })
})
