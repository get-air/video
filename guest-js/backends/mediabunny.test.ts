import { describe, expect, it } from 'vitest'

import { assertPlayableTracks, defaultTrackMimeType, defaultTracksDecodable } from './mediabunny'

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

describe('HTML track preflight', () => {
  it('requires default tracks but ignores unsupported alternates', () => {
    expect(defaultTracksDecodable([true], [true, false])).toBe(true)
    expect(defaultTracksDecodable([true], [false, true])).toBe(false)
    expect(defaultTracksDecodable([], [])).toBe(true)
  })

  it('checks only the default audio/video codecs against the native container', () => {
    expect(defaultTrackMimeType('video/mp4', 'avc1.640028', 'mp4a.40.2')).toBe(
      'video/mp4; codecs="avc1.640028, mp4a.40.2"',
    )
    expect(defaultTrackMimeType('video/x-matroska', null, null)).toBe('video/x-matroska')
  })
})
