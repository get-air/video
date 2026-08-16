import type { HttpTransport } from '@get-air/http'
import { parse } from '@plussub/srt-vtt-parser'
import { Cause, Effect, Exit, Option } from 'effect'

import {
  VideoBackendUnavailableError,
  VideoControllerStateError,
  VideoFeatureUnavailableError,
  VideoLoadError,
  type VideoPlayerError,
} from './errors'
import type {
  AttachVideoOptions,
  BackendVideoController,
  ExternalSubtitleTrack,
  MediaInfo,
  MediaTrack,
  PlaybackQuality,
  PlayerCapabilities,
  SessionStats,
  SubtitleCue,
  TrackKind,
  VideoController,
  VideoControllerEventMap,
  VideoControlsTarget,
  VideoBackendId,
  VideoFitMode,
  VideoLoadOptions,
  VideoSource,
} from './index'

type AttachBackend = (
  options: AttachVideoOptions,
) => Effect.Effect<BackendVideoController, VideoPlayerError>
type ControllerState = 'active' | 'loading' | 'load-failed' | 'destroyed'

/**
 * Stable public controller that can replace its backend without replacing UI
 * references or event subscriptions. Backend instances remain intentionally
 * private so every load follows the same Effect-backed selection path.
 */
export class SwitchingVideoController extends EventTarget implements VideoController {
  readonly element: HTMLVideoElement
  #active: BackendVideoController | undefined
  #options: AttachVideoOptions
  readonly #attach: AttachBackend
  readonly #defaultTransport: HttpTransport
  readonly #loadSemaphore = Effect.unsafeMakeSemaphore(1)
  #state: ControllerState = 'active'
  #stateCause: string | undefined
  #lastBackend: VideoBackendId
  #unsubscribe: Array<() => void> = []
  #subtitleTrack?: ExternalSubtitleTrack
  #subtitleCues: readonly SubtitleCue[] = []
  #visibleCues: readonly SubtitleCue[] = []
  #abortSignal?: AbortSignal

  constructor(
    active: BackendVideoController,
    options: AttachVideoOptions,
    attach: AttachBackend,
    transport: HttpTransport,
  ) {
    super()
    this.element = active.element
    this.#active = active
    this.#lastBackend = active.capabilities.backend
    this.#options = options
    this.#attach = attach
    this.#defaultTransport = transport
    this.#forwardEvents(active)
    this.#bindAbortSignal(options.signal)
  }

  readonly initializeEffect = Effect.fn('SwitchingVideoController.initialize')(() => {
    const initialSubtitle = this.#options.subtitles?.find((track) => track.default)
    if (!initialSubtitle) return Effect.void
    return Effect.promise(() => this.#selectExternalSubtitle(
      this.#requireActive('select the default subtitle'),
      initialSubtitle,
    ).catch((cause) => this.#publishSubtitleError(initialSubtitle.id, cause)))
  })

  readonly sessionIdEffect = Effect.fn('SwitchingVideoController.sessionId')(
    () => this.#readActive('read the session ID', (active) => active.sessionId),
  )

  readonly capabilitiesEffect = Effect.fn('SwitchingVideoController.capabilities')(
    () => this.#readActive('read capabilities', (active) => {
      if (!this.#options.subtitles?.length) return active.capabilities
      return { ...active.capabilities, subtitleTrackSelection: true }
    }),
  )

