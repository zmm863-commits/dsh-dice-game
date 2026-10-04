/**
 * dsh-dice-game host half: serves the 骰子大作战 (Dice Battle) game's static
 * assets (index.html + peerjs.min.js + qrcode.min.js) under the /dice-game
 * route family, so the browser half's center-column iframe can load the game
 * from the same origin. Also announces the plugin to agents via a
 * system-prompt section so they know the game is installed.
 */

import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
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
 * JEV 决策代理端点。
 *
 * 游戏文档跑在 opaque-origin iframe（sandbox 无 allow-same-origin）里，
 * 拿不到宿主凭据；所以「JEV 难度」必须由宿主带 key 转发，key 永不进浏览器。
 */
export const AI_PATH = GAME_BASE + '/ai'

/** Jev System One 决策端点与模型（免费通道，实测约 800ms、cost 0）。 */
const JEV_ENDPOINT = 'https://opencode.ai/zen/v1/systemone'
const JEV_MODEL = 'jev-1.13-free'
/** 单次局面描述的体积上限（防御性，正常局面只有几百字节）。 */
const AI_MAX_BODY_BYTES = 32 * 1024
/** 上游超时：超过就让游戏侧回退到本地「电脑难度」，不让对局卡死。 */
const AI_TIMEOUT_MS = 15000

/** iframe 的 Origin 是 null，代理必须显式放行跨源。 */
const AI_CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'cache-control': 'no-store',
}

function aiJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...AI_CORS, 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readBodyCapped(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise(resolve => {
    const chunks: Buffer[] = []
    let size = 0
    let overflowed = false
    req.on('data', (c: Buffer) => {
      if (overflowed) return
      size += c.length
      if (size > limit) {
        // 不要 destroy：连接得活着才写得回 413；剩余数据丢弃即可。
        overflowed = true
        resolve(null)
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (!overflowed) resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', () => {
      if (!overflowed) resolve(null)
    })
  })
}

/**
 * 转发一局局面给 Jev，并把原始 answers 透传给游戏。
 * 不缓存、不落盘、不记录 state 内容（局面里含双方骰子）。
 */
async function handleAi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, AI_CORS)
    res.end()
    return
  }
  if (req.method !== 'POST') {
    aiJson(res, 405, { error: 'method-not-allowed' })
    return
  }

  const key = (process.env.OPENCODEZEN_API_KEY ?? '').trim()
  if (!key) {
    aiJson(res, 503, { error: 'jev-key-missing' })
    return
  }

  const raw = await readBodyCapped(req, AI_MAX_BODY_BYTES)
  if (raw === null) {
    aiJson(res, 413, { error: 'body-too-large' })
    return
  }

  let parsed: { state?: unknown; questions?: unknown }
  try {
    parsed = JSON.parse(raw) as { state?: unknown; questions?: unknown }
  } catch {
    aiJson(res, 400, { error: 'bad-json' })
    return
  }
  if (
    typeof parsed.state !== 'string'
    || parsed.state.length === 0
    || !parsed.questions
    || typeof parsed.questions !== 'object'
  ) {
    aiJson(res, 400, { error: 'bad-payload' })
    return
  }

  try {
    const upstream = await fetch(JEV_ENDPOINT, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ model: JEV_MODEL, state: parsed.state, questions: parsed.questions }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    })
    const text = await upstream.text()
    res.writeHead(upstream.status, { ...AI_CORS, 'content-type': 'application/json; charset=utf-8' })
    res.end(text)
  } catch (e) {
    aiJson(res, 502, { error: 'jev-unreachable', detail: String(e) })
  }
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
    let pathname: string
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('bad request')
      return
    }

    // JEV 决策代理（POST）：宿主带 key 转发，游戏侧只看到同源端点。
    if (pathname === AI_PATH) {
      await handleAi(req, res)
      return
    }

    // 其余路径是静态资源，只接受 GET/HEAD。
    const method = req.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' })
      res.end('method not allowed')
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
  '本机已安装 dsh-dice-game 插件（骰子大作战）：侧边栏「🎲 骰子大作战」入口打开游戏面板。能力：经典骰子游戏合集，含吹牛（单人 vs AI）、猜红点、猜红蓝、猜大小、猜单双、猜顺子 6 种玩法；游戏为纯前端 HTML，运行于 /dice-game/。当前为单机版：联机功能暂缓上线（MP_DISABLED），后续按需恢复。限制：游戏为休闲娱乐用途，不含任何真实货币或赌博功能。用户提到「骰子大作战 / 骰子游戏 / 吹牛骰子 / dice game」时即指本插件，可引导其从侧边栏入口打开游戏。'

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
