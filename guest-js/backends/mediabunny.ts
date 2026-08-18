import type { HttpTransport } from '@get-air/http'
import {
  ALL_FORMATS,
  AudioBufferSink,
  CanvasSink,
  Input,
  UrlSource,
  type InputAudioTrack,
  type InputTrack,
  type InputVideoTrack,
  type WrappedAudioBuffer,
  type WrappedCanvas,
} from 'mediabunny'

import { VideoBackendUnavailableError, VideoFeatureUnavailableError } from '../errors'
import type {
  AttachVideoOptions,
  BackendVideoController,
  MediaInfo,
  MediaTrack,
  PlaybackQuality,
  PlayerCapabilities,
  SessionStats,
  TrackKind,
  VideoControllerEventMap,
  VideoControlsTarget,
  VideoFitMode,
  VideoSource,
} from '../index'

let mediabunnySessionSequence = 0

/**
 * Conservatively verify that every advertised audio/video track is decodable.
 * `undefined` means the container could not be inspected and must not be
 * treated as proof of incompatibility.
 */
export async function probeMediabunnyTrackDecodability(
  sourceValue: string | VideoSource,
  transport: HttpTransport,
  signal?: AbortSignal,
): Promise<boolean | undefined> {
  const source = normalizeSource(sourceValue)
  if (source.cookies || source.userAgent || source.tlsCaFile) return undefined
  const input = new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(source.uri, {
      fetchFn: (request, init) => {
        const mediaRequest = new Request(request, init)
        return transport.fetch(signal ? new Request(mediaRequest, { signal }) : mediaRequest)
      },
      requestInit: {
        headers: new Headers(source.headers),
        credentials: 'same-origin',
        referrer: source.referrer,
      },
      maxCacheSize: 8 * 1024 * 1024,
      parallelism: 1,
    }),
  })
  try {
    if (!await input.canRead()) return undefined
    const [videoTracks, audioTracks] = await Promise.all([
      input.getVideoTracks(),
      input.getAudioTracks(),
    ])
    const [videoSupport, audioSupport] = await Promise.all([
      Promise.all(videoTracks.map((track) => track.canDecode())),
      Promise.all(audioTracks.map((track) => track.canDecode())),
    ])
    // HTML media elements cannot portably switch embedded audio/video tracks.
    // Require every advertised track to decode before accepting the HTML route;
    // otherwise an unsupported default (for example TrueHD) can produce silent
    // playback even when a decodable AC-3 alternate exists.
    return allTracksDecodable(videoSupport, audioSupport)
  } catch {
    return undefined
  } finally {
    input.dispose()
  }
}

export function allTracksDecodable(
  videoSupport: readonly boolean[],
  audioSupport: readonly boolean[],
): boolean {
  return videoSupport.every(Boolean) && audioSupport.every(Boolean)
}

export async function attachMediabunnyVideo(
  element: HTMLVideoElement,
  options: AttachVideoOptions,
  transport: HttpTransport,
): Promise<BackendVideoController> {
  if (typeof VideoDecoder === 'undefined' && typeof AudioDecoder === 'undefined') {
    throw new VideoBackendUnavailableError({
      backend: 'mediabunny',
      message: 'MediaBunny playback requires the WebCodecs API',
    })
  }
  const controller = new MediabunnyVideoController(element, options, transport)
  try {
    await controller.start()
    return controller
  } catch (error) {
    await controller.destroy().catch(() => undefined)
    throw error
  }
}

class MediabunnyVideoController extends EventTarget implements BackendVideoController {
  readonly element: HTMLVideoElement
  readonly sessionId = `mediabunny-${Date.now()}-${++mediabunnySessionSequence}`
  readonly capabilities: PlayerCapabilities = {
    backend: 'mediabunny',
    containers: ['mp4', 'mov', 'webm', 'mkv', 'hls', 'mpeg-ts', 'ogg', 'mp3', 'flac', 'wav', 'adts'],
    codecs: 'platform',
    drm: false,
    hdr: 'platform',
    playbackRate: false,
    volume: true,
    videoFit: true,
    videoZoom: true,
    audioTrackSelection: true,
    subtitleTrackSelection: false,
    customHeaders: true,
    frameAccurateSeeking: true,
  }

