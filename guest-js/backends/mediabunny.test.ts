import { describe, expect, it } from 'vitest'

import { assertPlayableTracks } from './mediabunny'

describe('MediaBunny track acceptance', () => {
  it('rejects silent fallback when the source has undecodable audio', () => {
    expect(() => assertPlayableTracks(true, true, true, false)).toThrowError(
      expect.objectContaining({
        _tag: 'VideoBackendUnavailableError',
        backend: 'mediabunny',
      }),
    )
  })

  it('accepts video-only, audio-only, and fully decodable sources', () => {
    expect(() => assertPlayableTracks(true, false, true, false)).not.toThrow()
    expect(() => assertPlayableTracks(false, true, false, true)).not.toThrow()
    expect(() => assertPlayableTracks(true, true, true, true)).not.toThrow()
  })
})
