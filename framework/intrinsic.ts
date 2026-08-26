import {
  getActiveRenderer,
  registerIntrinsic,
  type IntrinsicAdapter,
  type IntrinsicContext,
  type SemanticsNode,
} from '@get-air/framework'
import type {} from '@get-air/framework/jsx-runtime'

import { attachCanvasVideo, type CanvasVideoController } from '../canvas/index'
import {
  createVideoClient,
  type DeviceProfile,
  type ExternalSubtitleTrack,
  type MediaTrack,
  type VideoBackend,
  type VideoClient,
  type VideoFitMode,
  type VideoSource,
} from '../guest-js/index'
import { frameworkVideoHole } from './geometry'
import { ensureFrameworkVideoShader } from './shader'

export interface FrameworkVideoElementProps {
  readonly [name: string]: unknown
  readonly id?: string
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
  readonly alpha?: number
  readonly visible?: boolean
  readonly zIndex?: number
  readonly src?: string
  readonly source?: string | VideoSource
  readonly backend?: VideoBackend | readonly VideoBackend[]
  readonly fallbackBackends?: readonly VideoBackend[]
  readonly autoplay?: boolean
  readonly controls?: boolean
  readonly muted?: boolean
  readonly volume?: number
  readonly fit?: VideoFitMode
  readonly loop?: boolean
  readonly poster?: string
  readonly preload?: 'none' | 'metadata' | 'auto'
  readonly playsinline?: boolean
  readonly deviceProfile?: DeviceProfile
  readonly subtitles?: readonly ExternalSubtitleTrack[]
  readonly appWidth?: number
  readonly appHeight?: number
  readonly radius?: number
  readonly ariaLabel?: string
  readonly 'aria-label'?: string
  /** Receives the platform-neutral controller represented by this tag. */
  readonly controllerRef?: (controller: FrameworkVideoElementController) => void
  readonly onReady?: (controller: FrameworkVideoElementController) => void
  readonly onError?: (error: unknown) => void
  readonly onPlay?: () => void
  readonly onPause?: () => void
  readonly onEnded?: () => void
  readonly onTimeUpdate?: (currentTime: number) => void
  readonly onStateChange?: (state: FrameworkMediaState) => void
}

export interface FrameworkMediaState {
  readonly playing: boolean
  readonly currentTime: number
  readonly duration: number
  readonly volume: number
  readonly muted: boolean
  readonly fullscreen: boolean
  readonly pictureInPicture: boolean
  readonly captionsTrackId?: string
  readonly audioTrackId?: string
}

export interface FrameworkVideoElementController {
  /** Advanced access to the common Air playback controller after readiness. */
  playback(): CanvasVideoController | undefined
  snapshot(): FrameworkMediaState
  subscribe(listener: (state: FrameworkMediaState) => void): () => void
  play(): void
  pause(): void
  seek(time: number): void
  setVolume(volume: number): void
  setMuted(muted: boolean): void
  setFullscreen(fullscreen: boolean): void
  setPictureInPicture(pictureInPicture: boolean): void
  selectCaptions(trackId: string | undefined): void
  selectAudioTrack(trackId: string | undefined): void
}

export interface FrameworkVideoDriver {
  readonly client: VideoClient
  readonly backend: VideoBackend | readonly VideoBackend[]
}

const browserDriver: FrameworkVideoDriver = {
  client: createVideoClient(),
  backend: 'html',
}
let activeDriver = browserDriver
const driverInstallations: Array<{
  readonly driver: FrameworkVideoDriver
  active: boolean
}> = []

/** Install a platform driver, returning deterministic restoration cleanup. */
export function installFrameworkVideoDriver(
  driver: FrameworkVideoDriver,
): () => void {
  const installation = { driver, active: true }
  driverInstallations.push(installation)
  activeDriver = driver
  return () => {
    if (!installation.active) return
    installation.active = false
    while (driverInstallations.at(-1)?.active === false) {
      driverInstallations.pop()
    }
    activeDriver = driverInstallations.at(-1)?.driver ?? browserDriver
  }
}

