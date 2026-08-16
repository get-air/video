// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import {
  registerSolidVideoShader,
  solidVideoHole,
  transparentSolidRendererOptions,
} from './index'

describe('SolidTV integration', () => {
  it('builds the maintained SolidTV holePunch effect shape', () => {
    expect(solidVideoHole({ x: 120, y: 80, width: 1440, height: 810 }, 18))
      .toEqual({ x: 120, y: 80, w: 1440, h: 810, radius: 18 })
  })

  it('keeps the renderer clear buffer transparent', () => {
    expect(transparentSolidRendererOptions).toEqual({
      clearColor: 0x00000000,
      enableClear: true,
    })
  })

  it('registers the hole shader required by tree-shaken SolidTV apps', async () => {
    const registrations: string[] = []
    const canvas = document.createElement('canvas')
    await registerSolidVideoShader({
      canvas,
      stage: {
        renderer: { mode: 'webgl' },
        shManager: {
          registerShaderType: (name) => { registrations.push(name) },
        },
      },
    })
    expect(registrations).toEqual(['holePunch'])
  })
})
