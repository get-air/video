// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  attachCanvasVideo: vi.fn(),
  browserClient: { attach: vi.fn() },
  ensureFrameworkVideoShader: vi.fn(),
  getActiveRenderer: vi.fn(() => ({
    backend: 'webgl',
    canvas: document.createElement('canvas'),
    registerShader: vi.fn(),
  })),
  registerIntrinsic: vi.fn(() => vi.fn()),
}))

vi.mock('@get-air/framework', () => ({
  getActiveRenderer: mocks.getActiveRenderer,
  registerIntrinsic: mocks.registerIntrinsic,
}))

vi.mock('../canvas/index', () => ({
  attachCanvasVideo: mocks.attachCanvasVideo,
}))

vi.mock('../guest-js/index', () => ({
  createVideoClient: () => mocks.browserClient,
}))

vi.mock('./geometry', () => ({
  frameworkVideoHole: (
    rect: { x: number; y: number; width: number; height: number },
    radius: number,
  ) => ({ x: rect.x, y: rect.y, w: rect.width, h: rect.height, radius }),
}))

vi.mock('./shader', () => ({
  ensureFrameworkVideoShader: mocks.ensureFrameworkVideoShader,
}))

import type { IntrinsicContext, UniversalHost } from '@get-air/framework'
import type { CanvasVideoController } from '../canvas/index'
import type { VideoClient } from '../guest-js/index'
import {
  frameworkVideoIntrinsicAdapter,
  installFrameworkVideoDriver,
} from './intrinsic'

function createController(backend = 'html'): CanvasVideoController {
  const element = document.createElement('video')
  Object.defineProperties(element, {
    currentTime: { configurable: true, writable: true, value: 0 },
    duration: { configurable: true, value: 120 },
    paused: { configurable: true, value: true },
  })
  return {
    element,
    anchor: element,
    sessionId: 'framework-video-test',
    capabilities: { backend },
    media: {
      durationSeconds: 120,
      seekable: true,
      live: false,
      tracks: [],
      chapters: [],
    },
    tracks: [],
    bufferedAhead: vi.fn(() => 0),
    playbackQuality: vi.fn(() => ({
      presentedFrames: 0,
      measuredFps: 0,
      totalVideoFrames: 0,
      droppedVideoFrames: 0,
      droppedFramePercent: 0,
    })),
    refreshLayout: vi.fn(),
    updateLayout: vi.fn(),
    load: vi.fn(async () => undefined),
    play: vi.fn(async () => undefined),
    pause: vi.fn(),
    seek: vi.fn(async () => undefined),
    setVolume: vi.fn(async () => undefined),
    setPlaybackRate: vi.fn(async () => undefined),
    setVideoFit: vi.fn(async () => undefined),
    setVideoZoom: vi.fn(async () => undefined),
    selectTrack: vi.fn(async () => undefined),
    suspend: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    on: vi.fn(() => vi.fn()),
    destroy: vi.fn(async () => undefined),
  } as unknown as CanvasVideoController
}

function createHarness(platform: 'web' | 'desktop' | 'mobile' | 'tv' = 'web') {
  const parents = new WeakMap<object, object>()
  const host: UniversalHost<object> = {
    createElement: () => ({}),
    createTextNode: () => ({}),
    replaceText: vi.fn(),
    setProperty: vi.fn(),
    insertNode: (parent, node) => parents.set(node, parent),
    removeNode: (_parent, node) => parents.delete(node),
    getParentNode: (node) => parents.get(node),
    getFirstChild: () => undefined,
    getNextSibling: () => undefined,
    isTextNode: () => false,
  }
  const context: IntrinsicContext = {
    name: 'video',
    host,
    environment: { platform },
  }
  const instance = frameworkVideoIntrinsicAdapter.create(context)
  const parent = host.createElement('view')
  frameworkVideoIntrinsicAdapter.update(instance, 'width', 1280, context)
  frameworkVideoIntrinsicAdapter.update(instance, 'height', 720, context)
  return { context, host, instance, parent }
}

async function waitForAttachment(): Promise<void> {
  await vi.waitFor(() => expect(mocks.attachCanvasVideo).toHaveBeenCalledOnce())
}

