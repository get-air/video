import {
  attachCanvasVideo,
  canvasRectToViewport,
  transparentCanvasRendererOptions,
  type AttachCanvasVideoOptions,
  type CanvasBoundsSource,
  type CanvasVideoController,
  type CanvasVideoRect,
} from '../canvas/index'

/** @deprecated Prefer `CanvasVideoRect` from `@get-air/video/canvas`. */
export type BlitsVideoRect = CanvasVideoRect
export type BlitsCanvasBoundsSource = CanvasBoundsSource
export type AttachBlitsVideoOptions = AttachCanvasVideoOptions
export type BlitsVideoController = CanvasVideoController

export interface BlitsHolePunch {
  type: 'holePunch'
  x: number
  y: number
  w: number
  h: number
  radius: number | number[]
}

/** Settings to spread into `Blits.Launch` for a transparent video aperture. */
export const transparentBlitsSettings = Object.freeze({
  canvasColor: '#00000000',
  advanced: Object.freeze(transparentCanvasRendererOptions),
})

/** Shader value for the opaque Blits background surrounding the video. */
export function blitsVideoHole(
  rect: BlitsVideoRect,
  radius: number | number[] = 0,
): BlitsHolePunch {
  canvasRectToViewport({
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 }),
  }, rect)
  return { type: 'holePunch', x: rect.x, y: rect.y, w: rect.width, h: rect.height, radius }
}

/** Convert Blits-authored coordinates into WebView viewport CSS pixels. */
export const blitsRectToViewport = canvasRectToViewport

/** Attach any Air backend beneath a Blits canvas. */
export const attachBlitsVideo = attachCanvasVideo