  readonly #options: AttachVideoOptions
  readonly #transport: HttpTransport
  readonly #media: MediaInfo = { seekable: true, live: false, tracks: [], chapters: [] }
  readonly #trackById = new Map<string, InputTrack>()
  #canvas = document.createElement('canvas')
  readonly #original: {
    visibility: string
  }
  #resizeObserver?: ResizeObserver
  #input?: Input<UrlSource>
  #videoTrack?: InputVideoTrack
  #audioTrack?: InputAudioTrack
  #videoSink?: CanvasSink
  #audioSink?: AudioBufferSink
  #audioContext?: AudioContext
  #videoIterator?: AsyncGenerator<WrappedCanvas, void, unknown>
  #audioIterator?: AsyncGenerator<WrappedAudioBuffer, void, unknown>
  #currentFrame?: WrappedCanvas
  #nextFrame?: WrappedCanvas
  #animationFrame?: number
  #playing = false
  #destroyed = false
  #seeking = false
  #generation = 0
  #playbackTimeAtStart = 0
  #clockTimeAtStart = 0
  #volume = 1
  #queuedAudioNodes = new Map<AudioBufferSourceNode, GainNode>()
  #presentedFrames = 0
  #droppedFrames = 0
  #decodedFrameCopies = 0
  #renderStartedAt = 0
  readonly #handleAbort = (): void => { void this.destroy().catch(() => undefined) }

  constructor(element: HTMLVideoElement, options: AttachVideoOptions, transport: HttpTransport) {
    super()
    this.element = element
    this.#options = options
    this.#transport = transport
    this.#original = {
      visibility: element.style.visibility,
    }
  }

  get media(): MediaInfo { return this.#media }
  get tracks(): readonly MediaTrack[] { return this.#media.tracks }

  async start(): Promise<void> {
    if (this.#options.signal?.aborted) throw this.#options.signal.reason
    const source = normalizeSource(this.#options.source)
    if (source.cookies || source.userAgent || source.tlsCaFile) {
      throw new VideoFeatureUnavailableError({
        backend: 'mediabunny',
        feature: 'nativeRequestProperties',
        message: 'Browser MediaBunny cannot set explicit cookies, User-Agent, or a native TLS CA file',
      })
    }
    const headers = new Headers(source.headers)
    const fetchFn: typeof fetch = async (input, init) => {
      return this.#transport.fetch(new Request(input, init))
    }
    this.#input = new Input({
      formats: ALL_FORMATS,
      source: new UrlSource(source.uri, {
        fetchFn,
        requestInit: {
          headers,
          credentials: 'same-origin',
          referrer: source.referrer,
        },
        maxCacheSize: this.#options.backendOptions?.mediabunny?.maxCacheBytes,
        parallelism: this.#options.backendOptions?.mediabunny?.parallelism,
      }),
    })
    if (!await this.#input.canRead()) throw new Error('MediaBunny could not recognize this media source')

    const format = await this.#input.getFormat()
    const inputTracks = await this.#input.getTracks()
    const mediaTracks = await Promise.all(inputTracks.map((track) => this.#describeTrack(track)))
    this.#media.tracks = mediaTracks
    for (let index = 0; index < inputTracks.length; index += 1) {
      this.#trackById.set(mediaTracks[index].id, inputTracks[index])
    }
    const videoTracks = await this.#input.getVideoTracks()
    const audioTracks = await this.#input.getAudioTracks()
    this.#videoTrack = await this.#firstDecodable(videoTracks)
    this.#audioTrack = await this.#firstDecodable(audioTracks)
    assertPlayableTracks(
      videoTracks.length > 0,
      audioTracks.length > 0,
      Boolean(this.#videoTrack),
      Boolean(this.#audioTrack),
    )
    this.#selectMediaTracks()
    const primaryTrack = this.#videoTrack ?? this.#audioTrack
    this.#media.live = primaryTrack ? await primaryTrack.isLive() : false
    const metadataDuration = await this.#input.getDurationFromMetadata(
      undefined,
      { skipLiveWait: true },
    )
    this.#media.durationSeconds = metadataDuration
      ?? (this.#media.live ? undefined : await this.#input.computeDuration(undefined, { skipLiveWait: true }))
    this.#media.seekable = !this.#media.live
    this.#media.container = format.name

    this.#installCanvas()
    await this.#configureSinks(source.startPositionSeconds ?? 0)
    this.#options.signal?.addEventListener('abort', this.#handleAbort, { once: true })
    this.element.dispatchEvent(new Event('loadedmetadata'))
    this.element.dispatchEvent(new Event('durationchange'))
    this.element.dispatchEvent(new Event('canplay'))
    if (this.#options.autoplay) await this.play()
  }

  async play(): Promise<void> {
    if (this.#destroyed || this.#playing) return
    if (this.#audioTrack) {
      this.#audioContext ??= new AudioContext()
      await this.#audioContext.resume()
    }
    this.#generation += 1
    this.#clockTimeAtStart = this.#clockNow()
    this.#playing = true
    await this.#configureSinks(this.#playbackTimeAtStart)
    const generation = this.#generation
    void this.#runAudio(generation).catch((cause) => {
      this.#failDetachedPlayback('audio-render', cause, generation)
    })
    this.#scheduleRender(generation)
    this.element.dispatchEvent(new Event('play'))
    this.element.dispatchEvent(new Event('playing'))
  }

  pause(): void {
    if (!this.#playing) return
    this.#playbackTimeAtStart = this.#playbackTime()
    this.#playing = false
    this.#generation += 1
    void this.#stopIterators()
    this.#stopAudioNodes()
    if (this.#animationFrame !== undefined) cancelAnimationFrame(this.#animationFrame)
    this.#animationFrame = undefined
    this.element.dispatchEvent(new Event('pause'))
  }

  async seek(positionSeconds: number): Promise<void> {
    const duration = this.#media.durationSeconds
    const target = Math.max(0, duration === undefined ? positionSeconds : Math.min(positionSeconds, duration))
    const resume = this.#playing
    this.pause()
    this.#seeking = true
    this.#playbackTimeAtStart = target
    await this.#configureSinks(target)
    this.#seeking = false
    this.#emitTime()
    if (resume) await this.play()
  }

  async selectTrack(kind: TrackKind, trackId?: string): Promise<void> {
    if (kind === 'subtitle') {
      throw new VideoFeatureUnavailableError({
        backend: 'mediabunny',
        feature: 'subtitleTrackSelection',
        message: 'MediaBunny currently demuxes subtitle metadata but does not expose an input subtitle sink',
      })
    }
    const track = trackId ? this.#trackById.get(trackId) : undefined
    if (trackId && (!track || track.type !== kind)) throw new Error(`Unknown ${kind} track: ${trackId}`)
    const resume = this.#playing
    this.pause()
    if (kind === 'video') this.#videoTrack = track?.isVideoTrack() ? track : undefined
    if (kind === 'audio') this.#audioTrack = track?.isAudioTrack() ? track : undefined
    this.#selectMediaTracks()
    await this.#configureSinks(this.#playbackTimeAtStart)
    this.dispatchEvent(new CustomEvent('trackchange', { detail: { kind, trackId } }))
    if (resume) await this.play()
  }

  async setVolume(volume: number): Promise<void> {
    this.#volume = Math.min(1, Math.max(0, volume))
    for (const gain of this.#queuedAudioNodes.values()) gain.gain.value = this.#volume
  }

  async setPlaybackRate(_rate: number): Promise<void> {
    throw new VideoFeatureUnavailableError({
      backend: 'mediabunny',
      feature: 'playbackRate',
      message: 'MediaBunny playback-rate changes are not implemented by this scheduler',
    })
  }

  async setVideoFit(mode: VideoFitMode): Promise<void> {
    this.#canvas.style.objectFit = mode === 'fit' ? 'contain' : mode === 'cover' ? 'cover' : 'fill'
  }

  async setVideoZoom(scale: number): Promise<void> {
    this.#canvas.style.transform = `scale(${Math.max(0.01, scale)})`
  }

  async stats(): Promise<SessionStats> {
    return {
      sessionId: this.sessionId,
      encodedBytesBuffered: 0,
      bufferedAheadSeconds: this.bufferedAhead(),
      videoCodec: this.tracks.find((track) => track.kind === 'video' && track.selected)?.codec,
      audioCodec: this.tracks.find((track) => track.kind === 'audio' && track.selected)?.codec,
      hardwareBackend: 'WebCodecs',
      decodedFrameCopies: this.#decodedFrameCopies,
      droppedFrames: this.#droppedFrames,
      visible: !this.element.hidden,
      playing: this.#playing,
    }
  }

  bufferedAhead(): number {
    return Math.max(0, (this.#nextFrame?.timestamp ?? this.#playbackTime()) - this.#playbackTime())
  }

  playbackQuality(): PlaybackQuality {
    const elapsed = this.#renderStartedAt === 0 ? 0 : (performance.now() - this.#renderStartedAt) / 1000
    const total = this.#presentedFrames + this.#droppedFrames
    return {
      presentedFrames: this.#presentedFrames,
      mediaTimeSeconds: this.#playbackTime(),
      measuredFps: elapsed > 0 ? this.#presentedFrames / elapsed : 0,
      totalVideoFrames: total,
      droppedVideoFrames: this.#droppedFrames,
      droppedFramePercent: total === 0 ? 0 : this.#droppedFrames / total * 100,
    }
  }

  refreshLayout(): void {
    const bounds = this.element.getBoundingClientRect()
    this.#canvas.style.left = `${bounds.left}px`
    this.#canvas.style.top = `${bounds.top}px`
    this.#canvas.style.width = `${bounds.width}px`
    this.#canvas.style.height = `${bounds.height}px`
  }
  registerControls(_target: VideoControlsTarget): () => void { return () => undefined }

  async destroy(): Promise<void> {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#options.signal?.removeEventListener('abort', this.#handleAbort)
    this.pause()
    await this.#stopIterators()
    this.#stopAudioNodes()
    await this.#audioContext?.close().catch(() => undefined)
    this.#input?.dispose()
    this.#resizeObserver?.disconnect()
    window.removeEventListener('resize', this.#refreshViewport)
    window.removeEventListener('scroll', this.#refreshViewport, true)
    this.#canvas.remove()
    this.element.style.visibility = this.#original.visibility
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

  async #describeTrack(track: InputTrack): Promise<MediaTrack> {
    const [codec, language, name, disposition] = await Promise.all([
      track.getCodecParameterString(),
      track.getLanguageCode(),
      track.getName(),
      track.getDisposition(),
    ])
    const common: MediaTrack = {
      id: `${track.type}-${track.id}`,
      kind: track.type,
      streamIndex: track.number - 1,
      codec: codec ?? String(await track.getInternalCodecId() ?? ''),
      caps: '',
      label: name ?? undefined,
      language,
      selected: false,
      default: disposition.default,
      forced: disposition.forced,
    }
    if (track.isVideoTrack()) {
      const [width, height, frameRate] = await Promise.all([
        track.getDisplayWidth(),
        track.getDisplayHeight(),
        track.computeFrameRateMetrics().then((metrics) => metrics.averageFrameRate).catch(() => undefined),
      ])
      return { ...common, width, height, frameRate }
    }
    if (track.isAudioTrack()) {
      const [channels, sampleRate] = await Promise.all([
        track.getNumberOfChannels(),
        track.getSampleRate(),
      ])
      return { ...common, channels, sampleRate }
    }
    return common
  }

  async #firstDecodable<T extends InputVideoTrack | InputAudioTrack>(tracks: T[]): Promise<T | undefined> {
    for (const track of tracks) if (await track.canDecode()) return track
    return undefined
  }

  #selectMediaTracks(): void {
    const selectedVideoId = this.#videoTrack && `video-${this.#videoTrack.id}`
    const selectedAudioId = this.#audioTrack && `audio-${this.#audioTrack.id}`
    this.#media.tracks = this.#media.tracks.map((track) => ({
      ...track,
      selected: track.id === selectedVideoId || track.id === selectedAudioId,
    }))
  }

  #installCanvas(): void {
    const parent = this.element.parentElement
    if (!parent) throw new Error('MediaBunny playback requires the video element to have a parent')
    this.element.style.visibility = 'hidden'
    Object.assign(this.#canvas.style, {
      position: 'fixed',
      objectFit: 'contain',
      pointerEvents: 'none',
      transformOrigin: 'center center',
    })
    parent.insertBefore(this.#canvas, this.element.nextSibling)
    this.refreshLayout()
    this.#resizeObserver = new ResizeObserver(this.#refreshViewport)
    this.#resizeObserver.observe(this.element)
    window.addEventListener('resize', this.#refreshViewport)
    window.addEventListener('scroll', this.#refreshViewport, true)
  }

  readonly #refreshViewport = () => this.refreshLayout()

  async #configureSinks(position: number): Promise<void> {
    await this.#stopIterators()
    this.#videoSink = this.#videoTrack ? new CanvasSink(this.#videoTrack, { poolSize: 3 }) : undefined
    this.#audioSink = this.#audioTrack ? new AudioBufferSink(this.#audioTrack) : undefined
    if (this.#videoTrack && this.#videoSink) {
      this.#canvas.width = await this.#videoTrack.getDisplayWidth()
      this.#canvas.height = await this.#videoTrack.getDisplayHeight()
      this.#currentFrame = await this.#videoSink.getCanvas(position) ?? undefined
      if (this.#currentFrame) this.#draw(this.#currentFrame)
      const nextTimestamp = this.#currentFrame
        ? this.#currentFrame.timestamp + this.#currentFrame.duration
        : position
      this.#videoIterator = this.#videoSink.canvases(nextTimestamp)
      this.#nextFrame = (await this.#videoIterator.next()).value || undefined
    }
    this.#audioIterator = this.#audioSink?.buffers(position)
  }

  async #render(generation: number): Promise<void> {
    if (!this.#playing || this.#destroyed || generation !== this.#generation || this.#seeking) return
    const playbackTime = this.#playbackTime()
    const duration = this.#media.durationSeconds
    if (duration !== undefined && playbackTime >= duration) {
      this.#playbackTimeAtStart = duration
      this.pause()
      this.element.dispatchEvent(new Event('ended'))
      return
    }
    let advanced = 0
    while (this.#nextFrame && this.#nextFrame.timestamp <= playbackTime && generation === this.#generation) {
      this.#currentFrame = this.#nextFrame
      this.#nextFrame = (await this.#videoIterator?.next())?.value || undefined
      advanced += 1
    }
    if (advanced > 0 && this.#currentFrame) {
      if (advanced > 1) this.#droppedFrames += advanced - 1
      this.#draw(this.#currentFrame)
    }
    this.#emitTime()
    this.#scheduleRender(generation)
  }

  #scheduleRender(generation: number): void {
    this.#animationFrame = requestAnimationFrame(() => {
      void this.#render(generation).catch((cause) => {
        this.#failDetachedPlayback('video-render', cause, generation)
      })
    })
  }

  #failDetachedPlayback(
    stage: 'audio-render' | 'video-render',
    cause: unknown,
    generation: number,
  ): void {
    if (this.#destroyed || generation !== this.#generation) return
    this.#playbackTimeAtStart = this.#playbackTime()
    this.#playing = false
    this.#generation += 1
    void this.#stopIterators()
    this.#stopAudioNodes()
    if (this.#animationFrame !== undefined) cancelAnimationFrame(this.#animationFrame)
    this.#animationFrame = undefined
    this.element.dispatchEvent(new Event('pause'))
    const message = cause instanceof Error ? cause.message : String(cause)
    this.dispatchEvent(new CustomEvent('error', {
      detail: {
        code: `mediabunny-${stage}`,
        message: `MediaBunny ${stage} failed: ${message}`,
      },
    }))
  }

  async #runAudio(generation: number): Promise<void> {
    const iterator = this.#audioIterator
    const context = this.#audioContext
    if (!iterator || !context) return
    for await (const { buffer, timestamp } of iterator) {
      if (!this.#playing || generation !== this.#generation) break
      const node = context.createBufferSource()
      const gain = context.createGain()
      gain.gain.value = this.#volume
      node.buffer = buffer
      node.connect(gain).connect(context.destination)
      const startTimestamp = this.#clockTimeAtStart + timestamp - this.#playbackTimeAtStart
      if (startTimestamp >= context.currentTime) node.start(startTimestamp)
      else {
        const offset = context.currentTime - startTimestamp
        if (offset >= buffer.duration) continue
        node.start(context.currentTime, offset)
      }
      this.#queuedAudioNodes.set(node, gain)
      node.onended = () => this.#queuedAudioNodes.delete(node)
      while (timestamp - this.#playbackTime() >= 1 && generation === this.#generation) {
        await new Promise<void>((resolve) => setTimeout(resolve, 50))
      }
    }
  }

  #draw(frame: WrappedCanvas): void {
    if (frame.canvas instanceof HTMLCanvasElement && frame.canvas !== this.#canvas) {
      frame.canvas.style.cssText = this.#canvas.style.cssText
      this.#canvas.replaceWith(frame.canvas)
      this.#canvas = frame.canvas
    } else if (typeof OffscreenCanvas !== 'undefined' && frame.canvas instanceof OffscreenCanvas) {
      const context = this.#canvas.getContext('2d')
      if (!context) throw new Error('A 2D canvas context is required for MediaBunny playback')
      context.drawImage(frame.canvas, 0, 0, this.#canvas.width, this.#canvas.height)
      this.#decodedFrameCopies += 1
    }
    this.#presentedFrames += 1
    if (this.#renderStartedAt === 0) this.#renderStartedAt = performance.now()
  }

  #playbackTime(): number {
    return this.#playing
      ? this.#clockNow() - this.#clockTimeAtStart + this.#playbackTimeAtStart
      : this.#playbackTimeAtStart
  }

  #clockNow(): number { return this.#audioContext?.currentTime ?? performance.now() / 1000 }

  #emitTime(): void {
    this.dispatchEvent(new CustomEvent('timeupdate', {
      detail: { currentTime: this.#playbackTime() },
    }))
  }

  async #stopIterators(): Promise<void> {
    const videoIterator = this.#videoIterator
    const audioIterator = this.#audioIterator
    this.#videoIterator = undefined
    this.#audioIterator = undefined
    try { await videoIterator?.return(undefined) } catch { /* decoder iterator already failed */ }
    try { await audioIterator?.return(undefined) } catch { /* decoder iterator already failed */ }
  }

  #stopAudioNodes(): void {
    for (const node of this.#queuedAudioNodes.keys()) {
      try { node.stop() } catch { /* already stopped */ }
    }
    this.#queuedAudioNodes.clear()
  }
}

function normalizeSource(source: string | VideoSource): VideoSource {
  return typeof source === 'string' ? { uri: source } : source
}

/** @internal Guards fallback semantics before a MediaBunny session is accepted. */
export function assertPlayableTracks(
  hasVideoTracks: boolean,
  hasAudioTracks: boolean,
  hasDecodableVideo: boolean,
  hasDecodableAudio: boolean,
): void {
  if (hasVideoTracks && !hasDecodableVideo) {
    throw new VideoBackendUnavailableError({
      backend: 'mediabunny',
      message: 'This source contains video, but no video track can be decoded by WebCodecs',
    })
  }
  if (hasAudioTracks && !hasDecodableAudio) {
    throw new VideoBackendUnavailableError({
      backend: 'mediabunny',
      message: 'This source contains audio, but no audio track can be decoded by WebCodecs',
    })
  }
  if (!hasDecodableVideo && !hasDecodableAudio) {
    throw new VideoBackendUnavailableError({
      backend: 'mediabunny',
      message: 'No audio or video track in this source can be decoded by WebCodecs',
    })
  }
}
