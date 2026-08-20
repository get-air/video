import { describe, expect, it } from 'vitest'

import { requestedBackends } from './effect'

describe('requestedBackends', () => {
  it('defaults to explicit HTML playback', () => {
    expect(requestedBackends({})).toEqual(['html'])
  })

  it('keeps an ordered, de-duplicated explicit fallback chain', () => {
    expect(requestedBackends({
      backend: ['html', 'native-surface'],
      fallbackBackends: ['native-surface', 'transcode'],
    })).toEqual(['html', 'native-surface', 'transcode'])
  })
})
