import {
  createEffect,
  createSignal,
  getActiveRenderer,
  onCleanup,
  type Accessor,
} from '@get-air/framework'

import {
  attachCanvasVideo,
  transparentCanvasRendererOptions,
  type AttachCanvasVideoOptions,
  type CanvasVideoController,
  type CanvasVideoRect,
} from '../canvas/index'
import type { SubtitleCue, VideoLoadOptions } from '../guest-js/index'
export { registerFrameworkVideoShader } from './shader'

export type FrameworkVideoRect = CanvasVideoRect

export { frameworkVideoHole } from './geometry'

export interface FrameworkRendererLike {
  readonly canvas: HTMLCanvasElement
}

export interface AttachFrameworkVideoOptions
  extends Omit<AttachCanvasVideoOptions, 'canvas'> {
  /** Active Air renderer; defaults to `getActiveRenderer()`. */
  renderer?: FrameworkRendererLike
}

export interface FrameworkVideoState {
  readonly controller: Accessor<CanvasVideoController | undefined>
  readonly loading: Accessor<boolean>
  readonly error: Accessor<unknown>
  /** Active external cues for the application-owned subtitle presentation. */
  readonly subtitleCues: Accessor<readonly SubtitleCue[]>
}

/** Options to spread into the Air renderer configuration. */
export const transparentFrameworkRendererOptions = transparentCanvasRendererOptions

/** Imperatively attach an Air video backend beneath the active renderer. */
export function attachFrameworkVideo(
  options: AttachFrameworkVideoOptions,
): Promise<CanvasVideoController> {
  const { renderer = getActiveRenderer(), ...videoOptions } = options
  if (!renderer.canvas) {
    throw new Error(
      'Air createApp() must install an active renderer before attachFrameworkVideo()',
    )
  }
  return attachCanvasVideo({ ...videoOptions, canvas: renderer.canvas })
}

/**
 * Reactive Air framework integration. Source/backend changes reuse the stable
 * controller while owner disposal always destroys playback.
 */
export function createFrameworkVideo(
  options: Accessor<AttachFrameworkVideoOptions>,
): FrameworkVideoState {
  const [controller, setController] = createSignal<CanvasVideoController>()
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<unknown>()
  const [subtitleCues, setSubtitleCues] = createSignal<readonly SubtitleCue[]>(
    [],
  )
  let active: CanvasVideoController | undefined
  let unsubscribeSubtitle: (() => void) | undefined
  let operation = Promise.resolve()
  let revision = 0
  let disposed = false

  createEffect(() => {
    const next = options()
    const currentRevision = ++revision
    setLoading(true)
    setError(undefined)
    operation = operation.then(async () => {
      if (disposed || currentRevision !== revision) return
      try {
        if (!active) {
          active = await attachFrameworkVideo(next)
          if (disposed || currentRevision !== revision) {
            await active.destroy()
            active = undefined
            return
          }
          setController(active)
          unsubscribeSubtitle = active.on('subtitlecuechange', (event) => {
            setSubtitleCues(event.detail.cues)
          })
        } else {
          await active.load(next.source, loadOptions(next))
          active.updateLayout()
        }
      } catch (cause) {
        if (currentRevision === revision) setError(cause)
      } finally {
        if (currentRevision === revision) setLoading(false)
      }
    })
  })

  onCleanup(() => {
    disposed = true
    revision += 1
    void operation.then(async () => {
      unsubscribeSubtitle?.()
      await active?.destroy()
      active = undefined
    })
  })

  return { controller, loading, error, subtitleCues }
}

function loadOptions(options: AttachFrameworkVideoOptions): VideoLoadOptions {
  const {
    renderer: _renderer,
    rect: _rect,
    appWidth: _appWidth,
    appHeight: _appHeight,
    source: _source,
    client: _client,
    ...videoOptions
  } = options
  return videoOptions
}

export {
  installFrameworkVideoDriver,
  unregisterFrameworkVideoIntrinsic,
  type FrameworkMediaState,
  type FrameworkVideoDriver,
  type FrameworkVideoElementController,
  type FrameworkVideoElementProps,
} from './intrinsic'
