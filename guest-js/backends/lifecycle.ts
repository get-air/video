export async function startController<Controller extends {
  start(): Promise<void>; destroy(): Promise<void>
}>(
  controller: Controller,
): Promise<Controller> {
  try {
    await controller.start()
    return controller
  } catch (error) {
    await controller.destroy().catch(() => undefined)
    throw error
  }
}
