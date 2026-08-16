import {
  attachVideo,
  type AttachVideoOptions,
  type VideoClient,
  type VideoController,
} from '../guest-js/index'

/** Rectangle in the authored coordinate space of a canvas TV application. */
export interface CanvasVideoRect {
  x: number
  y: number
  width: number
  height: number
}

export interface CanvasBoundsSource {
  getBoundingClientRect(): Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>
}

export interface AttachCanvasVideoOptions extends Omit<AttachVideoOptions, 'surfaceMode'> {
  /** UI renderer canvas that must remain above the video layer. */
  canvas: HTMLCanvasElement
  /** Authored application width (defaults to 1920). */
  appWidth?: number
  /** Authored application height (defaults to 1080). */
  appHeight?: number
  /** Static aperture or a getter for animated/reactive layouts. */
  rect: CanvasVideoRect | (() => CanvasVideoRect)
  /** Optional client containing platform adapters such as Tauri. */
  client?: VideoClient
}

export interface CanvasVideoController extends VideoController {
  /** Invisible DOM anchor used for native and MediaBunny geometry. */
  readonly anchor: HTMLVideoElement
  /** Synchronize after changing a static rect outside the renderer loop. */
  updateLayout(): void
}

/** Transparent options shared by SolidTV and other Lightning renderers. */
export const transparentCanvasRendererOptions = Object.freeze({
  clearColor: 0x00000000,
  enableClear: true,
})

/** Convert authored coordinates into WebView viewport CSS pixels. */
export function canvasRectToViewport(
  canvas: CanvasBoundsSource,
  rect: CanvasVideoRect,
  appWidth = 1920,
  appHeight = 1080,
): CanvasVideoRect {
  assertCanvasVideoRect(rect)
  if (!(appWidth > 0) || !(appHeight > 0)) {
    throw new RangeError('appWidth and appHeight must be positive')
  }
  const bounds = canvas.getBoundingClientRect()
  return {
    x: bounds.left + rect.x * bounds.width / appWidth,
    y: bounds.top + rect.y * bounds.height / appHeight,
    width: rect.width * bounds.width / appWidth,
    height: rect.height * bounds.height / appHeight,
  }
}

/**
 * Attach any Air backend beneath a transparent canvas. MediaBunny output is
 * inserted immediately before the renderer canvas; native backends use the
 * same anchor as their transparent WebView aperture.
 */
export async function attachCanvasVideo(
  options: AttachCanvasVideoOptions,
): Promise<CanvasVideoController> {
  const { canvas, rect, client, appWidth = 1920, appHeight = 1080, ...videoOptions } = options
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new TypeError('attachCanvasVideo requires the renderer canvas')
  }

  const anchor = document.createElement('video')
  anchor.setAttribute('aria-hidden', 'true')
  anchor.tabIndex = -1
  for (const [property, value] of Object.entries({
    position: 'fixed',
    pointerEvents: 'none',
    margin: '0',
    border: '0',
    padding: '0',
  })) anchor.style.setProperty(kebab(property), value, 'important')
  const parent = canvas.parentElement ?? document.body
  parent.insertBefore(anchor, canvas.parentElement === parent ? canvas : null)

  const releaseTransparency = claimTransparentCanvas(canvas)
  let controller: VideoController | undefined
  let frame: number | undefined
  let destroyed = false
  let lastRect = ''

  const updateLayout = () => {
    if (destroyed) return
    const logical = typeof rect === 'function' ? rect() : rect
    const viewport = canvasRectToViewport(canvas, logical, appWidth, appHeight)
    const signature = [viewport.x, viewport.y, viewport.width, viewport.height]
      .map((value) => value.toFixed(3)).join(':')
    if (signature === lastRect) return
    lastRect = signature
    anchor.style.left = `${viewport.x}px`
    anchor.style.top = `${viewport.y}px`
    anchor.style.width = `${viewport.width}px`
    anchor.style.height = `${viewport.height}px`
    controller?.refreshLayout()
  }

  const tick = () => {
    updateLayout()
    if (!destroyed) frame = requestAnimationFrame(tick)
  }

  updateLayout()
  try {
    controller = await (client?.attach(anchor, {
      ...videoOptions,
      surfaceMode: 'transparent-canvas',
    }) ?? attachVideo(anchor, {
      ...videoOptions,
      surfaceMode: 'transparent-canvas',
    }))
  } catch (error) {
    destroyed = true
    releaseTransparency()
    anchor.remove()
    throw error
  }

  const backendDestroy = controller.destroy.bind(controller)
  const destroy = async () => {
    if (destroyed) return
    destroyed = true
    if (frame !== undefined) cancelAnimationFrame(frame)
    try {
      await backendDestroy()
    } finally {
      releaseTransparency()
      anchor.remove()
    }
  }
  Object.defineProperties(controller, {
    anchor: { enumerable: true, value: anchor },
    updateLayout: { value: updateLayout },
    destroy: { value: destroy },
  })
  frame = requestAnimationFrame(tick)
  return controller as CanvasVideoController
}

interface StyleLease { count: number; value: string; priority: string }
const backgroundLeases = new WeakMap<HTMLElement, StyleLease>()

function claimTransparentCanvas(canvas: HTMLCanvasElement): () => void {
  const elements = [document.documentElement, document.body, canvas]
  for (const element of elements) claimTransparentBackground(element)
  let active = true
  return () => {
    if (!active) return
    active = false
    for (const element of elements) releaseTransparentBackground(element)
  }
}

function claimTransparentBackground(element: HTMLElement): void {
  const lease = backgroundLeases.get(element)
  if (lease) {
    lease.count += 1
    return
  }
  backgroundLeases.set(element, {
    count: 1,
    value: element.style.getPropertyValue('background'),
    priority: element.style.getPropertyPriority('background'),
  })
  element.style.setProperty('background', 'transparent', 'important')
}

function releaseTransparentBackground(element: HTMLElement): void {
  const lease = backgroundLeases.get(element)
  if (!lease) return
  lease.count -= 1
  if (lease.count > 0) return
  if (lease.value) element.style.setProperty('background', lease.value, lease.priority)
  else element.style.removeProperty('background')
  backgroundLeases.delete(element)
}

function assertCanvasVideoRect(rect: CanvasVideoRect): void {
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) {
    throw new RangeError('Canvas video rect values must be finite')
  }
  if (!(rect.width > 0) || !(rect.height > 0)) {
    throw new RangeError('Canvas video rect width and height must be positive')
  }
}

function kebab(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}