interface MutableVideoProps {
  id?: string
  x: number
  y: number
  width: number
  height: number
  alpha?: number
  visible?: boolean
  zIndex?: number
  src?: string
  source?: string | VideoSource
  backend?: VideoBackend | readonly VideoBackend[]
  fallbackBackends?: readonly VideoBackend[]
  autoplay?: boolean
  controls?: boolean
  muted?: boolean
  volume?: number
  fit?: VideoFitMode
  loop?: boolean
  poster?: string
  preload?: 'none' | 'metadata' | 'auto'
  playsinline?: boolean
  deviceProfile?: DeviceProfile
  subtitles?: readonly ExternalSubtitleTrack[]
  appWidth?: number
  appHeight?: number
  radius?: number
  ariaLabel?: string
  controllerRef?: (controller: FrameworkVideoElementController) => void
  onReady?: (controller: FrameworkVideoElementController) => void
  onError?: (error: unknown) => void
  onPlay?: () => void
  onPause?: () => void
  onEnded?: () => void
  onTimeUpdate?: (currentTime: number) => void
  onStateChange?: (state: FrameworkMediaState) => void
}

let videoElementSequence = 0

class VideoIntrinsicInstance implements FrameworkVideoElementController {
  readonly visualNode: object
  readonly intrinsicId = `air-video-${++videoElementSequence}`
  readonly props: MutableVideoProps = { x: 0, y: 0, width: 0, height: 0 }
  readonly listeners = new Set<(state: FrameworkMediaState) => void>()
  readonly cleanup: Array<() => void> = []
  controller: CanvasVideoController | undefined
  driver: FrameworkVideoDriver | undefined
  operation = Promise.resolve()
  revision = 0
  inserted = false
  disposed = false
  state: FrameworkMediaState = {
    playing: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    muted: false,
    fullscreen: false,
    pictureInPicture: false,
  }

  constructor(context: IntrinsicContext) {
    this.visualNode = context.host.createElement('view')
  }

  snapshot(): FrameworkMediaState {
    return this.state
  }

  playback(): CanvasVideoController | undefined {
    return this.controller
  }

  subscribe(listener: (state: FrameworkMediaState) => void): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  play(): void {
    const controller = this.controller
    if (controller == null) return
    void controller.play().catch((error: unknown) => this.report(error))
  }

  pause(): void {
    this.controller?.pause()
  }

  seek(time: number): void {
    const controller = this.controller
    if (controller == null) return
    void controller.seek(time).catch((error: unknown) => this.report(error))
  }

  setVolume(volume: number): void {
    const next = Math.min(1, Math.max(0, volume))
    this.props.volume = next
    const controller = this.controller
    if (controller == null) return
    void controller
      .setVolume(this.props.muted === true ? 0 : next)
      .catch((error: unknown) => this.report(error))
  }

  setMuted(muted: boolean): void {
    this.props.muted = muted
    if (this.controller != null) {
      this.controller.element.muted = muted
      void this.controller
        .setVolume(muted ? 0 : (this.props.volume ?? 1))
        .catch((error: unknown) => this.report(error))
    }
  }

  setFullscreen(fullscreen: boolean): void {
    const element = this.controller?.element
    if (element == null) return
    const action = fullscreen
      ? element.requestFullscreen?.()
      : document.exitFullscreen?.()
    void action?.catch((error: unknown) => this.report(error))
  }

  setPictureInPicture(pictureInPicture: boolean): void {
    const element = this.controller?.element
    if (element == null) return
    const target = pictureInPicture ? element : document
    const method = Reflect.get(
      target,
      pictureInPicture ? 'requestPictureInPicture' : 'exitPictureInPicture',
    )
    if (typeof method !== 'function') return
    const action = Reflect.apply(method, target, [])
    void Promise.resolve(action).catch((error: unknown) => this.report(error))
  }

  selectCaptions(trackId: string | undefined): void {
    const controller = this.controller
    if (controller == null) return
    void controller
      .selectTrack('subtitle', trackId)
      .catch((error: unknown) => this.report(error))
  }

  selectAudioTrack(trackId: string | undefined): void {
    const controller = this.controller
    if (controller == null) return
    void controller
      .selectTrack('audio', trackId)
      .catch((error: unknown) => this.report(error))
  }

  report(error: unknown): void {
    this.props.onError?.(error)
  }

  syncState(): void {
    const controller = this.controller
    if (controller == null) return
    const element = controller.element
    const next: FrameworkMediaState = {
      playing: !element.paused,
      currentTime: finite(element.currentTime),
      duration: finite(controller.media.durationSeconds ?? element.duration),
      volume: finite(element.volume, 1),
      muted: element.muted,
      fullscreen: document.fullscreenElement === element,
      pictureInPicture:
        'pictureInPictureElement' in document &&
        document.pictureInPictureElement === element,
      captionsTrackId: selectedTrack(controller.tracks, 'subtitle'),
      audioTrackId: selectedTrack(controller.tracks, 'audio'),
    }
    if (sameState(this.state, next)) return
    this.state = next
    this.props.onStateChange?.(next)
    for (const listener of this.listeners) listener(next)
  }
}

