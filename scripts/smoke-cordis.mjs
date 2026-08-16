#!/usr/bin/env node
/**
 * Cordis host-level smoke test: load the built host half with stubbed
 * webServer / systemPrompt services (mirroring what the dsh host injects),
 * and verify the plugin registers the /dice-game route and the agent
 * announcement without throwing.
 */
import { Context } from '@deepseek-ai/cordis'
import { PassThrough } from 'node:stream'
import { apply, name, inject, GAME_BASE } from '../lib/index.js'

let failures = 0
const check = (n, c, extra = '') => {
  console.log((c ? '  ✓ ' : '  ✗ ') + n + (c ? '' : '  ' + extra))
  if (!c) failures++
}

check('plugin name', name === 'dice-game')
check('inject declares services', Array.isArray(inject) && inject.includes('webServer'))

// ── Stub services ──────────────────────────────────────────────────────────
const registered = []
const sections = []

const ctx = new Context()
ctx.webServer = {
  register(route) {
    registered.push(route)
    return () => { const i = registered.indexOf(route); if (i >= 0) registered.splice(i, 1) }
  },
  registerUpgrade() { return () => {} },
}
ctx.systemPrompt = {
  section(spec) {
    sections.push(spec)
    return () => { const i = sections.indexOf(spec); if (i >= 0) sections.splice(i, 1) }
  },
}

// ── Apply the plugin ───────────────────────────────────────────────────────
apply(ctx, {})

check('route registered', registered.length === 1)
check('route kind prefix', registered[0]?.kind === 'prefix')
check('route path is ' + GAME_BASE, registered[0]?.path === GAME_BASE)
check('prompt section registered', sections.length === 1 && sections[0]?.name === 'plugin:dsh-dice-game')
check('guidance mentions 骰子大作战', (sections[0]?.text ?? '').includes('骰子大作战'))

// The registered route must serve the game index (end-to-end through the handler).
const route = registered[0]
const body = await new Promise((resolve) => {
  const req = new PassThrough()
  req.method = 'GET'
  req.url = GAME_BASE + '/'
  req.headers = { host: '127.0.0.1:3080' }
  req.socket = { remoteAddress: '127.0.0.1' }
  const res = new PassThrough()
  const chunks = []
  res.writeHead = (s, h) => { res.statusCode = s; res.headers = h }
  res.on('data', (c) => chunks.push(c))
  res.on('end', () => resolve(Buffer.concat(chunks).toString()))
  route.handler(req, res)
})
check('end-to-end: route serves the game', body.includes('骰子大作战'))

console.log(failures === 0 ? '\nAll cordis host checks passed ✅' : `\n${failures} check(s) failed ❌`)
process.exit(failures === 0 ? 0 : 1)
