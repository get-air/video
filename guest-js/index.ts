import type { HttpTransport } from '@get-air/http'

export type TrackKind = 'video' | 'audio' | 'subtitle'
export type VideoFitMode = 'fit' | 'cover' | 'stretch'
export type DeviceProfile = 'auto' | 'mobile' | 'tv' | 'desktop'

export type BuiltInVideoBackend = 'mediabunny' | 'html' | 'tizen' | 'webos' | 'vizio'
export type VideoBackendId = BuiltInVideoBackend | (string & {})
export type VideoBackend = 'auto' | VideoBackendId

export interface VideoSource {
  uri: string
  headers?: Record<string, string>
  cookies?: string
  userAgent?: string
  referrer?: string
  tlsCaFile?: string
  startPositionSeconds?: number
}

/** External WebVTT or SRT track rendered by application UI. */
export interface ExternalSubtitleTrack {
  id: string
  src?: string
  content?: string
  label?: string
  language?: string
  kind?: 'subtitles' | 'captions'
  default?: boolean
  format?: 'vtt' | 'srt'
  headers?: Record<string, string>
}

export interface SubtitleCue {
  id: string
  startSeconds: number
  endSeconds: number
  text: string
}

export interface MediaTrack {
  id: string
  kind: TrackKind
  streamIndex: number
  codec: string
  caps: string
  label?: string
  language?: string
  selected: boolean
  default: boolean
  forced: boolean
  width?: number
  height?: number
  frameRate?: number
  channels?: number
  sampleRate?: number
}

export interface Chapter {
  id: string
  title?: string
  startSeconds: number
  endSeconds?: number
}

export interface MediaInfo {
  durationSeconds?: number
  seekable: boolean
  live: boolean
  container?: string
  tracks: MediaTrack[]
  chapters: Chapter[]
}

export interface SessionStats {
  sessionId: string
  encodedBytesBuffered: number
  bufferedAheadSeconds: number
  videoCodec?: string
  audioCodec?: string
  hardwareBackend?: string
  decodedFrameCopies: number
  droppedFrames: number
  averageFrameProcessingUs?: number
  visible: boolean
  playing: boolean
}

export interface PlaybackQuality {
  presentedFrames: number
  mediaTimeSeconds?: number
  measuredFps: number
  totalVideoFrames: number
  droppedVideoFrames: number
  droppedFramePercent: number
}

export interface MediabunnyPlaybackOptions {
  /** Encoded-byte cache ceiling. MediaBunny defaults to 64 MiB. */
  maxCacheBytes?: number
  /** Parallel HTTP range requests. MediaBunny defaults to two. */
  parallelism?: number
}

/**
 * Augment this interface from an adapter package to add typed options without
 * making the core package depend on that adapter.
 */
export interface VideoBackendOptionsMap {
  mediabunny: MediabunnyPlaybackOptions
}

export type VideoBackendOptions = Partial<VideoBackendOptionsMap>

export interface AttachVideoOptions {
  source: string | VideoSource
  /** One backend ID or an ordered fallback chain. MediaBunny is opt-in. */
  backend?: VideoBackend | readonly VideoBackend[]
  /** Additional ordered fallbacks after `backend`. */
  fallbackBackends?: readonly VideoBackend[]
  backendOptions?: VideoBackendOptions
  /** Per-attachment override for the client's Request-based transport. */
  http?: HttpTransport
  surfaceMode?: 'dom' | 'transparent-canvas'
  suspendWhenHidden?: boolean
  autoplay?: boolean
  deviceProfile?: DeviceProfile
  controlRegions?: VideoControlsTarget
  subtitles?: readonly ExternalSubtitleTrack[]
  signal?: AbortSignal
}

export type VideoLoadOptions = Omit<Partial<AttachVideoOptions>, 'source'>
export type CapabilitySupport = boolean | 'platform'

export interface PlayerCapabilities {
  readonly backend: VideoBackendId
  readonly containers: 'platform' | readonly string[]
  readonly codecs: 'platform' | readonly string[]
  readonly drm: CapabilitySupport
  readonly hdr: CapabilitySupport
  readonly playbackRate: boolean
  readonly volume: boolean
  readonly videoFit: boolean
  readonly videoZoom: boolean
  readonly audioTrackSelection: boolean
  readonly subtitleTrackSelection: boolean
  readonly customHeaders: boolean
  readonly frameAccurateSeeking: boolean
}

export interface VideoPluginError {
  code: string
  message: string
}

export interface VideoControllerEventMap {
  timeupdate: CustomEvent<{ currentTime: number }>
  bufferprogress: CustomEvent<{ bufferedAhead: number }>
  trackchange: CustomEvent<{ kind: TrackKind; trackId?: string }>
  error: CustomEvent<VideoPluginError>
  backendchange: CustomEvent<{
    previousBackend: VideoBackendId
    backend: VideoBackendId
  }>
  subtitlecuechange: CustomEvent<{
    trackId?: string
    cues: readonly SubtitleCue[]
  }>
}

