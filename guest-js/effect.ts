import type { HttpTransport } from '@get-air/http'
import { HttpTransportService, layerHttpTransport } from '@get-air/http/effect'
import { Context, Effect, Layer } from 'effect'

import { attachHtmlVideo } from './backends/html'
import { attachTizenVideo, hasTizenAvPlay } from './backends/tizen'
import {
  isVideoPlayerError,
  VideoBackendUnavailableError,
  VideoControllerStateError,
  VideoLoadError,
  type VideoPlayerError,
} from './errors'
import type {
  AttachVideoOptions,
  BackendVideoController,
  MediaInfo,
  MediaTrack,
  PlaybackQuality,
  PlayerCapabilities,
  SessionStats,
  TrackKind,
  VideoBackend,
  VideoBackendAdapter,
  VideoBackendId,
  VideoClientOptions,
  VideoController,
  VideoControllerEventMap,
  VideoControlsTarget,
  VideoFitMode,
  VideoLoadOptions,
  VideoRuntimeContext,
  VideoRouteKind,
  VideoRoutingAttempt,
  VideoSource,
} from './index'
import {
  runVideoEffectPromise,
  SwitchingVideoController,
} from './switching'

export {
  isVideoPlayerError,
  VideoBackendUnavailableError,
  VideoControllerStateError,
  VideoFeatureUnavailableError,
  VideoLoadError,
  type VideoPlayerError,
} from './errors'

