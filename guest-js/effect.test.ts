import { describe, expect, it } from 'vitest'

import {
  requestedBackends,
  selectPlayerBackend,
  type VideoRuntimeHints,
} from './effect'

const web: VideoRuntimeHints = { tizen: false, webos: false, vizio: false }

describe('selectPlayerBackend', () => {
  it('keeps MediaBunny opt-in and preserves external adapter IDs', () => {
    expect(selectPlayerBackend('mediabunny', web)).toBe('mediabunny')
    expect(selectPlayerBackend('native-surface', web)).toBe('native-surface')
  })

  it('selects native TV players before generic HTML playback', () => {
    expect(selectPlayerBackend('auto', { ...web, tizen: true })).toBe('tizen')
    expect(selectPlayerBackend(undefined, { ...web, webos: true })).toBe('webos')
    expect(selectPlayerBackend(undefined, { ...web, vizio: true })).toBe('vizio')
  })

  it('uses HTML on ordinary web', () => {
    expect(selectPlayerBackend('auto', web)).toBe('html')
  })

  it('detects the Vizio runtime global without relying on its user agent', () => {
    Reflect.set(globalThis, 'VIZIO', {})
    try {
      expect(selectPlayerBackend('auto')).toBe('vizio')
    } finally {
      Reflect.deleteProperty(globalThis, 'VIZIO')
    }
  })

  it('keeps an ordered, de-duplicated external fallback chain', () => {
    expect(requestedBackends({
      backend: ['mediabunny', 'native-surface'],
      fallbackBackends: ['native-surface', 'html'],
    })).toEqual(['mediabunny', 'native-surface', 'html'])
  })

  it('keeps auto and explicit fallbacks for runtime registry resolution', () => {
    expect(requestedBackends({
      backend: 'auto',
      fallbackBackends: ['mediabunny'],
    })).toEqual(['auto', 'mediabunny'])
  })
})
