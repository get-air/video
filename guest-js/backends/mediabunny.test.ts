import { describe, expect, it } from 'vitest'

import { VideoBackendUnavailableError } from '../errors'
import { assertPlayableTracks } from './mediabunny'

describe('MediaBunny track selection', () => {
  it('rejects video whose only decodable track is audio so fallback can continue', () => {
    expect(() => assertPlayableTracks(true, false, true))
      .toThrow(VideoBackendUnavailableError)
  })

  it('accepts decodable video and true audio-only inputs', () => {
    expect(() => assertPlayableTracks(true, true, false)).not.toThrow()
    expect(() => assertPlayableTracks(false, false, true)).not.toThrow()
  })
})
