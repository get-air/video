// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../guest-js/index', async (importOriginal) => {
  const original = await importOriginal<typeof import('../guest-js/index')>()
  return {
    ...original,
    attachVideo: vi.fn(() => new Promise(() => undefined)),
  }
})

import { VideoControlRegion, VideoPlayer } from './index'
import { attachVideo, type VideoController } from '../guest-js/index'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(attachVideo).mockImplementation(() => new Promise(() => undefined))
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  document.head.querySelector('[data-air-video-player-styles]')?.remove()
})

describe('React integration', () => {
  it('installs scoped styles and marks built-in overlays without setup CSS', async () => {
    await act(async () => {
      root.render(<VideoPlayer source="https://example.test/movie.mkv" />)
    })

    const styles = document.head.querySelector<HTMLStyleElement>(
      '[data-air-video-player-styles]',
    )
    expect(styles).not.toBeNull()
    expect(container.querySelector('.tvp-controls')?.hasAttribute('data-air-video-controls'))
      .toBe(true)
    expect(container.querySelector('.tvp-overlay-slot')?.hasAttribute('data-air-video-controls'))
      .toBe(true)
    expect(attachVideo).toHaveBeenCalledWith(
      container.querySelector('video'),
      expect.objectContaining({
        source: 'https://example.test/movie.mkv',
        autoplay: false,
        deviceProfile: 'auto',
      }),
    )
  })

  it('supports a control region mounted independently from the player', async () => {
    await act(async () => {
      root.render(
        <aside>
          <VideoControlRegion className="application-toolbar">
            <button type="button">Play</button>
          </VideoControlRegion>
        </aside>,
      )
    })

    const toolbar = container.querySelector('.application-toolbar')
    expect(toolbar?.hasAttribute('data-air-video-controls')).toBe(true)
    expect(toolbar?.closest('.tvp-player')).toBeNull()
  })

  it('renders a moving live DVR window and exposes a remote-friendly go-live action', async () => {
    const seek = vi.fn(async () => undefined)
    const events = new EventTarget()
    vi.mocked(attachVideo).mockImplementation(async (element) => ({
      element,
      sessionId: 'live-test',
      capabilities: {
        backend: 'html', containers: 'platform', codecs: 'platform', drm: false, hdr: false,
        playbackRate: true, volume: true, videoFit: true, videoZoom: true,
        audioTrackSelection: true, subtitleTrackSelection: true, customHeaders: true,
        frameAccurateSeeking: false,
      },
      media: {
        live: true,
        seekable: true,
        seekableStartSeconds: 1180,
        seekableEndSeconds: 1245,
        tracks: [],
        chapters: [],
      },
      tracks: [],
      play: vi.fn(async () => undefined),
      pause: vi.fn(),
      seek,
      selectTrack: vi.fn(async () => undefined),
      setVolume: vi.fn(async () => undefined),
      setPlaybackRate: vi.fn(async () => undefined),
      setVideoFit: vi.fn(async () => undefined),
      setVideoZoom: vi.fn(async () => undefined),
      stats: vi.fn(async () => ({ sessionId: 'live-test' })),
      bufferedAhead: vi.fn(() => 10),
      playbackQuality: vi.fn(() => ({
        presentedFrames: 0, mediaTimeSeconds: 1230, measuredFps: 0,
        totalVideoFrames: 0, droppedVideoFrames: 0, droppedFramePercent: 0,
      })),
      refreshLayout: vi.fn(),
      registerControls: vi.fn(() => () => undefined),
      destroy: vi.fn(async () => undefined),
      on: vi.fn(() => () => undefined),
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
    }) as unknown as VideoController)

    await act(async () => {
      root.render(<VideoPlayer source="https://example.test/live.m3u8" />)
    })
    await act(async () => { await Promise.resolve() })

    const timeline = container.querySelector<HTMLInputElement>('.tvp-timeline')
    expect(timeline?.min).toBe('1180')
    expect(timeline?.max).toBe('1245')
    expect(timeline?.disabled).toBe(false)
    expect(timeline?.getAttribute('aria-valuetext')).toBe('0:15 behind live')
    const live = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Live')
    expect(live).toBeDefined()
    await act(async () => live?.click())
    expect(seek).toHaveBeenCalledWith(1245)
  })
})