const visualProperties = new Set([
  'x',
  'y',
  'width',
  'height',
  'alpha',
  'visible',
  'zIndex',
])

const reloadProperties = new Set([
  'src',
  'source',
  'backend',
  'fallbackBackends',
  'deviceProfile',
  'subtitles',
])

const videoIntrinsic: IntrinsicAdapter<VideoIntrinsicInstance> = {
  create: (context) => new VideoIntrinsicInstance(context),
  update: (instance, name, value, context) => {
    if (name === 'children') return
    if (name === 'aria-label') {
      instance.props.ariaLabel = typeof value === 'string' ? value : undefined
      return
    }
    if (name === 'controllerRef') {
      if (typeof value === 'function') {
        const controllerRef = (controller: FrameworkVideoElementController) => {
          Reflect.apply(value, undefined, [controller])
        }
        instance.props.controllerRef = controllerRef
        controllerRef(instance)
      }
      return
    }
    setVideoProperty(instance.props, name, value)
    if (visualProperties.has(name)) {
      context.host.setProperty(instance.visualNode, name, value)
      refreshHolePunch(instance, context)
      instance.controller?.updateLayout()
    }
    if (!instance.inserted) return
    if (reloadProperties.has(name)) scheduleAttachment(instance, context)
    else applyLiveProperty(instance, name)
  },
  insert: (instance, parent, anchor, context) => {
    context.host.insertNode(parent, instance.visualNode, anchor)
    instance.inserted = true
    refreshHolePunch(instance, context)
    scheduleAttachment(instance, context)
  },
  remove: (instance, parent, context) => {
    context.host.removeNode(parent, instance.visualNode)
    instance.inserted = false
  },
  dispose: (instance) => {
    instance.disposed = true
    instance.revision += 1
    clearControllerBindings(instance)
    void instance.operation.then(async () => {
      await instance.controller?.destroy()
      instance.controller = undefined
      instance.driver = undefined
    })
  },
  semantics: (instance): SemanticsNode => ({
    id: instance.props.id ?? instance.intrinsicId,
    role: 'video',
    label: instance.props.ariaLabel ?? 'Video',
    valueText: instance.state.playing ? 'playing' : 'paused',
  }),
  geometry: (instance) => ({
    id: instance.props.id ?? instance.intrinsicId,
    rect: {
      x: instance.props.x,
      y: instance.props.y,
      width: instance.props.width,
      height: instance.props.height,
    },
  }),
}

export const frameworkVideoIntrinsicAdapter = videoIntrinsic

export const unregisterFrameworkVideoIntrinsic = registerIntrinsic(
  'video',
  videoIntrinsic,
)

function setVideoProperty(
  props: MutableVideoProps,
  name: string,
  value: unknown,
): void {
  switch (name) {
    case 'id':
    case 'src':
    case 'poster':
    case 'ariaLabel':
      props[name] = typeof value === 'string' ? value : undefined
      return
    case 'x':
    case 'y':
    case 'width':
    case 'height':
      props[name] = typeof value === 'number' ? value : 0
      return
    case 'alpha':
    case 'zIndex':
    case 'volume':
    case 'appWidth':
    case 'appHeight':
    case 'radius':
      props[name] = typeof value === 'number' ? value : undefined
      return
    case 'autoplay':
    case 'controls':
    case 'muted':
    case 'visible':
    case 'loop':
    case 'playsinline':
      props[name] = value === true
      return
    case 'preload':
      if (value === 'none' || value === 'metadata' || value === 'auto') {
        props.preload = value
      }
      return
    case 'source':
      props.source = isVideoSource(value) ? value : undefined
      return
    case 'backend':
      if (typeof value === 'string' || isStringArray(value)) props.backend = value
      return
    case 'fallbackBackends':
      if (isStringArray(value)) props.fallbackBackends = value
      return
    case 'deviceProfile':
      if (
        value === 'auto' ||
        value === 'mobile' ||
        value === 'tv' ||
        value === 'desktop'
      ) {
        props.deviceProfile = value
      }
      return
    case 'fit':
      if (value === 'fit' || value === 'cover' || value === 'stretch') {
        props.fit = value
      }
      return
    case 'subtitles':
      if (Array.isArray(value)) {
        props.subtitles = value.filter(isExternalSubtitleTrack)
      }
      return
    case 'onReady':
      if (typeof value === 'function') {
        props.onReady = (controller) => {
          Reflect.apply(value, undefined, [controller])
        }
      }
      return
    case 'onError':
      if (typeof value === 'function') {
        props.onError = (error) => {
          Reflect.apply(value, undefined, [error])
        }
      }
      return
    case 'onStateChange':
      if (typeof value === 'function') {
        props.onStateChange = (state) => {
          Reflect.apply(value, undefined, [state])
        }
      }
      return
    case 'onPlay':
    case 'onPause':
    case 'onEnded':
      if (typeof value === 'function') {
        props[name] = () => {
          Reflect.apply(value, undefined, [])
        }
      }
      return
    case 'onTimeUpdate':
      if (typeof value === 'function') {
        props.onTimeUpdate = (currentTime) => {
          Reflect.apply(value, undefined, [currentTime])
        }
      }
  }
}

