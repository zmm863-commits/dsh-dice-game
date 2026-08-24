/**
 * dsh-dice-game panel view mounting.
 *
 * The `conversation` slot is single-occupant (ui-conversation) and external
 * plugins cannot declare slots, so the panel takes over the center column at
 * the DOM level: a container is appended inside the center-column grid item
 * (an extra trailing child React never manages), and a stylesheet
 * rule hides the conversation content while the panel is active. Toggling is
 * a data attribute on <html> — no React involvement, so the conversation
 * subtree underneath stays mounted and stateful.
 *
 * The panel content is an <iframe> loading the game from the host route
 * (/dice-game/), served by the host half. The iframe is an opaque-origin
 * sandbox (no allow-same-origin): the game document is fully isolated from
 * the GUI — no page DOM, cookies, localStorage or same-origin DSH API access.
 * PeerJS/WebRTC still works because signaling goes over wss:// to the PeerJS
 * cloud, which is origin-independent.
 */
import type { PanelController } from './controller.ts'
import { injectStyles } from './styles.ts'

/** The injected panel container (kept in the DOM, hidden when inactive). */
export const PANEL_VIEW_SELECTOR = '[data-dsh-dicegame-view]'

// The rc.7+ web shell hashes its layout classes (no stable data-pane
// attributes); the center column is identified by the module-scoped
// `centerCol` class. Fall back to the older data-pane attribute for
// pre-rc.7 shells.
const CONVERSATION_COLUMN_SELECTOR = '[class*="centerCol"], [data-pane="conversation"]'
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

// ── DICE-SAVE v1 postMessage 存储桥（宿主侧） ────────────────────────────
// The game iframe is opaque-origin (no allow-same-origin), so the game cannot
// touch localStorage: every attempt throws a SecurityError. Persistence works
// through this bridge instead: the game posts dice-get/dice-set requests, and
// the HOST page performs the localStorage access on its behalf.
//
// Security model: the iframe's origin is the string "null", so an allow-list
// of origins cannot work. The host authenticates messages by REFERENCE:
// event.source must be the live contentWindow of OUR iframe element. Keys are
// pinned to an explicit dice_* whitelist, values are size-capped JSON strings.
const DICE_SAVE_CHANNEL = 'DICE-SAVE'
const DICE_SAVE_VERSION = 1
/** Explicit persistence key whitelist (all game-owned, all dice_-prefixed). */
const DICE_SAVE_KEYS: ReadonlySet<string> = new Set([
  'dice_lang',
  'dice_stats',
  'dice_muted',
  'dice_streak',
  'dice_tasks',
  'dice_ai_level',
  'dice_fx',
])
/** Hard cap on one stored value (JSON text bytes) — truncation defense. */
const DICE_SAVE_MAX_VALUE_BYTES = 64 * 1024

interface DiceSaveMessage {
  v?: unknown
  ch?: unknown
  cmd?: unknown
  key?: unknown
  json?: unknown
  req?: unknown
}

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length

const isDiceSaveKey = (key: unknown): key is string =>
  typeof key === 'string' && key.startsWith('dice_') && DICE_SAVE_KEYS.has(key)

/** Read-through host localStorage; corrupt JSON reads as null (self-heals). */
const diceHostGet = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const diceHostSet = (key: string, json: string): boolean => {
  if (utf8Bytes(json) > DICE_SAVE_MAX_VALUE_BYTES) return false
  try {
    localStorage.setItem(key, json)
    return true
  } catch {
    return false
  }
}

/**
 * Install the host-side half of the storage bridge for the given frame getter.
 * @param getFrame - returns the current game iframe (may be undefined between mounts).
 * @returns disposer removing the window message listener.
 */
export function installDiceStorageBridge(getFrame: () => HTMLIFrameElement | undefined): () => void {
  const onMessage = (event: MessageEvent): void => {
    // Reference comparison, NOT origin matching — opaque origin is "null".
    const frame = getFrame()
    if (frame === undefined || frame.contentWindow === null) return
    if (event.source !== frame.contentWindow) return
    const data = event.data as DiceSaveMessage | null | undefined
    if (data === null || typeof data !== 'object') return
    if (data.ch !== DICE_SAVE_CHANNEL || data.v !== DICE_SAVE_VERSION) return
    const win = frame.contentWindow
    const reply = (payload: Record<string, unknown>): void => {
      try {
        win.postMessage({ v: DICE_SAVE_VERSION, ch: DICE_SAVE_CHANNEL, ...payload }, '*')
      } catch {
        // Frame navigated away mid-handshake; nothing to do.
      }
    }
    const req = typeof data.req === 'string' ? data.req : ''
    switch (data.cmd) {
      case 'hello':
        // Announce the backing store kind ('ls' when host localStorage works).
        let lsOk = true
        try { localStorage.setItem('__dice_probe_h', '1'); localStorage.removeItem('__dice_probe_h') } catch { lsOk = false }
        reply({ cmd: 'ready', storage: lsOk ? 'ls' : 'mem', req })
        break
      case 'dice-get': {
        const json = isDiceSaveKey(data.key) ? diceHostGet(data.key) : null
        reply({ cmd: 'dice-data', key: data.key, json, req })
        break
      }
      case 'dice-set': {
        const ok = isDiceSaveKey(data.key) && typeof data.json === 'string' && diceHostSet(data.key, data.json)
        reply({ cmd: 'dice-ok', key: data.key, ok, req })
        break
      }
      default:
        break
    }
  }
  window.addEventListener('message', onMessage)
  return () => { window.removeEventListener('message', onMessage) }
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

  // P0① 持久化：opaque iframe 的存储由宿主代存（DICE-SAVE v1）
  const removeStorageBridge = installDiceStorageBridge(() => iframe)

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
    // Opaque-origin sandbox: no allow-same-origin, so the game document is
    // isolated from the GUI — it cannot read the page's DOM, cookies or
    // localStorage, nor call same-origin DSH APIs. Scripts/forms/popups are
    // still allowed (the game is self-contained JS + PeerJS WebRTC).
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups')
    // PeerJS WebRTC needs real ICE candidates; the iframe stays opaque-origin
    // but WebRTC signaling goes over wss:// to the PeerJS cloud, not the GUI.
    iframe.allow = 'camera; microphone; autoplay; display-capture'
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
    removeStorageBridge()
    document.documentElement.removeAttribute(ACTIVE_ATTR)
    iframe?.remove()
    iframe = undefined
    container?.remove()
    container = undefined
  }
}
