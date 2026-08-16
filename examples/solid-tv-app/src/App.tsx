import { createSignal, onCleanup } from 'solid-js'
import type { VideoBackend } from '@get-air/video'
import {
  createSolidVideo,
  solidVideoHole,
  type SolidVideoRect,
  type SolidRendererLike,
} from '@get-air/video/solid'

const videoRect: SolidVideoRect = { x: 180, y: 120, width: 1560, height: 780 }

interface QualificationSnapshot {
  readonly ready: boolean
  readonly error?: string
  readonly sessionId?: string
  readonly backend?: string
  readonly media?: unknown
  readonly tracks?: unknown
  readonly quality?: unknown
  readonly stats?: unknown
  readonly canvas?: {
    readonly width: number
    readonly height: number
    readonly left: number
    readonly top: number
    readonly cssWidth: number
    readonly cssHeight: number
  }
  readonly videoElements: number
  readonly canvasElements: number
}

interface QualificationBridge {
  snapshot(): Promise<QualificationSnapshot>
  reload(source: string): Promise<void>
  seek(positionSeconds: number): Promise<void>
}

declare global {
  interface Window {
    __AIR_VIDEO_QUALIFICATION__?: QualificationBridge
  }
}

export function App(props: { renderer: SolidRendererLike }) {
  const parameters = new URLSearchParams(window.location.search)
  const qualification = parameters.has('qualification')
  const [source, setSource] = createSignal(parameters.get('source') ?? '/sample.mkv')
  const [backends, setBackends] = createSignal<readonly VideoBackend[]>(qualification
    ? ['mediabunny']
    : ['mediabunny', 'html'])
  const video = createSolidVideo(() => ({
    renderer: props.renderer,
    rect: videoRect,
    source: source(),
    backend: backends(),
    autoplay: true,
    subtitles: qualification ? [] : [{
      id: 'english',
      src: '/sample.en.vtt',
      label: 'English',
      language: 'en',
      default: true,
    }],
  }))

  if (qualification) {
    window.__AIR_VIDEO_QUALIFICATION__ = {
      snapshot: async () => {
        const controller = video.controller()
        const mediaCanvas = [...document.querySelectorAll('canvas')]
          .find((canvas) => canvas !== props.renderer.canvas)
        const bounds = mediaCanvas?.getBoundingClientRect()
        const cause = video.error()
        return {
          ready: Boolean(controller) && !video.loading(),
          error: cause instanceof Error
            ? cause.message
            : cause === undefined ? undefined : String(cause),
          sessionId: controller?.sessionId,
          backend: controller?.capabilities.backend,
          media: controller?.media,
          tracks: controller?.tracks,
          quality: controller?.playbackQuality(),
          stats: controller ? await controller.stats() : undefined,
          canvas: mediaCanvas && bounds ? {
            width: mediaCanvas.width,
            height: mediaCanvas.height,
            left: bounds.left,
            top: bounds.top,
            cssWidth: bounds.width,
            cssHeight: bounds.height,
          } : undefined,
          videoElements: document.querySelectorAll('video').length,
          canvasElements: document.querySelectorAll('canvas').length,
        }
      },
      reload: async (nextSource) => {
        const controller = video.controller()
        if (!controller) throw new Error('Video controller is not ready')
        await controller.load(nextSource, { backend: ['mediabunny'], autoplay: true })
      },
      seek: async (positionSeconds) => {
        const controller = video.controller()
        if (!controller) throw new Error('Video controller is not ready')
        await controller.seek(positionSeconds)
      },
    }
    onCleanup(() => { delete window.__AIR_VIDEO_QUALIFICATION__ })
  }

  const keydown = (event: KeyboardEvent) => {
    if (event.key === '1') setBackends(['mediabunny', 'html'])
    if (event.key === '2') setBackends(['mediabunny'])
    if (event.key === '3') setBackends(['html'])
    if (event.key === 'n') setSource((value) =>
      value === '/sample.mkv' ? '/sample-2.mkv' : '/sample.mkv')
  }
  window.addEventListener('keydown', keydown)
  onCleanup(() => window.removeEventListener('keydown', keydown))

  return (
    <node w={1920} h={1080} color={0x10141fff}
      effects={{ holePunch: solidVideoHole(videoRect, 24) }}>
      <node x={80} y={46} w={video.loading() ? 220 : 360} h={12}
        color={video.error() ? 0xff5f57ff : 0x40d99bff} />
      <node x={80} y={1018} w={video.subtitleCues().length ? 360 : 180} h={8}
        color={0x8ea6c9ff} />
    </node>
  )
}
