/**
 * dsh-dice-game host half: serves the 骰子大作战 (Dice Battle) game's static
 * assets (index.html + peerjs.min.js + qrcode.min.js) under the /dice-game
 * route family, so the browser half's center-column iframe can load the game
 * from the same origin. Also announces the plugin to agents via a
 * system-prompt section so they know the game is installed.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

/** Stable cordis plugin name. */
export const name = 'dice-game'

/** Services required before the game surfaces can mount. */
export const inject = ['webServer', 'systemPrompt']

/** Base path of every game route. */
export const GAME_BASE = '/dice-game'

/**
 * Route-family dependencies — kept as a function so tests can inject a
 * different assets directory.
 */
export interface DiceGameRouteDeps {
  /** Directory containing index.html / peerjs.min.js / qrcode.min.js. */
  assetsDir?: string
}

/** Absolute path to the packaged assets directory (lib/assets at runtime). */
const DEFAULT_ASSETS_DIR = fileURLToPath(new URL('./assets/', import.meta.url))

/** Content-type map for the three served files. */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
}

/**
 * The whitelist of served files. The game's index.html references
 * peerjs.min.js and qrcode.min.js relatively, so the route family must expose
 * exactly these names. Everything else is 404 — no directory traversal, no
 * surprise files.
 */
function fileFor(pathname: string): string | undefined {
  if (pathname === GAME_BASE || pathname === GAME_BASE + '/') return 'index.html'
  if (!pathname.startsWith(GAME_BASE + '/')) return undefined
  const name = pathname.slice(GAME_BASE.length + 1)
  if (name === 'peerjs.min.js' || name === 'qrcode.min.js' || name === 'index.html') return name
  return undefined
}

/**
 * Build the /dice-game route family (one prefix route serving the game's
 * three static files).
 * @param deps - optional overrides (assets dir) for tests.
 * @returns the route registrations.
 */
export function makeRoutes(deps: DiceGameRouteDeps = {}): WebRoute[] {
  const assetsDir = deps.assetsDir ?? DEFAULT_ASSETS_DIR

  const readAsset = (name: string): Buffer => readFileSync(assetsDir + '/' + name)

  const handler: WebRoute['handler'] = async (req, res) => {
    // Only GET/HEAD make sense for static assets.
    const method = req.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' })
      res.end('method not allowed')
      return
    }
    let pathname: string
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('bad request')
      return
    }
    const file = fileFor(pathname)
    if (file === undefined) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found')
      return
    }
    let body: Buffer
    try {
      body = readAsset(file)
    } catch {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('asset missing')
      return
    }
    const ext = file.slice(file.lastIndexOf('.'))
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
      'content-length': String(body.length),
      // The game is updated in place by this plugin; never cache stale copies.
      'cache-control': 'no-cache',
      'referrer-policy': 'no-referrer',
    })
    if (method === 'GET') res.end(body)
    else res.end()
  }

  return [{ kind: 'prefix', path: GAME_BASE, handler }]
}

/** Model-facing announcement: plugin presence and what it offers. */
export const DICE_GAME_GUIDANCE =
  '本机已安装 dsh-dice-game 插件（骰子大作战）：侧边栏「🎲 骰子大作战」入口打开游戏面板。能力：经典骰子游戏合集，含吹牛（单人 vs AI 与 PeerJS WebRTC 联机）、猜红点、猜红蓝、猜大小、猜单双、猜顺子 6 种玩法；游戏为纯前端 HTML，运行于 /dice-game/。限制：联机模式依赖 PeerJS 公共信令服务器（国内可能需科学上网）；游戏为休闲娱乐用途，不含任何真实货币或赌博功能。用户提到「骰子大作战 / 骰子游戏 / 吹牛骰子 / dice game」时即指本插件，可引导其从侧边栏入口打开游戏。'

/** Section order within the tool-guidance band. */
const SECTION_ORDER = 300

/**
 * Mount the game's static routes and the agent announcement.
 * @param ctx - host plugin context carrying webServer/systemPrompt.
 */
export function apply(ctx: Context): void {
  const routes = makeRoutes()
  ctx.effect(
    () => {
      const disposers = routes.map(route => ctx.webServer.register(route))
      return () => { for (const dispose of disposers) dispose() }
    },
    'dsh-dice-game: routes',
  )
  ctx.effect(
    () => ctx.systemPrompt.section({
      name: 'plugin:dsh-dice-game',
      order: SECTION_ORDER,
      text: DICE_GAME_GUIDANCE,
    }),
    'dsh-dice-game: prompt section',
  )
}