function scheduleAttachment(
  instance: VideoIntrinsicInstance,
  context: IntrinsicContext,
): void {
  const source = instance.props.source ?? instance.props.src
  const revision = ++instance.revision
  instance.operation = instance.operation.then(async () => {
    if (instance.disposed || revision !== instance.revision) return
    if (source == null || source === '') {
      clearControllerBindings(instance)
      await instance.controller?.destroy()
      instance.controller = undefined
      instance.driver = undefined
      return
    }
    try {
      if (instance.controller == null) {
        const renderer = getActiveRenderer()
        ensureFrameworkVideoShader(renderer)
        const driver = instance.driver ?? activeDriver
        instance.driver = driver
        instance.controller = await attachCanvasVideo({
          canvas: renderer.canvas,
          rect: () => videoRect(instance),
          continuousLayout: false,
          source,
          backend: instance.props.backend ?? driver.backend,
          fallbackBackends: instance.props.fallbackBackends,
          client: driver.client,
          autoplay: instance.props.autoplay,
          deviceProfile:
            instance.props.deviceProfile ?? deviceProfile(context.environment.platform),
          subtitles: instance.props.subtitles,
          appWidth: instance.props.appWidth,
          appHeight: instance.props.appHeight,
        })
        if (instance.disposed || revision !== instance.revision) {
          await instance.controller.destroy()
          instance.controller = undefined
          instance.driver = undefined
          return
        }
        bindController(instance)
        applyAllLiveProperties(instance)
        instance.props.onReady?.(instance)
      } else {
        const driver = instance.driver ?? activeDriver
        await instance.controller.load(source, {
          backend: instance.props.backend ?? driver.backend,
          fallbackBackends: instance.props.fallbackBackends,
          autoplay: instance.props.autoplay,
          deviceProfile:
            instance.props.deviceProfile ?? deviceProfile(context.environment.platform),
          subtitles: instance.props.subtitles,
        })
        applyAllLiveProperties(instance)
      }
    } catch (error: unknown) {
      if (instance.controller == null) instance.driver = undefined
      instance.report(error)
    }
  })
}

function bindController(instance: VideoIntrinsicInstance): void {
  const controller = instance.controller
  if (controller == null) return
  clearControllerBindings(instance)
  const element = controller.element
  const sync = () => instance.syncState()
  const events: ReadonlyArray<readonly [string, () => void]> = [
    ['play', () => { sync(); instance.props.onPlay?.() }],
    ['pause', () => { sync(); instance.props.onPause?.() }],
    ['ended', () => { sync(); instance.props.onEnded?.() }],
    ['timeupdate', () => {
      sync()
      instance.props.onTimeUpdate?.(instance.state.currentTime)
    }],
    ['durationchange', sync],
    ['volumechange', sync],
    ['enterpictureinpicture', sync],
    ['leavepictureinpicture', sync],
  ]
  for (const [event, listener] of events) {
    element.addEventListener(event, listener)
    instance.cleanup.push(() => element.removeEventListener(event, listener))
  }
  document.addEventListener('fullscreenchange', sync)
  instance.cleanup.push(() => document.removeEventListener('fullscreenchange', sync))
  instance.cleanup.push(controller.on('timeupdate', sync))
  instance.cleanup.push(controller.on('trackchange', sync))
  instance.cleanup.push(
    controller.on('error', (event) => instance.report(event.detail)),
  )
  instance.syncState()
}