describe('framework video intrinsic drivers', () => {
  beforeEach(() => {
    mocks.attachCanvasVideo.mockReset().mockResolvedValue(createController())
    mocks.ensureFrameworkVideoShader.mockClear()
    mocks.getActiveRenderer.mockClear()
  })

  it('uses the HTML driver by default in browsers', async () => {
    const { context, instance, parent } = createHarness('web')
    const controllerRef = vi.fn()
    frameworkVideoIntrinsicAdapter.update(
      instance,
      'controllerRef',
      controllerRef,
      context,
    )
    frameworkVideoIntrinsicAdapter.update(instance, 'src', 'movie.mp4', context)
    frameworkVideoIntrinsicAdapter.insert(instance, parent, undefined, context)

    await waitForAttachment()

    expect(mocks.attachCanvasVideo).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'html',
      client: mocks.browserClient,
      deviceProfile: 'auto',
      source: 'movie.mp4',
    }))
    expect(mocks.ensureFrameworkVideoShader).toHaveBeenCalledWith(
      mocks.getActiveRenderer.mock.results[0]?.value,
    )
    expect(controllerRef).toHaveBeenCalledWith(instance)
    expect((await mocks.attachCanvasVideo.mock.results[0]?.value).anchor.style.backgroundColor)
      .toBe('black')

    frameworkVideoIntrinsicAdapter.dispose(instance, context)
  })

  it('routes through an installed native driver and restores browser routing', async () => {
    const nativeClient = { attach: vi.fn() } as unknown as VideoClient
    const nativeController = createController('tauri')
    mocks.attachCanvasVideo.mockResolvedValueOnce(nativeController)
    const restore = installFrameworkVideoDriver({
      client: nativeClient,
      backend: 'tauri',
    })
    const native = createHarness('desktop')
    frameworkVideoIntrinsicAdapter.update(
      native.instance,
      'source',
      { uri: 'movie.mkv' },
      native.context,
    )
    frameworkVideoIntrinsicAdapter.insert(
      native.instance,
      native.parent,
      undefined,
      native.context,
    )

    await waitForAttachment()
    expect(mocks.attachCanvasVideo).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'tauri',
      client: nativeClient,
      deviceProfile: 'desktop',
      source: { uri: 'movie.mkv' },
    }))

    restore()
    frameworkVideoIntrinsicAdapter.update(
      native.instance,
      'source',
      'next.mkv',
      native.context,
    )
    await vi.waitFor(() => expect(nativeController.load).toHaveBeenCalledOnce())
    expect(nativeController.load).toHaveBeenCalledWith(
      'next.mkv',
      expect.objectContaining({ backend: 'tauri' }),
    )
    expect(nativeController.anchor.style.backgroundColor).toBe('transparent')
    frameworkVideoIntrinsicAdapter.dispose(native.instance, native.context)

    restore()
    mocks.attachCanvasVideo.mockClear()
    const browser = createHarness('mobile')
    frameworkVideoIntrinsicAdapter.update(
      browser.instance,
      'src',
      'trailer.mp4',
      browser.context,
    )
    frameworkVideoIntrinsicAdapter.insert(
      browser.instance,
      browser.parent,
      undefined,
      browser.context,
    )

    await waitForAttachment()
    expect(mocks.attachCanvasVideo).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'html',
      client: mocks.browserClient,
      deviceProfile: 'mobile',
    }))
    frameworkVideoIntrinsicAdapter.dispose(browser.instance, browser.context)
  })

  it('does not resurrect an out-of-order native driver cleanup', async () => {
    const desktopClient = { attach: vi.fn() } as unknown as VideoClient
    const mobileClient = { attach: vi.fn() } as unknown as VideoClient
    const restoreDesktop = installFrameworkVideoDriver({
      client: desktopClient,
      backend: 'tauri-desktop',
    })
    const restoreMobile = installFrameworkVideoDriver({
      client: mobileClient,
      backend: 'tauri-mobile',
    })

    restoreDesktop()
    restoreMobile()

    const browser = createHarness('web')
    frameworkVideoIntrinsicAdapter.update(
      browser.instance,
      'src',
      'browser.mp4',
      browser.context,
    )
    frameworkVideoIntrinsicAdapter.insert(
      browser.instance,
      browser.parent,
      undefined,
      browser.context,
    )

    await waitForAttachment()
    expect(mocks.attachCanvasVideo).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'html',
      client: mocks.browserClient,
    }))
    frameworkVideoIntrinsicAdapter.dispose(browser.instance, browser.context)
  })
})
