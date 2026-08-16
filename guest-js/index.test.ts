// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import {
  VIDEO_CONTROLS_ATTRIBUTE,
  bufferedAhead,
  createVideoClient,
  registerVideoControls,
} from './index'

describe('DOM-first public API', () => {
  it('registers control regions with a neutral, reference-counted marker', () => {
    const toolbar = document.createElement('div')
    const releaseFirst = registerVideoControls(toolbar)
    const releaseSecond = registerVideoControls(toolbar)
    expect(toolbar.hasAttribute(VIDEO_CONTROLS_ATTRIBUTE)).toBe(true)
    releaseFirst()
    expect(toolbar.hasAttribute(VIDEO_CONTROLS_ATTRIBUTE)).toBe(true)
    releaseSecond()
    expect(toolbar.hasAttribute(VIDEO_CONTROLS_ATTRIBUTE)).toBe(false)
  })

  it('measures the playable range containing the current position', () => {
    const ranges = {
      length: 2,
      start: (index: number) => [0.1, 8][index],
      end: (index: number) => [4, 12][index],
    } as TimeRanges
    expect(bufferedAhead(ranges, 0)).toBe(4)
    expect(bufferedAhead(ranges, 9)).toBe(3)
    expect(bufferedAhead(ranges, 6)).toBe(0)
  })

  it('creates clients without probing or importing Tauri', () => {
    expect(createVideoClient()).toEqual({ attach: expect.any(Function) })
  })
})