/** Effect-native mirror of the stable DOM controller. */
export interface EffectVideoController {
  readonly element: HTMLVideoElement
  readonly sessionId: Effect.Effect<string, VideoControllerStateError>
  readonly capabilities: Effect.Effect<PlayerCapabilities, VideoControllerStateError>
  readonly media: Effect.Effect<MediaInfo, VideoControllerStateError>
  readonly tracks: Effect.Effect<readonly MediaTrack[], VideoControllerStateError>
  load(source: string | VideoSource, options?: VideoLoadOptions): Effect.Effect<void, VideoPlayerError>
  play(): Effect.Effect<void, VideoPlayerError>
  pause(): Effect.Effect<void, VideoPlayerError>
  seek(positionSeconds: number): Effect.Effect<void, VideoPlayerError>
  selectTrack(kind: TrackKind, trackId?: string): Effect.Effect<void, VideoPlayerError>
  setVolume(volume: number): Effect.Effect<void, VideoPlayerError>
  setPlaybackRate(rate: number): Effect.Effect<void, VideoPlayerError>
  setVideoFit(mode: VideoFitMode): Effect.Effect<void, VideoPlayerError>
  setVideoZoom(scale: number): Effect.Effect<void, VideoPlayerError>
  stats(): Effect.Effect<SessionStats, VideoPlayerError>
  bufferedAhead(): Effect.Effect<number, VideoPlayerError>
  playbackQuality(): Effect.Effect<PlaybackQuality, VideoPlayerError>
  refreshLayout(): Effect.Effect<void, VideoPlayerError>
  registerControls(target: VideoControlsTarget): Effect.Effect<() => void, VideoPlayerError>
  destroy(): Effect.Effect<void, VideoPlayerError>
  on<K extends keyof VideoControllerEventMap>(
    type: K,
    listener: (event: VideoControllerEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): Effect.Effect<() => void>
}

const promiseControllers = new WeakMap<EffectVideoController, VideoController>()

export interface VideoBackendRegistry {
  readonly adapters: readonly VideoBackendAdapter[]
}

/** Runtime-injected infrastructure registry for built-in and platform adapters. */
export class VideoBackendRegistryService extends Context.Tag(
  '@get-air/video/VideoBackendRegistryService',
)<VideoBackendRegistryService, VideoBackendRegistry>() {}

export function layerVideoBackends(
  adapters: readonly VideoBackendAdapter[] = [],
): Layer.Layer<VideoBackendRegistryService> {
  return Layer.succeed(VideoBackendRegistryService, {
    adapters: mergeAdapters(builtInAdapters, adapters),
  })
}

export class VideoPlayerService extends Effect.Service<VideoPlayerService>()(
  '@get-air/video/VideoPlayerService',
  {
    accessors: true,
    effect: Effect.gen(function* () {
      const defaultTransport = yield* HttpTransportService
      const registry = yield* VideoBackendRegistryService
      const attach = Effect.fn('VideoPlayerService.attach')(function* (
        element: HTMLVideoElement,
        options: AttachVideoOptions,
      ) {
        const attachBackend = (next: AttachVideoOptions) => attachWithFallback(
          element,
          next,
          next.http ?? defaultTransport,
          registry.adapters,
        )
        const active = yield* attachBackend(options)
        if (options.signal?.aborted) {
          yield* disposeBackend(active)
          return yield* attachmentAborted(active.capabilities.backend, options.signal)
        }
        const controller = new SwitchingVideoController(
          active,
          options,
          attachBackend,
          defaultTransport,
        )
        yield* controller.initializeEffect()
        if (options.signal?.aborted) {
          yield* controller.destroyEffect().pipe(Effect.ignore)
          return yield* attachmentAborted(active.capabilities.backend, options.signal)
        }
        return makeEffectVideoController(controller)
      })
      return { attach }
    }),
  },
) {}

export const attachVideoEffect = Effect.fn('attachVideo')(function* (
  element: HTMLVideoElement,
  options: AttachVideoOptions,
) {
  return yield* VideoPlayerService.attach(element, options)
})

/** Promise/plain-JavaScript boundary. Effect execution does not occur inside services. */
export async function runAttachVideo(
  element: HTMLVideoElement,
  options: AttachVideoOptions,
  clientOptions: VideoClientOptions = {},
): Promise<VideoController> {
  const transport = clientOptions.http ?? browserHttpTransport
  const InfrastructureLive = Layer.mergeAll(
    layerHttpTransport(transport),
    layerVideoBackends(clientOptions.adapters),
  )
  const MainLive = VideoPlayerService.Default.pipe(
    Layer.provideMerge(InfrastructureLive),
  )
  const effectController = await runVideoEffectPromise(
    attachVideoEffect(element, options).pipe(Effect.provide(MainLive)),
  )
  const controller = promiseControllers.get(effectController)
  if (!controller) throw new Error('Unable to resolve the Promise video controller boundary')
  return controller
}

const attachWithFallback = Effect.fn('VideoPlayerService.attachWithFallback')(
  function* (
    element: HTMLVideoElement,
    options: AttachVideoOptions,
    transport: HttpTransport,
    adapters: readonly VideoBackendAdapter[],
  ) {
    const candidates = resolveAdapters(options, adapters)
    let lastError: VideoPlayerError | undefined
    for (const adapter of candidates) {
      const route = adapterRoute(adapter)
      const startedAt = yield* Effect.sync(monotonicNow)
      yield* Effect.sync(() => reportRoutingAttempt(options, {
        backend: adapter.id,
        route,
        phase: 'probing',
        elapsedMs: 0,
      }))
      if (options.signal?.aborted) {
        return yield* attachmentAborted(adapter.id, options.signal)
      }
      yield* Effect.annotateCurrentSpan('video.backend', adapter.id)
      const availability = yield* Effect.either(Effect.tryPromise({
        try: () => abortableOperation(
          options.signal,
          () => Promise.resolve(adapter.isAvailable(runtimeContext())),
        ),
        catch: (cause) => new VideoBackendUnavailableError({
          backend: adapter.id,
          message: `Unable to probe video backend ${adapter.id}: ${errorMessage(cause)}`,
        }),
      }))
      if (options.signal?.aborted) {
        return yield* attachmentAborted(adapter.id, options.signal)
      }
      if (availability._tag === 'Left') {
        lastError = availability.left
        yield* Effect.sync(() => reportRoutingAttempt(options, {
          backend: adapter.id,
          route,
          phase: 'failed',
          elapsedMs: monotonicNow() - startedAt,
          message: availability.left.message,
        }))
        continue
      }
      if (!availability.right) {
        lastError = new VideoBackendUnavailableError({
          backend: adapter.id,
          message: `Video backend ${adapter.id} is not available in this runtime`,
        })
        yield* Effect.sync(() => reportRoutingAttempt(options, {
          backend: adapter.id,
          route,
          phase: 'unavailable',
          elapsedMs: monotonicNow() - startedAt,
          message: lastError?.message,
        }))
        continue
      }
      yield* Effect.sync(() => reportRoutingAttempt(options, {
        backend: adapter.id,
        route,
        phase: 'opening',
        elapsedMs: monotonicNow() - startedAt,
      }))
      const result = yield* Effect.either(Effect.tryPromise({
        try: () => abortableOperation(
          options.signal,
          () => adapter.open({ element, options, http: transport }),
          (controller) => controller.destroy(),
        ),
        catch: (cause) => normalizePlayerError(adapter.id, cause),
      }))
      if (result._tag === 'Right') {
        yield* Effect.sync(() => reportRoutingAttempt(options, {
          backend: adapter.id,
          route,
          phase: 'selected',
          elapsedMs: monotonicNow() - startedAt,
        }))
        return result.right
      }
      if (options.signal?.aborted) {
        return yield* attachmentAborted(adapter.id, options.signal)
      }
      lastError = result.left
      yield* Effect.sync(() => reportRoutingAttempt(options, {
        backend: adapter.id,
        route,
        phase: 'failed',
        elapsedMs: monotonicNow() - startedAt,
        message: result.left.message,
      }))
    }
    return yield* (lastError ?? new VideoBackendUnavailableError({
      backend: 'html',
      message: 'No video backends were configured',
    }))
  },
)

function resolveAdapters(
  options: AttachVideoOptions,
  adapters: readonly VideoBackendAdapter[],
): readonly VideoBackendAdapter[] {
  const requested = requestedBackends(options)
  const resolved: VideoBackendAdapter[] = []
  for (const backend of requested) {
    const choices = backend === 'auto'
      ? [...adapters]
        .filter((adapter) => adapter.autoPriority !== undefined)
        .filter((adapter) => routeOrder(options).includes(adapterRoute(adapter)))
        .sort((left, right) => compareAutoAdapters(left, right, routeOrder(options)))
      : adapters.filter((adapter) => adapter.id === backend)
    if (choices.length === 0) {
      if (backend !== 'auto') {
        resolved.push(unavailableAdapter(backend,
          `Video backend ${String(backend)} is not registered`))
      }
      continue
    }
    for (const adapter of choices) {
      if (!resolved.some((candidate) => candidate.id === adapter.id)) resolved.push(adapter)
    }
  }
  return resolved
}

export const defaultVideoRouteOrder: readonly VideoRouteKind[] = [
  'html',
  'native',
  'client',
  'transcode',
]

function routeOrder(options: AttachVideoOptions): readonly VideoRouteKind[] {
  return [...new Set(options.routing?.order ?? defaultVideoRouteOrder)]
}

function adapterRoute(adapter: VideoBackendAdapter): VideoRouteKind {
  if (adapter.route) return adapter.route
  if (adapter.id === 'html' || adapter.id === 'webos' || adapter.id === 'vizio') return 'html'
  if (adapter.id === 'mediabunny') return 'client'
  if (adapter.id === 'transcode') return 'transcode'
  return 'native'
}

function compareAutoAdapters(
  left: VideoBackendAdapter,
  right: VideoBackendAdapter,
  order: readonly VideoRouteKind[],
): number {
  const routeDifference = order.indexOf(adapterRoute(left)) - order.indexOf(adapterRoute(right))
  return routeDifference || (right.autoPriority ?? 0) - (left.autoPriority ?? 0)
}

function reportRoutingAttempt(
  options: AttachVideoOptions,
  attempt: VideoRoutingAttempt,
): void {
  try {
    options.routing?.onAttempt?.(attempt)
  } catch {
    // Diagnostics must never affect playback selection.
  }
}

function monotonicNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function unavailableAdapter(id: VideoBackendId, message: string): VideoBackendAdapter {
  return {
    id,
    isAvailable: () => true,
    open: () => Promise.reject(new VideoBackendUnavailableError({ backend: id, message })),
  }
}

export function requestedBackends(
  options: Pick<AttachVideoOptions, 'backend' | 'fallbackBackends'>,
): readonly VideoBackend[] {
  const requested = Array.isArray(options.backend)
    ? [...options.backend]
    : options.backend ? [options.backend] : ['auto']
  return [...new Set([...requested, ...(options.fallbackBackends ?? [])])]
}

export interface VideoRuntimeHints {
  readonly tizen: boolean
  readonly webos: boolean
  readonly vizio: boolean
}

export function selectPlayerBackend(
  requested: AttachVideoOptions['backend'],
  runtime: VideoRuntimeHints = runtimeHints(),
): VideoBackendId {
  const first = Array.isArray(requested) ? requested[0] : requested
  if (first && first !== 'auto') return first
  if (runtime.tizen) return 'tizen'
  if (runtime.webos) return 'webos'
  if (runtime.vizio) return 'vizio'
  return 'html'
}

const builtInAdapters: readonly VideoBackendAdapter[] = [
  {
    id: 'mediabunny',
    route: 'client',
    autoPriority: 100,
    isAvailable: () => typeof VideoDecoder !== 'undefined' || typeof AudioDecoder !== 'undefined',
    open: async ({ element, options, http }) => {
      const { attachMediabunnyVideo } = await import('./backends/mediabunny')
      return attachMediabunnyVideo(element, options, http)
    },
  },
  {
    id: 'tizen',
    route: 'native',
    autoPriority: 300,
    isAvailable: () => hasTizenAvPlay(),
    open: ({ element, options }) => attachTizenVideo(element, options),
  },
  {
    id: 'webos',
    route: 'html',
    autoPriority: 200,
    isAvailable: ({ userAgent, global }) => /web0S|webOS/i.test(userAgent) || 'webOS' in global,
    open: ({ element, options, http }) => attachHtmlVideo(element, options, 'webos', http),
  },
  {
    id: 'vizio',
    route: 'html',
    autoPriority: 200,
    isAvailable: (context) => isVizioRuntime(context),
    open: ({ element, options, http }) => attachHtmlVideo(element, options, 'vizio', http),
  },
  {
    id: 'html',
    route: 'html',
    autoPriority: 0,
    isAvailable: () => true,
    open: ({ element, options, http }) => attachHtmlVideo(element, options, 'html', http),
  },
]

function mergeAdapters(
  defaults: readonly VideoBackendAdapter[],
  overrides: readonly VideoBackendAdapter[],
): readonly VideoBackendAdapter[] {
  const byId = new Map(defaults.map((adapter) => [adapter.id, adapter]))
  for (const adapter of overrides) byId.set(adapter.id, adapter)
  return [...byId.values()]
}

function runtimeContext(): VideoRuntimeContext {
  return {
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    global: globalThis,
  }
}

function runtimeHints(): VideoRuntimeHints {
  const context = runtimeContext()
  return {
    tizen: typeof window !== 'undefined' && hasTizenAvPlay(),
    webos: /web0S|webOS/i.test(context.userAgent) || 'webOS' in context.global,
    vizio: isVizioRuntime(context),
  }
}

function isVizioRuntime(context: VideoRuntimeContext): boolean {
  return /VIZIO|SmartCast/i.test(context.userAgent) || 'VIZIO' in context.global
}

function normalizePlayerError(backend: VideoBackendId, cause: unknown): VideoPlayerError {
  if (isVideoPlayerError(cause)) return cause
  return new VideoLoadError({
    backend,
    message: `Unable to start the ${backend} video backend`,
    cause: errorMessage(cause),
  })
}

function attachmentAborted(
  backend: VideoBackendId,
  signal: AbortSignal,
): VideoLoadError {
  return new VideoLoadError({
    backend,
    message: `Video attachment with backend ${backend} was aborted`,
    cause: errorMessage(signal.reason ?? new DOMException('Video attachment was aborted', 'AbortError')),
  })
}

function abortableOperation<A>(
  signal: AbortSignal | undefined,
  operation: () => Promise<A>,
  onLateSuccess?: (value: A) => void | Promise<void>,
): Promise<A> {
  if (!signal) return operation()
  if (signal.aborted) return Promise.reject(signal.reason
    ?? new DOMException('Video attachment was aborted', 'AbortError'))

  return new Promise<A>((resolve, reject) => {
    let settled = false
    const cleanup = () => signal.removeEventListener('abort', aborted)
    const aborted = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(signal.reason ?? new DOMException('Video attachment was aborted', 'AbortError'))
    }
    signal.addEventListener('abort', aborted, { once: true })

    let pending: Promise<A>
    try {
      pending = operation()
    } catch (cause) {
      settled = true
      cleanup()
      reject(cause)
      return
    }
    pending.then(
      (value) => {
        if (settled || signal.aborted) {
          if (!settled) {
            settled = true
            cleanup()
            reject(signal.reason ?? new DOMException('Video attachment was aborted', 'AbortError'))
          }
          void Promise.resolve(onLateSuccess?.(value)).catch(() => undefined)
          return
        }
        settled = true
        cleanup()
        resolve(value)
      },
      (cause) => {
        if (settled) return
        settled = true
        cleanup()
        reject(cause)
      },
    )
  })
}

