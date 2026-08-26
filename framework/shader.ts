import {
  getActiveRenderer,
  type RendererBridge,
} from '@get-air/framework'
import { HolePunch } from '@get-air/renderer/shaders'

const registeredRenderers = new WeakSet<RendererBridge>()

export function ensureFrameworkVideoShader(
  renderer: RendererBridge = getActiveRenderer(),
): void {
  if (registeredRenderers.has(renderer)) return
  renderer.registerShader('holePunch', HolePunch)
  registeredRenderers.add(renderer)
}

export function registerFrameworkVideoShader(): void {
  ensureFrameworkVideoShader()
}
