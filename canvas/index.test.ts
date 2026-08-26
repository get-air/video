// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { VideoController } from '../guest-js/index'
import { attachCanvasVideo } from './index'

const controllers = new Set<VideoController>()

afterEach(async () => {
  await Promise.all([...controllers].map((controller) => controller.destroy()))
  controllers.clear()
  document.body.replaceChildren()
  document.documentElement.style.removeProperty('background')
  document.body.style.removeProperty('background')
  vi.restoreAllMocks()
})

describe('transparent canvas attachment', () => {
  it('keeps the video anchor below the canvas and refreshes only changed geometry', async () => {
    const canvas = document.createElement('canvas')
    document.body.append(canvas)
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 20,
      width: 960,
      height: 540,
    } as DOMRect)
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const refreshLayout = vi.fn()
    const destroy = vi.fn(async () => undefined)
    const controller = Object.assign(new EventTarget(), {
      element: document.createElement('video'),
      sessionId: 'canvas-test',
      capabilities: { backend: 'test' },
      media: { seekable: true, live: false, tracks: [], chapters: [] },
      tracks: [],
      refreshLayout,
      destroy,
    }) as unknown as VideoController
    const client = {
      attach: vi.fn(async () => controller),
    }
    const rect = { x: 192, y: 108, width: 960, height: 540 }

    const attached = await attachCanvasVideo({
      canvas,
      rect: () => rect,
      continuousLayout: false,
      source: 'movie.mkv',
      client,
    })
    controllers.add(attached)

    expect(canvas.previousElementSibling).toBe(attached.anchor)
    expect(attached.anchor.style.left).toBe('106px')
    expect(attached.anchor.style.top).toBe('74px')
    expect(attached.anchor.style.width).toBe('480px')
    expect(attached.anchor.style.height).toBe('270px')
    expect(client.attach).toHaveBeenCalledWith(attached.anchor, expect.objectContaining({
      source: 'movie.mkv',
      surfaceMode: 'transparent-canvas',
    }))
    expect(requestAnimationFrame).not.toHaveBeenCalled()

    attached.updateLayout()
    expect(refreshLayout).not.toHaveBeenCalled()
    rect.x += 1
    attached.updateLayout()
    expect(refreshLayout).toHaveBeenCalledOnce()

    await attached.destroy()
    controllers.delete(attached)
    expect(destroy).toHaveBeenCalledOnce()
    expect(attached.anchor.isConnected).toBe(false)
  })
})
