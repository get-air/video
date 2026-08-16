import { attachVideo, type VideoController } from '@get-air/video'

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

export async function startQualificationApp(): Promise<void> {
  const parameters = new URLSearchParams(window.location.search)
  const source = parameters.get('source')
  if (!source) throw new Error('The qualification route requires a source URL')

  const root = document.querySelector<HTMLElement>('#app')
  if (!root) throw new Error('The qualification route requires an #app element')
  const anchor = document.createElement('video')
  Object.assign(anchor.style, {
    position: 'fixed',
    left: '180px',
    top: '120px',
    width: '1560px',
    height: '780px',
  })
  root.append(anchor)

  let controller: VideoController | undefined
  let error: unknown
  let loading = true
  window.__AIR_VIDEO_QUALIFICATION__ = {
    snapshot: async () => {
      const mediaCanvas = document.querySelector<HTMLCanvasElement>('canvas') ?? undefined
      const bounds = mediaCanvas?.getBoundingClientRect()
      return {
        ready: Boolean(controller) && !loading,
        error: error instanceof Error ? error.message : error === undefined ? undefined : String(error),
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
      if (!controller) throw new Error('Video controller is not ready')
      await controller.load(nextSource, { backend: ['mediabunny'], autoplay: true })
    },
    seek: async (positionSeconds) => {
      if (!controller) throw new Error('Video controller is not ready')
      await controller.seek(positionSeconds)
    },
  }

  try {
    controller = await attachVideo(anchor, {
      source,
      backend: ['mediabunny'],
      autoplay: true,
    })
  } catch (cause) {
    error = cause
  } finally {
    loading = false
  }

  window.addEventListener('pagehide', () => {
    delete window.__AIR_VIDEO_QUALIFICATION__
    void controller?.destroy()
  }, { once: true })
}
