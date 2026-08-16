/**
 * Browser-half entry for the dsh-dice-game plugin — runs inside the dsh web
 * GUI. Mounts the two DOM surfaces: the sidebar entry row (toggles the game
 * panel) and the game panel in the center column (an iframe loading the game
 * from the host route /dice-game/). Failure policy: DOM mounting problems are
 * logged, never thrown — the web shell fails the whole boot when a plugin
 * apply throws, and an external plugin must not take the GUI down.
 *
 * Export discipline (packages/client rule): the /client surface carries what
 * cordis loading needs plus types only — all value exports stay internal.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { PanelController } from './controller.ts'
import { mountPanel } from './mount.ts'
import { mountSidebarEntry } from './sidebar-entry.ts'

/** Required services (fiber inject waiting — the runtime must be up first). */
export const inject = ['slots']

/** Type-only surface (export discipline: no value exports beyond the plugin contract). */
export type { PanelControllerSnapshot } from './controller.ts'

/**
 * Mount the dice game sidebar entry and panel.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const controller = new PanelController()
  const disposers: Array<() => void> = []
  try {
    disposers.push(mountSidebarEntry(controller))
    disposers.push(mountPanel(controller))
  } catch (error) {
    // DOM failures degrade the panel, never the GUI.
    console.warn('[dsh-dice-game] mount failed:', error)
  }
  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) dispose()
  }, 'dsh-dice-game: ui mounts')
}
