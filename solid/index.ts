import { getRenderer, type ShaderHolePunchProps } from '@solidtv/solid'
import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js'

import {
  attachCanvasVideo,
  transparentCanvasRendererOptions,
  type AttachCanvasVideoOptions,
  type CanvasVideoController,
  type CanvasVideoRect,
} from '../canvas/index'
import type { SubtitleCue, VideoLoadOptions } from '../guest-js/index'

type HolePunchShader =
  | typeof import('@solidtv/renderer/canvas/shaders').HolePunch
  | typeof import('@solidtv/renderer/webgl/shaders').HolePunch

export type SolidVideoRect = CanvasVideoRect

export interface SolidRendererLike {
  readonly canvas: HTMLCanvasElement
}

export interface SolidShaderRendererLike extends SolidRendererLike {
  readonly stage: {
    readonly renderer: { readonly mode?: string }
    readonly shManager: {
      registerShaderType(name: string, shader: HolePunchShader): void
    }
  }
}

export interface AttachSolidVideoOptions
  extends Omit<AttachCanvasVideoOptions, 'canvas'> {
  /** SolidTV renderer returned by `createRenderer`; defaults to `getRenderer()`. */
  renderer?: SolidRendererLike
}

export interface SolidVideoState {
  readonly controller: Accessor<CanvasVideoController | undefined>
  readonly loading: Accessor<boolean>
  readonly error: Accessor<unknown>
  /** Active external cues. Render these with a SolidTV `<text>` node. */
  readonly subtitleCues: Accessor<readonly SubtitleCue[]>
}

/** Options to spread into SolidTV `createRenderer` or `Config.rendererOptions`. */
export const transparentSolidRendererOptions = transparentCanvasRendererOptions

/**
 * Register the renderer-specific `holePunch` shader. SolidTV intentionally
 * leaves shader registration to applications for tree-shaking, so call this
 * after `createRenderer()` and before `render()`.
 */
export async function registerSolidVideoShader(
  renderer: SolidShaderRendererLike,
): Promise<void> {
  const shader = renderer.stage.renderer.mode === 'canvas'
    ? (await import('@solidtv/renderer/canvas/shaders')).HolePunch
    : (await import('@solidtv/renderer/webgl/shaders')).HolePunch
  renderer.stage.shManager.registerShaderType('holePunch', shader)
}

/** Value for SolidTV `effects={{ holePunch: solidVideoHole(rect) }}`. */
export function solidVideoHole(
  rect: SolidVideoRect,
  radius: number | number[] = 0,
): Partial<ShaderHolePunchProps> {
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    || rect.width <= 0 || rect.height <= 0) {
    throw new RangeError('SolidTV video rect must be finite with positive dimensions')
  }
  return { x: rect.x, y: rect.y, w: rect.width, h: rect.height, radius }
}

/** Imperatively attach an Air backend beneath the current SolidTV canvas. */
export function attachSolidVideo(
  options: AttachSolidVideoOptions,
): Promise<CanvasVideoController> {
  const { renderer = getRenderer(), ...videoOptions } = options
  if (!renderer?.canvas) {
    throw new Error('SolidTV createRenderer() must run before attachSolidVideo()')
  }
  return attachCanvasVideo({ ...videoOptions, canvas: renderer.canvas })
}

/**
 * Reactive SolidTV integration. Source and backend signal changes use the
 * stable controller's `load` method; the canvas anchor and subscriptions stay
 * mounted. Dispose of the Solid owner to destroy playback automatically.
 */
export function createSolidVideo(
  options: Accessor<AttachSolidVideoOptions>,
): SolidVideoState {
  const [controller, setController] = createSignal<CanvasVideoController>()
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<unknown>()
  const [subtitleCues, setSubtitleCues] = createSignal<readonly SubtitleCue[]>([])
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
          active = await attachSolidVideo(next)
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

function loadOptions(options: AttachSolidVideoOptions): VideoLoadOptions {
  const { renderer: _renderer, rect: _rect, appWidth: _appWidth,
    appHeight: _appHeight, source: _source, client: _client, ...videoOptions } = options
  return videoOptions
}
