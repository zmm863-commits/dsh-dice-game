/**
 * dsh-dice-game panel view mounting.
 *
 * The `conversation` slot is single-occupant (ui-conversation) and external
 * plugins cannot declare slots, so the panel takes over the center column at
 * the DOM level: a container is appended inside the `[data-pane="conversation"]`
 * grid item (an extra trailing child React never manages), and a stylesheet
 * rule hides the conversation content while the panel is active. Toggling is
 * a data attribute on <html> — no React involvement, so the conversation
 * subtree underneath stays mounted and stateful.
 *
 * The panel content is an <iframe> loading the game from the host route
 * (/dice-game/), served by the host half. The iframe keeps the game sandboxed
 * from the GUI while still being same-origin (WebRTC / PeerJS works).
 */
import type { PanelController } from './controller.ts'
import { injectStyles } from './styles.ts'

/** The injected panel container (kept in the DOM, hidden when inactive). */
export const PANEL_VIEW_SELECTOR = '[data-dsh-dicegame-view]'

const CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"]'
const ACTIVE_ATTR = 'data-dsh-dicegame-active'
/** The sibling panels' activation attributes, removed when this panel opens. */
const OTHER_ACTIVE_ATTRS = ['data-dsh-taskboard-active', 'data-dsh-ssh-active']
/** Cross-plugin activation event; detail is the activating panel name. */
const ACTIVATE_EVENT = 'dsh-panel-activate'
const PANEL_NAME = 'dicegame'

/** Find the center column, or undefined while the frame is not mounted. */
function conversationColumn(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(CONVERSATION_COLUMN_SELECTOR) ?? undefined
}

/** The game's index URL (same origin, served by the host half).
 *
 * The query string carries the DSH-host context into the game:
 *  - `room`: a room code present in the GUI's own URL (?room=…) — the game
 *    auto-opens the join overlay pre-filled with it (mpCheckRoomParam).
 *  - `diceBase`: an optional public base URL (from the GUI URL ?diceBase=…
 *    or localStorage dicePublicBase) — the game uses it to build shareable
 *    invite links (mpBuildJoinUrl) instead of degrading to room-code only.
 * Without diceBase the game still works fully; sharing just degrades to the
 * room-code card, which is correct for a DSH-embedded (non-public) origin.
 */
function gameUrl(): string {
  const params = new URLSearchParams(window.location.search)
  const qs: string[] = []
  const room = params.get('room')
  if (room) qs.push('room=' + encodeURIComponent(room))
  let diceBase = params.get('diceBase')
  if (!diceBase) {
    try { diceBase = localStorage.getItem('dicePublicBase') ?? '' } catch { diceBase = '' }
  }
  if (diceBase) qs.push('diceBase=' + encodeURIComponent(diceBase))
  const suffix = qs.length > 0 ? '?' + qs.join('&') : ''
  return location.origin + '/dice-game/' + suffix
}

/**
 * Mount the game panel into the center column and bind its visibility to the
 * controller's panelOpen state.
 * @param controller - the panel controller driving the view.
 * @returns disposer tearing the panel down and restoring the column.
 */
export function mountPanel(controller: PanelController): () => void {
  injectStyles()

  let container: HTMLDivElement | undefined
  let iframe: HTMLIFrameElement | undefined

  const ensure = (): void => {
    if (container !== undefined) {
      if (container.isConnected) return
      // The conversation pane was replaced; drop the stale tree and remount.
      container.remove()
      container = undefined
      iframe = undefined
    }
    const column = conversationColumn()
    if (column === undefined) return

    container = document.createElement('div')
    container.dataset.dshDicegameView = ''
    container.className = 'dsh-dicegame-view'

    // ── Title bar: name + reload + close ──────────────────────────────
    const bar = document.createElement('div')
    bar.className = 'dsh-dicegame-bar'
    const title = document.createElement('span')
    title.className = 'dsh-dicegame-title'
    title.textContent = '🎲 骰子大作战'
    const reload = document.createElement('button')
    reload.type = 'button'
    reload.className = 'dsh-dicegame-bar-btn'
    reload.textContent = '↻'
    reload.title = '重新加载游戏'
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'dsh-dicegame-bar-btn'
    close.textContent = '✕'
    close.title = '关闭游戏'
    close.addEventListener('click', () => { controller.close() })
    bar.append(title, reload, close)

    // ── Game iframe ───────────────────────────────────────────────────
    iframe = document.createElement('iframe')
    iframe.className = 'dsh-dicegame-frame'
    iframe.src = gameUrl()
    iframe.setAttribute('allow', 'camera; microphone; autoplay')
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups')
    reload.addEventListener('click', () => {
      if (iframe === undefined) return
      // Force a fresh document so the game resets completely.
      iframe.src = 'about:blank'
      // Defer re-navigation out of the current task so the blank commit lands.
      setTimeout(() => { if (iframe !== undefined) iframe.src = gameUrl() }, 0)
    })

    container.append(bar, iframe)
    column.appendChild(container)
  }

  // The frame mounts after boot settlement; watch for the column's arrival.
  const waitObserver = new MutationObserver(() => { ensure() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  const applyActive = (): void => {
    if (controller.getSnapshot().panelOpen) {
      // Single-occupant center column: opening this panel must evict the
      // sibling panels (task board / ssh), both their html attributes and
      // their controller state, otherwise the panels' visibility rules fight
      // and the second click appears dead.
      for (const attr of OTHER_ACTIVE_ATTRS) document.documentElement.removeAttribute(attr)
      document.documentElement.setAttribute(ACTIVE_ATTR, '')
      document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }))
    } else {
      document.documentElement.removeAttribute(ACTIVE_ATTR)
    }
  }
  const onOtherActivate = (event: Event): void => {
    const detail = (event as CustomEvent).detail
    if ((detail === 'ssh' || detail === 'taskboard') && controller.getSnapshot().panelOpen) {
      controller.close()
    }
  }
  // Jump out on sidebar context clicks: clicking a session/workspace row
  // (including the already-current one, which produces no session-change
  // event) hands the center column back to the conversation. Capture phase,
  // so the panel closes before the shell processes the click.
  const SIDEBAR_ROW_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]'
  const onClickSidebarRow = (event: MouseEvent): void => {
    if (!controller.getSnapshot().panelOpen) return
    const target = event.target as HTMLElement | null
    if (target === null) return
    if (target.closest(SIDEBAR_ROW_SELECTOR) !== null) controller.close()
  }
  document.addEventListener('click', onClickSidebarRow, true)
  document.addEventListener(ACTIVATE_EVENT, onOtherActivate)
  const unsubscribe = controller.subscribe(applyActive)
  applyActive()
  ensure()

  return () => {
    document.removeEventListener('click', onClickSidebarRow, true)
    document.removeEventListener(ACTIVATE_EVENT, onOtherActivate)
    waitObserver.disconnect()
    unsubscribe()
    document.documentElement.removeAttribute(ACTIVE_ATTR)
    iframe?.remove()
    iframe = undefined
    container?.remove()
    container = undefined
  }
}
