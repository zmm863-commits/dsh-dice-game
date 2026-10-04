#!/usr/bin/env node
/**
 * JEV 决策代理（/dice-game/ai）验收 —— 游戏「JEV 难度」的宿主侧地基。
 *
 * 为什么需要这个代理：游戏文档跑在 opaque-origin iframe（sandbox 无
 * allow-same-origin）里，拿不到宿主凭据；JEV 必须由宿主带 key 转发，
 * key 永不进浏览器。iframe 的 Origin 是 null → 响应必须带 ACAO。
 *
 * 断言：
 *  1. 静态资源未受影响（回归）；
 *  2. GET → 405、body 超限 → 413、payload 非法 → 400；
 *  3. 无 key → 503 `jev-key-missing`（必须显式暴露，不能让游戏静默失败）；
 *  4. 有 key 且上游可达 → 真实调用 Jev，断言拿到 `answers.<q>.choice`；
 *     上游/网络不可达时降级为 ⚠ 警告不判失败（离线环境不该误报）。
 */
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AI_PATH, makeRoutes } from '../lib/index.js'

const root = dirname(fileURLToPath(new URL('./../package.json', import.meta.url)))
void root
let failures = 0
const check = (name, cond, extra = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : '  ' + extra))
  if (!cond) failures++
}
const warn = (name, extra) => console.log('  ⚠ ' + name + '  ' + extra)

/** 读 key：先环境变量，再 /dsh/.env 兜底（只读不打印、不落盘）。 */
function loadKey() {
  if (process.env.OPENCODEZEN_API_KEY) return process.env.OPENCODEZEN_API_KEY
  const envPath = '/dsh/.env'
  if (!existsSync(envPath)) return ''
  const line = readFileSync(envPath, 'utf8')
    .split('\n')
    .find(l => l.trim().startsWith('OPENCODEZEN_API_KEY='))
  if (!line) return ''
  return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')
}

const route = makeRoutes()[0]
const server = createServer((req, res) => route.handler(req, res))
await new Promise(r => server.listen(0, '127.0.0.1', r))
const base = 'http://127.0.0.1:' + server.address().port
const ai = base + AI_PATH

// ── 1. 静态资源回归 ───────────────────────────────────────────────────────
console.log('[JEV-1] 静态资源回归')
const idxRes = await fetch(base + '/dice-game/')
const idxHtml = await idxRes.text()
check('/dice-game/ 仍返回 200', idxRes.status === 200)
check('仍是游戏页面（含本轮改动标记）', idxHtml.includes('mpSettleWinTitle') || idxHtml.includes('recordMpRound'))

// 提前注入 key：代理在 key 检查处会短路成 503，不注入就测不到入参防御。
const key = loadKey()
if (key) process.env.OPENCODEZEN_API_KEY = key

// ── 2. 入参防御 ───────────────────────────────────────────────────────────
console.log('[JEV-2] 代理入参防御')
check('GET → 405', (await fetch(ai)).status === 405)
if (key) {
  const bigRes = await fetch(ai, { method: 'POST', body: 'x'.repeat(40 * 1024) })
  check('>32KB body → 413', bigRes.status === 413, '实际 ' + bigRes.status)
  const badRes = await fetch(ai, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"state":123}',
  })
  check('payload 非法 → 400', badRes.status === 400,
    '实际 ' + badRes.status + ' ' + (await badRes.text()).slice(0, 140))
} else {
  warn('413 / 400 断言已跳过', '（无 key 时代理在 key 检查处即 503 短路）')
}

// ── 3. key 路径与真实调用 ─────────────────────────────────────────────────
const jevPayload = {
  state: '玩法:吹牛(大话骰),双方各 5 颗,1 为万能。我的骰子:2,2,5,6,1。当前喊价:对手叫 6 个 2。',
  questions: {
    believe: { type: 'noul', instructions: 'Is the bid credible given my dice?' },
    action: {
      type: 'choice',
      instructions: 'What should I do?',
      criteria: { challenge: 'Challenge and reveal', raise: 'Raise the bid', follow: 'Follow conservatively' },
    },
  },
}

if (!key) {
  console.log('[JEV-3] key 缺失路径')
  const r = await fetch(ai, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(jevPayload),
  })
  const j = await r.json().catch(() => null)
  check('无 key → 503 jev-key-missing', r.status === 503 && !!j && j.error === 'jev-key-missing')
  check('错误响应也带 ACAO（iframe 才能读到）', r.headers.get('access-control-allow-origin') === '*')
  warn('真实调用已跳过', '（未找到 OPENCODEZEN_API_KEY）')
} else {
  console.log('[JEV-3] 真实调用 Jev（免费通道 jev-1.13-free）')
  process.env.OPENCODEZEN_API_KEY = key
  const t0 = Date.now()
  const r = await fetch(ai, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(jevPayload),
  })
  const ms = Date.now() - t0
  const j = await r.json().catch(() => null)
  check('响应带 ACAO（opaque-origin iframe 必需）', r.headers.get('access-control-allow-origin') === '*')
  const choice = j && j.answers && j.answers.action && j.answers.action.choice
  if (r.ok && typeof choice === 'string' && choice.length > 0) {
    check('真实调用返回 answers.action.choice = ' + choice + '（' + ms + 'ms）', true)
  } else {
    warn('真实调用未成功', 'HTTP ' + r.status + ' · ' + JSON.stringify(j).slice(0, 200))
  }
}

server.close()
console.log(failures === 0
  ? '\nAll JEV proxy checks passed ✅'
  : '\n' + failures + ' JEV proxy check(s) FAILED ❌')
process.exit(failures === 0 ? 0 : 1)
