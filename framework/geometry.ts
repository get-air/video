import type { HolePunchShaderProps } from '@get-air/framework'

import type { CanvasVideoRect } from '../canvas/index'

export function frameworkVideoHole(
  rect: CanvasVideoRect,
  radius = 0,
): HolePunchShaderProps {
  if (
    ![rect.x, rect.y, rect.width, rect.height, radius].every(
      Number.isFinite,
    ) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    radius < 0
  ) {
    throw new RangeError(
      'Air framework video geometry must be finite with positive dimensions and a non-negative radius',
    )
  }

  return {
    x: rect.x,
    y: rect.y,
    w: rect.width,
    h: rect.height,
    radius,
  }
}