  readonly mediaEffect = Effect.fn('SwitchingVideoController.media')(
    () => this.#readActive('read media information', (active) => ({
      ...active.media,
      tracks: [...active.tracks, ...this.#externalTracks()],
    })),
  )

  readonly tracksEffect = Effect.fn('SwitchingVideoController.tracks')(
    () => this.#readActive('read tracks', (active) => [
      ...active.tracks,
      ...this.#externalTracks(),
    ]),
  )

  get sessionId(): string { return runVideoEffectSync(this.sessionIdEffect()) }

  get capabilities(): PlayerCapabilities {
    return runVideoEffectSync(this.capabilitiesEffect())
  }

  get media(): MediaInfo {
    return runVideoEffectSync(this.mediaEffect())
  }

  get tracks(): readonly MediaTrack[] {
    return runVideoEffectSync(this.tracksEffect())
  }

  readonly playEffect = Effect.fn('SwitchingVideoController.play')(
    () => this.#tryPromise('play video', (active) => active.play()),
  )

  readonly pauseEffect = Effect.fn('SwitchingVideoController.pause')(
    () => this.#trySync('pause video', (active) => active.pause()),
  )

  readonly seekEffect = Effect.fn('SwitchingVideoController.seek')(
    (positionSeconds: number) => this.#tryPromise(
      'seek video',
      (active) => active.seek(positionSeconds),
    ),
  )

  readonly selectTrackEffect = Effect.fn('SwitchingVideoController.selectTrack')(
    (kind: TrackKind, trackId?: string) => this.#tryPromise(
      'select a track',
      (active) => this.#selectTrack(active, kind, trackId),
    ),
  )

  readonly setVolumeEffect = Effect.fn('SwitchingVideoController.setVolume')(
    (volume: number) => this.#tryPromise(
      'set volume',
      (active) => active.setVolume(volume),
    ),
  )

  readonly setPlaybackRateEffect = Effect.fn('SwitchingVideoController.setPlaybackRate')(
    (rate: number) => this.#tryPromise(
      'set playback rate',
      (active) => active.setPlaybackRate(rate),
    ),
  )

  readonly setVideoFitEffect = Effect.fn('SwitchingVideoController.setVideoFit')(
    (mode: VideoFitMode) => this.#tryPromise(
      'set video fit',
      (active) => active.setVideoFit(mode),
    ),
  )

  readonly setVideoZoomEffect = Effect.fn('SwitchingVideoController.setVideoZoom')(
    (scale: number) => this.#tryPromise(
      'set video zoom',
      (active) => active.setVideoZoom(scale),
    ),
  )

  readonly statsEffect = Effect.fn('SwitchingVideoController.stats')(
    () => this.#tryPromise('read video statistics', (active) => active.stats()),
  )

  readonly bufferedAheadEffect = Effect.fn('SwitchingVideoController.bufferedAhead')(
    () => this.#trySync('read buffered duration', (active) => active.bufferedAhead()),
  )

  readonly playbackQualityEffect = Effect.fn('SwitchingVideoController.playbackQuality')(
    () => this.#trySync('read playback quality', (active) => active.playbackQuality()),
  )

  readonly refreshLayoutEffect = Effect.fn('SwitchingVideoController.refreshLayout')(
    () => this.#trySync('refresh video layout', (active) => active.refreshLayout()),
  )

  readonly registerControlsEffect = Effect.fn('SwitchingVideoController.registerControls')(
    (target: VideoControlsTarget) => this.#trySync(
      'register video controls',
      (active) => active.registerControls(target),
    ),
  )

  play(): Promise<void> { return runVideoEffectPromise(this.playEffect()) }
  pause(): void { runVideoEffectSync(this.pauseEffect()) }
  seek(positionSeconds: number): Promise<void> {
    return runVideoEffectPromise(this.seekEffect(positionSeconds))
  }
  setVolume(volume: number): Promise<void> {
    return runVideoEffectPromise(this.setVolumeEffect(volume))
  }
  setPlaybackRate(rate: number): Promise<void> {
    return runVideoEffectPromise(this.setPlaybackRateEffect(rate))
  }
  setVideoFit(mode: VideoFitMode): Promise<void> {
    return runVideoEffectPromise(this.setVideoFitEffect(mode))
  }
  setVideoZoom(scale: number): Promise<void> {
    return runVideoEffectPromise(this.setVideoZoomEffect(scale))
  }
  stats(): Promise<SessionStats> { return runVideoEffectPromise(this.statsEffect()) }
  bufferedAhead(): number { return runVideoEffectSync(this.bufferedAheadEffect()) }
  playbackQuality(): PlaybackQuality {
    return runVideoEffectSync(this.playbackQualityEffect())
  }
  refreshLayout(): void { runVideoEffectSync(this.refreshLayoutEffect()) }
  registerControls(target: VideoControlsTarget): () => void {
    return runVideoEffectSync(this.registerControlsEffect(target))
  }

  /**
   * Replaces the current source. `backend` may be a single value or an ordered
   * chain such as `['mediabunny', 'html']`; other omitted options are retained.
   */
  load(source: string | VideoSource, options: VideoLoadOptions = {}): Promise<void> {
    return runVideoEffectPromise(this.loadEffect(source, options))
  }

  readonly loadEffect = Effect.fn('SwitchingVideoController.load')(
    (source: string | VideoSource, options: VideoLoadOptions = {}) => {
      const controller = this
      const replace = Effect.gen(function* () {
        if (controller.#state === 'destroyed') {
          return yield* controller.#stateError('load video')
        }
        const nextOptions: AttachVideoOptions = { ...controller.#options, ...options, source }
        controller.#bindAbortSignal(nextOptions.signal)
        const previous = controller.#active
        const previousBackend = controller.#lastBackend
        controller.#state = 'loading'
        controller.#stateCause = undefined
        controller.#stopForwarding()
        controller.#active = undefined
        if (previous) {
          yield* Effect.tryPromise({
            try: () => previous.destroy(),
            catch: (cause) => nextOptions.signal?.aborted
              ? controller.#abortLoad(nextOptions.signal, 'destroy the previous backend')
              : controller.#transitionFailure(
                'load-failed',
                'destroy the previous backend',
                cause,
              ),
          })
        }
        const active = yield* controller.#attach(nextOptions).pipe(
          Effect.tapError((cause) => Effect.sync(() => {
            if (nextOptions.signal?.aborted) {
              controller.#abortLoad(nextOptions.signal, 'load video')
            } else {
              controller.#markLoadFailed(cause)
            }
          })),
        )
        if (nextOptions.signal?.aborted) {
          yield* Effect.tryPromise({
            try: () => active.destroy(),
            catch: () => undefined,
          }).pipe(Effect.ignore)
          return yield* controller.#abortLoad(nextOptions.signal, 'load video')
        }
        controller.#active = active
        controller.#lastBackend = active.capabilities.backend
        controller.#options = nextOptions
        controller.#subtitleTrack = undefined
        controller.#subtitleCues = []
        controller.#visibleCues = []
        controller.#state = 'active'
        controller.#stateCause = undefined
        controller.#forwardEvents(active)
        const defaultSubtitle = nextOptions.subtitles?.find((track) => track.default)
        if (defaultSubtitle) {
          yield* Effect.promise(() => controller.#selectExternalSubtitle(active, defaultSubtitle)
            .catch((cause) => controller.#publishSubtitleError(defaultSubtitle.id, cause)))
        }
        if (nextOptions.signal?.aborted) {
          controller.#active = undefined
          controller.#stopForwarding()
          yield* Effect.tryPromise({
            try: () => active.destroy(),
            catch: () => undefined,
          }).pipe(Effect.ignore)
          return yield* controller.#abortLoad(nextOptions.signal, 'load video')
        }
        controller.dispatchEvent(new CustomEvent('backendchange', {
          detail: { previousBackend, backend: active.capabilities.backend },
        }))
      }).pipe(
        Effect.ensuring(Effect.sync(() => {
          if (controller.#state === 'loading') {
            controller.#state = 'load-failed'
            controller.#stateCause = 'The replacement load did not complete'
          }
        })),
      )
      return controller.#loadSemaphore.withPermits(1)(replace)
    },
  )

  selectTrack(kind: TrackKind, trackId?: string): Promise<void> {
    return runVideoEffectPromise(this.selectTrackEffect(kind, trackId))
  }

  async #selectTrack(
    active: BackendVideoController,
    kind: TrackKind,
    trackId?: string,
  ): Promise<void> {
    if (kind !== 'subtitle') return active.selectTrack(kind, trackId)
    const external = this.#options.subtitles?.find((track) => track.id === trackId)
    if (trackId && !external) return active.selectTrack(kind, trackId)
    if (external) {
      await this.#selectExternalSubtitle(active, external)
      return
    }
    this.#subtitleTrack = undefined
    this.#subtitleCues = []
    this.#publishCues([])
    if (active.capabilities.subtitleTrackSelection) {
      await active.selectTrack(kind, trackId)
    }
  }

  readonly destroyEffect = Effect.fn('SwitchingVideoController.destroy')(() => {
    const controller = this
    return controller.#loadSemaphore.withPermits(1)(Effect.gen(function* () {
      if (controller.#state === 'destroyed') return
      const active = controller.#active
      controller.#active = undefined
      controller.#state = 'destroyed'
      controller.#stateCause = undefined
      controller.#unbindAbortSignal()
      controller.#stopForwarding()
      if (active) {
        yield* Effect.tryPromise({
          try: () => active.destroy(),
          catch: (cause) => controller.#transitionFailure(
            'destroyed',
            'destroy video',
            cause,
          ),
        })
      }
    }))
  })

  destroy(): Promise<void> {
    return runVideoEffectPromise(this.destroyEffect())
  }

  on<K extends keyof VideoControllerEventMap>(
    type: K,
    listener: (event: VideoControllerEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): () => void {
    const eventListener = listener as EventListener
    this.addEventListener(type, eventListener, options)
    return () => this.removeEventListener(type, eventListener, options)
  }

  async #selectExternalSubtitle(
    active: BackendVideoController,
    track: ExternalSubtitleTrack,
  ): Promise<void> {
    const content = track.content ?? await this.#fetchSubtitle(track)
    if (this.#state === 'destroyed') return
    const result = parse(content)
    this.#subtitleTrack = track
    this.#subtitleCues = result.entries.map((entry, index) => ({
      id: entry.id || `${track.id}-${index}`,
      startSeconds: entry.from / 1000,
      endSeconds: entry.to / 1000,
      text: entry.text,
    }))
    // Disable an embedded subtitle renderer before emitting external cues.
    await active.selectTrack('subtitle', undefined).catch(() => undefined)
    this.dispatchEvent(new CustomEvent('trackchange', {
      detail: { kind: 'subtitle', trackId: track.id },
    }))
    this.#updateSubtitleCues(this.element.currentTime || 0)
  }

  async #fetchSubtitle(track: ExternalSubtitleTrack): Promise<string> {
    if (!track.src) throw new TypeError(`Subtitle track ${track.id} needs src or content`)
    const transport = this.#options.http ?? this.#defaultTransport
    const response = await transport.fetch(new Request(track.src, {
      headers: track.headers,
      signal: this.#options.signal,
    }))
    if (!response.ok) throw new Error(`Unable to load subtitle ${track.id}: HTTP ${response.status}`)
    return response.text()
  }

  #externalTracks(): MediaTrack[] {
    return (this.#options.subtitles ?? []).map((track, index) => ({
      id: track.id,
      kind: 'subtitle',
      streamIndex: -(index + 1),
      codec: track.format ?? subtitleFormat(track),
      caps: 'text/plain',
      label: track.label,
      language: track.language,
      selected: track.id === this.#subtitleTrack?.id,
      default: track.default ?? false,
      forced: false,
    }))
  }

  #forwardEvents(active: BackendVideoController): void {
    const forward = <K extends keyof VideoControllerEventMap>(type: K) => {
      this.#unsubscribe.push(active.on(type, (event) => {
        if (type === 'timeupdate') {
          const detail = (event as VideoControllerEventMap['timeupdate']).detail
          this.#updateSubtitleCues(detail.currentTime)
        }
        this.dispatchEvent(new CustomEvent(type, { detail: event.detail }))
      }))
    }
    forward('timeupdate')
    forward('bufferprogress')
    forward('trackchange')
    forward('error')
  }

  #stopForwarding(): void {
    for (const unsubscribe of this.#unsubscribe.splice(0)) unsubscribe()
  }

  #updateSubtitleCues(currentTime: number): void {
    if (!this.#subtitleTrack) return
    const visible = this.#subtitleCues.filter((cue) =>
      cue.startSeconds <= currentTime && cue.endSeconds > currentTime)
    if (sameCues(visible, this.#visibleCues)) return
    this.#publishCues(visible)
  }

  #publishCues(cues: readonly SubtitleCue[]): void {
    this.#visibleCues = cues
    this.dispatchEvent(new CustomEvent('subtitlecuechange', {
      detail: { trackId: this.#subtitleTrack?.id, cues },
    }))
  }

  #publishSubtitleError(trackId: string, cause: unknown): void {
    const message = cause instanceof Error ? cause.message : String(cause)
    this.dispatchEvent(new CustomEvent('error', {
      detail: {
        code: 'subtitle_load_failed',
        message: `Unable to load subtitle ${trackId}: ${message}`,
      },
    }))
  }

  #readActive<A>(
    operation: string,
    read: (active: BackendVideoController) => A,
  ): Effect.Effect<A, VideoControllerStateError> {
    return Effect.suspend(() => {
      const active = this.#active
      return active
        ? Effect.succeed(read(active))
        : Effect.fail(this.#stateError(operation))
    })
  }

  #tryPromise<A>(
    operation: string,
    run: (active: BackendVideoController) => Promise<A>,
  ): Effect.Effect<A, VideoPlayerError> {
    return Effect.tryPromise({
      try: () => run(this.#requireActive(operation)),
      catch: (cause) => this.#normalizeOperationError(operation, cause),
    })
  }

  #trySync<A>(
    operation: string,
    run: (active: BackendVideoController) => A,
  ): Effect.Effect<A, VideoPlayerError> {
    return Effect.try({
      try: () => run(this.#requireActive(operation)),
      catch: (cause) => this.#normalizeOperationError(operation, cause),
    })
  }

  #requireActive(operation: string): BackendVideoController {
    if (this.#active) return this.#active
    if (this.#state === 'active') {
      this.#state = 'load-failed'
      this.#stateCause = 'The active backend is unavailable'
    }
    throw this.#stateError(operation)
  }

  #markLoadFailed(cause: unknown): void {
    this.#state = 'load-failed'
    this.#stateCause = errorMessage(cause)
  }

  #abortLoad(signal: AbortSignal, operation: string): VideoControllerStateError {
    this.#active = undefined
    this.#state = 'destroyed'
    this.#stateCause = errorMessage(signal.reason
      ?? new DOMException('The replacement load was aborted', 'AbortError'))
    this.#unbindAbortSignal()
    this.#stopForwarding()
    return this.#stateError(operation)
  }

  readonly #handleAbort = (): void => {
    void this.destroy().catch(() => undefined)
  }

  #bindAbortSignal(signal: AbortSignal | undefined): void {
    if (signal === this.#abortSignal) return
    this.#unbindAbortSignal()
    this.#abortSignal = signal
    if (!signal) return
    signal.addEventListener('abort', this.#handleAbort, { once: true })
    if (signal.aborted) this.#handleAbort()
  }

  #unbindAbortSignal(): void {
    this.#abortSignal?.removeEventListener('abort', this.#handleAbort)
    this.#abortSignal = undefined
  }

  #transitionFailure(
    state: Exclude<ControllerState, 'active' | 'loading'>,
    operation: string,
    cause: unknown,
  ): VideoControllerStateError {
    this.#state = state
    this.#stateCause = errorMessage(cause)
    return this.#stateError(operation)
  }

  #stateError(operation: string): VideoControllerStateError {
    const state = this.#state === 'active' ? 'load-failed' : this.#state
    const fields = {
      backend: this.#lastBackend,
      state,
      operation,
      message: `Cannot ${operation} while the video controller is ${state}`,
    }
    return this.#stateCause === undefined
      ? new VideoControllerStateError(fields)
      : new VideoControllerStateError({ ...fields, cause: this.#stateCause })
  }

  #normalizeOperationError(operation: string, cause: unknown): VideoPlayerError {
    if (cause instanceof VideoBackendUnavailableError
      || cause instanceof VideoControllerStateError
      || cause instanceof VideoFeatureUnavailableError
      || cause instanceof VideoLoadError) return cause
    return new VideoLoadError({
      backend: this.#lastBackend,
      message: `Unable to ${operation}`,
      cause: errorMessage(cause),
    })
  }
}

export async function runVideoEffectPromise<A, E>(
  program: Effect.Effect<A, E>,
): Promise<A> {
  const exit = await Effect.runPromiseExit(program)
  if (Exit.isSuccess(exit)) return exit.value
  throw failureOrCause(exit.cause)
}

export function runVideoEffectSync<A, E>(program: Effect.Effect<A, E>): A {
  const exit = Effect.runSyncExit(program)
  if (Exit.isSuccess(exit)) return exit.value
  throw failureOrCause(exit.cause)
}

function failureOrCause<E>(cause: Cause.Cause<E>): E | unknown {
  return Option.match(Cause.failureOption(cause), {
    onNone: () => Cause.squash(cause),
    onSome: (error) => error,
  })
}

function subtitleFormat(track: ExternalSubtitleTrack): 'vtt' | 'srt' {
  return track.src?.toLowerCase().split(/[?#]/, 1)[0]?.endsWith('.srt') ? 'srt' : 'vtt'
}

function sameCues(left: readonly SubtitleCue[], right: readonly SubtitleCue[]): boolean {
  return left.length === right.length && left.every((cue, index) => cue.id === right[index]?.id)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