function disposeBackend(controller: BackendVideoController): Effect.Effect<void> {
  return Effect.tryPromise({
    try: () => controller.destroy(),
    catch: () => undefined,
  }).pipe(Effect.ignore)
}

const browserHttpTransport: HttpTransport = {
  fetch: (request) => globalThis.fetch(request),
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function makeEffectVideoController(
  controller: SwitchingVideoController,
): EffectVideoController {
  const effectController: EffectVideoController = {
    element: controller.element,
    get sessionId() { return controller.sessionIdEffect() },
    get capabilities() { return controller.capabilitiesEffect() },
    get media() { return controller.mediaEffect() },
    get tracks() { return controller.tracksEffect() },
    load: (source, options) => controller.loadEffect(source, options),
    play: () => controller.playEffect(),
    pause: () => controller.pauseEffect(),
    seek: (positionSeconds) => controller.seekEffect(positionSeconds),
    selectTrack: (kind, trackId) => controller.selectTrackEffect(kind, trackId),
    setVolume: (volume) => controller.setVolumeEffect(volume),
    setPlaybackRate: (rate) => controller.setPlaybackRateEffect(rate),
    setVideoFit: (mode) => controller.setVideoFitEffect(mode),
    setVideoZoom: (scale) => controller.setVideoZoomEffect(scale),
    stats: () => controller.statsEffect(),
    bufferedAhead: () => controller.bufferedAheadEffect(),
    playbackQuality: () => controller.playbackQualityEffect(),
    refreshLayout: () => controller.refreshLayoutEffect(),
    registerControls: (target) => controller.registerControlsEffect(target),
    destroy: () => controller.destroyEffect(),
    on: (type, listener, options) => Effect.sync(() => controller.on(type, listener, options)),
  }
  promiseControllers.set(effectController, controller)
  return effectController
}