function clearControllerBindings(instance: VideoIntrinsicInstance): void {
  for (const cleanup of instance.cleanup.splice(0)) cleanup()
}

function applyAllLiveProperties(instance: VideoIntrinsicInstance): void {
  syncAnchorSurface(instance)
  for (const property of [
    'muted',
    'volume',
    'fit',
    'autoplay',
    'controls',
    'loop',
    'poster',
    'preload',
    'playsinline',
    'visible',
    'alpha',
  ]) {
    applyLiveProperty(instance, property)
  }
}

function syncAnchorSurface(instance: VideoIntrinsicInstance): void {
  const controller = instance.controller
  if (controller == null) return
  const backend = controller.capabilities.backend
  controller.anchor.style.backgroundColor =
    backend === 'html' ||
    backend === 'webos' ||
    backend === 'vizio' ||
    backend === 'transcode'
      ? 'black'
      : 'transparent'
}

function applyLiveProperty(
  instance: VideoIntrinsicInstance,
  property: string,
): void {
  const controller = instance.controller
  if (controller == null) return
  switch (property) {
    case 'muted':
      instance.setMuted(instance.props.muted === true)
      return
    case 'volume':
      instance.setVolume(instance.props.volume ?? 1)
      return
    case 'fit':
      if (instance.props.fit != null) {
        void controller
          .setVideoFit(instance.props.fit)
          .catch((error: unknown) => instance.report(error))
      }
      return
    case 'autoplay':
      if (instance.props.autoplay === true) instance.play()
      return
    case 'loop':
      controller.element.loop = instance.props.loop === true
      return
    case 'controls':
      controller.element.controls = instance.props.controls === true
      return
    case 'poster':
      controller.element.poster = instance.props.poster ?? ''
      return
    case 'preload':
      controller.element.preload = instance.props.preload ?? 'metadata'
      return
    case 'playsinline':
      controller.element.playsInline = instance.props.playsinline !== false
      return
    case 'visible':
      controller.anchor.style.visibility = instance.props.visible === false
        ? 'hidden'
        : 'visible'
      return
    case 'alpha':
      controller.anchor.style.opacity = String(
        Math.min(1, Math.max(0, instance.props.alpha ?? 1)),
      )
  }
}

function refreshHolePunch(
  instance: VideoIntrinsicInstance,
  context: IntrinsicContext,
): void {
  const rect = videoRect(instance)
  if (!(rect.width > 0) || !(rect.height > 0)) return
  context.host.setProperty(instance.visualNode, 'effects', {
    holePunch: frameworkVideoHole(
      rect,
      instance.props.radius ?? 0,
    ),
  })
}

function videoRect(instance: VideoIntrinsicInstance) {
  return {
    x: instance.props.x,
    y: instance.props.y,
    width: instance.props.width,
    height: instance.props.height,
  }
}

function deviceProfile(
  platform: IntrinsicContext['environment']['platform'],
): DeviceProfile {
  if (platform === 'mobile') return 'mobile'
  if (platform === 'tv') return 'tv'
  if (platform === 'desktop') return 'desktop'
  return 'auto'
}

function selectedTrack(
  tracks: readonly MediaTrack[],
  kind: 'audio' | 'subtitle',
): string | undefined {
  return tracks.find((track) => track.kind === kind && track.selected)?.id
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback
}

function sameState(
  left: FrameworkMediaState,
  right: FrameworkMediaState,
): boolean {
  return (
    left.playing === right.playing &&
    left.currentTime === right.currentTime &&
    left.duration === right.duration &&
    left.volume === right.volume &&
    left.muted === right.muted &&
    left.fullscreen === right.fullscreen &&
    left.pictureInPicture === right.pictureInPicture &&
    left.captionsTrackId === right.captionsTrackId &&
    left.audioTrackId === right.audioTrackId
  )
}

function isVideoSource(value: unknown): value is string | VideoSource {
  return (
    typeof value === 'string' ||
    (typeof value === 'object' &&
      value !== null &&
      'uri' in value &&
      typeof value.uri === 'string')
  )
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isExternalSubtitleTrack(value: unknown): value is ExternalSubtitleTrack {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string'
  )
}

declare module '@get-air/framework/jsx-runtime' {
  namespace JSX {
    interface IntrinsicElements {
      readonly video: FrameworkVideoElementProps
    }
  }
}