export interface VideoController extends EventTarget {
  readonly element: HTMLVideoElement
  readonly sessionId: string
  readonly capabilities: PlayerCapabilities
  readonly media: MediaInfo
  readonly tracks: readonly MediaTrack[]
  load(source: string | VideoSource, options?: VideoLoadOptions): Promise<void>
  play(): Promise<void>
  pause(): void
  seek(positionSeconds: number): Promise<void>
  selectTrack(kind: TrackKind, trackId?: string): Promise<void>
  setVolume(volume: number): Promise<void>
  setVideoFit(mode: VideoFitMode): Promise<void>
  setVideoZoom(scale: number): Promise<void>
  stats(): Promise<SessionStats>
  bufferedAhead(): number
  playbackQuality(): PlaybackQuality
  refreshLayout(): void
  registerControls(target: VideoControlsTarget): () => void
  destroy(): Promise<void>
  on<K extends keyof VideoControllerEventMap>(
    type: K,
    listener: (event: VideoControllerEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): () => void
}

/** @internal Backend contract before the stable switching controller is applied. */
export type BackendVideoController = Omit<VideoController, 'load'>

export interface VideoRuntimeContext {
  readonly userAgent: string
  readonly global: typeof globalThis
}

export interface VideoBackendOpenContext {
  readonly element: HTMLVideoElement
  readonly options: AttachVideoOptions
  readonly http: HttpTransport
}

/** Explicit extension seam used by platform packages such as `@get-air/video-tauri`. */
export interface VideoBackendAdapter {
  readonly id: VideoBackendId
  /** Higher values are attempted first for `backend: 'auto'`. Omit for explicit-only adapters. */
  readonly autoPriority?: number
  isAvailable(context: VideoRuntimeContext): boolean | Promise<boolean>
  open(context: VideoBackendOpenContext): Promise<BackendVideoController>
}

export interface VideoClientOptions {
  readonly adapters?: readonly VideoBackendAdapter[]
  readonly http?: HttpTransport
}

export interface VideoClient {
  attach(element: HTMLVideoElement, options: AttachVideoOptions): Promise<VideoController>
}

/** Create an isolated client with explicit platform adapters and transport. */
export function createVideoClient(options: VideoClientOptions = {}): VideoClient {
  const adapters = [...(options.adapters ?? [])]
  return {
    async attach(element, attachOptions) {
      assertVideoElement(element)
      const { runAttachVideo } = await import('./effect')
      return runAttachVideo(element, attachOptions, {
        adapters,
        http: options.http,
      })
    },
  }
}

const defaultVideoClient = createVideoClient()

/** DOM-first convenience API using only the built-in browser/TV backends. */
export function attachVideo(
  element: HTMLVideoElement,
  options: AttachVideoOptions,
): Promise<VideoController> {
  return defaultVideoClient.attach(element, options)
}

export const VIDEO_CONTROLS_ATTRIBUTE = 'data-air-video-controls'
export type VideoControlsTarget = Element | Iterable<Element>

interface ControlRegistration {
  count: number
  previousValue: string | null
}

const controlRegistrations = new WeakMap<Element, ControlRegistration>()

/** Mark arbitrary DOM as UI belonging to a player. */
export function registerVideoControls(target: VideoControlsTarget): () => void {
  const elements = target instanceof Element ? [target] : [...target]
  for (const element of elements) {
    const existing = controlRegistrations.get(element)
    if (existing) {
      existing.count += 1
      continue
    }
    controlRegistrations.set(element, {
      count: 1,
      previousValue: element.getAttribute(VIDEO_CONTROLS_ATTRIBUTE),
    })
    element.setAttribute(VIDEO_CONTROLS_ATTRIBUTE, '')
  }
  let active = true
  return () => {
    if (!active) return
    active = false
    for (const element of elements) {
      const existing = controlRegistrations.get(element)
      if (!existing) continue
      existing.count -= 1
      if (existing.count > 0) continue
      controlRegistrations.delete(element)
      if (existing.previousValue === null) element.removeAttribute(VIDEO_CONTROLS_ATTRIBUTE)
      else element.setAttribute(VIDEO_CONTROLS_ATTRIBUTE, existing.previousValue)
    }
  }
}

export function bufferedAhead(ranges: TimeRanges, currentTime: number): number {
  for (let index = 0; index < ranges.length; index += 1) {
    if (ranges.start(index) <= currentTime + 0.5 && ranges.end(index) >= currentTime) {
      return Math.max(0, ranges.end(index) - currentTime)
    }
  }
  return 0
}

function assertVideoElement(element: HTMLVideoElement): void {
  if (!(element instanceof HTMLVideoElement)) {
    throw new TypeError('attachVideo requires an HTMLVideoElement')
  }
}
