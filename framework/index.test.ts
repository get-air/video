// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'

const frameworkMocks = vi.hoisted(() => ({
  registerIntrinsic: vi.fn(() => vi.fn()),
  registerShader: vi.fn(),
}))

vi.mock('@get-air/framework', () => ({
  createEffect: vi.fn(),
  createSignal: (initial: unknown) => [() => initial, vi.fn()],
  getActiveRenderer: () => ({
    backend: 'webgl',
    canvas: document.createElement('canvas'),
    registerShader: frameworkMocks.registerShader,
  }),
  onCleanup: vi.fn(),
  registerIntrinsic: frameworkMocks.registerIntrinsic,
}))

vi.mock('@get-air/renderer/shaders', () => ({
  HolePunch: { canvas: {}, webgl: {}, webgpu: {} },
}))

import { HolePunch } from '@get-air/renderer/shaders'
import type { IntrinsicContext, UniversalHost } from '@get-air/framework'
import {
  frameworkVideoHole,
  registerFrameworkVideoShader,
  transparentFrameworkRendererOptions,
} from './index'
import { frameworkVideoIntrinsicAdapter } from './intrinsic'

describe('Air framework integration', () => {
  it('builds the backend-neutral hole-punch effect shape', () => {
    expect(
      frameworkVideoHole(
        { x: 120, y: 80, width: 1440, height: 810 },
        18,
      ),
    ).toEqual({
      x: 120,
      y: 80,
      w: 1440,
      h: 810,
      radius: 18,
    })
  })

  it('rejects invalid geometry before renderer registration', () => {
    expect(() =>
      frameworkVideoHole({ x: 0, y: 0, width: 0, height: 810 }),
    ).toThrow(RangeError)
  })

  it('keeps the renderer clear buffer transparent', () => {
    expect(transparentFrameworkRendererOptions).toEqual({
      clearColor: 0x00000000,
      enableClear: true,
    })
  })

  it('registers one backend-neutral shader descriptor', () => {
    registerFrameworkVideoShader()
    expect(frameworkMocks.registerShader).toHaveBeenCalledWith(
      'holePunch',
      HolePunch,
    )
  })

  it('registers the literal video intrinsic on module evaluation', () => {
    expect(frameworkMocks.registerIntrinsic).toHaveBeenCalledWith(
      'video',
      expect.objectContaining({
        create: expect.any(Function),
        update: expect.any(Function),
        dispose: expect.any(Function),
      }),
    )
  })

  it('projects video geometry and semantics through the intrinsic host', () => {
    const parents = new WeakMap<object, object>()
    const properties = new WeakMap<object, Map<string, unknown>>()
    const makeNode = (): object => {
      const node = {}
      properties.set(node, new Map())
      return node
    }
    const host: UniversalHost<object> = {
      createElement: makeNode,
      createTextNode: makeNode,
      replaceText: vi.fn(),
      setProperty: (node, name, value) => properties.get(node)?.set(name, value),
      insertNode: (parent, node) => {
        parents.set(node, parent)
      },
      removeNode: (_parent, node) => {
        parents.delete(node)
      },
      getParentNode: (node) => parents.get(node),
      getFirstChild: () => undefined,
      getNextSibling: () => undefined,
      isTextNode: () => false,
    }
    const context: IntrinsicContext = {
      name: 'video',
      host,
      environment: { platform: 'web' },
    }
    const instance = frameworkVideoIntrinsicAdapter.create(context)
    const parent = host.createElement('view')
    frameworkVideoIntrinsicAdapter.update(instance, 'id', 'preview', context)
    frameworkVideoIntrinsicAdapter.update(instance, 'x', 80, context)
    frameworkVideoIntrinsicAdapter.update(instance, 'y', 96, context)
    frameworkVideoIntrinsicAdapter.update(instance, 'width', 1760, context)
    frameworkVideoIntrinsicAdapter.update(instance, 'height', 744, context)
    frameworkVideoIntrinsicAdapter.update(
      instance,
      'aria-label',
      'Feature presentation',
      context,
    )
    frameworkVideoIntrinsicAdapter.insert(instance, parent, undefined, context)

    expect(frameworkVideoIntrinsicAdapter.geometry?.(instance, context)).toEqual(
      {
        id: 'preview',
        rect: { x: 80, y: 96, width: 1760, height: 744 },
      },
    )
    expect(
      frameworkVideoIntrinsicAdapter.semantics?.(instance, context),
    ).toEqual({
      id: 'preview',
      role: 'video',
      label: 'Feature presentation',
      valueText: 'paused',
    })

    frameworkVideoIntrinsicAdapter.remove(instance, parent, context)
    frameworkVideoIntrinsicAdapter.dispose(instance, context)
  })
})
