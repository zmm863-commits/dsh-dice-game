#!/usr/bin/env node
/**
 * Host-half smoke test: exercise the /dice-game route family without a full
 * dsh boot. Verifies file serving, method handling, and 404s.
 */
import { PassThrough } from 'node:stream'
import { makeRoutes, GAME_BASE } from '../lib/index.js'

/** Minimal IncomingMessage-like object for the handlers. */
function fakeReq({ method = 'GET', url = GAME_BASE + '/', headers = {} } = {}) {
  const req = new PassThrough()
  req.method = method
  req.url = url
  req.headers = { host: '127.0.0.1:3080', ...headers }
  req.socket = { remoteAddress: '127.0.0.1' }
  return req
}

/** Collect the handler's response into {status, headers, body}. */
function hit(route, req) {
  return new Promise((resolve) => {
    const res = new PassThrough()
    const chunks = []
    res.writeHead = (status, headers) => { res.statusCode = status; res.headers = headers }
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }))
    route.handler(req, res)
  })
}

const [route] = makeRoutes()
let failures = 0
const check = (name, cond, extra = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : '  ' + extra))
  if (!cond) failures++
}

const cases = [
  ['index at base', GAME_BASE + '/', 200, /骰子大作战/],
  ['index without slash', GAME_BASE, 200, /骰子大作战/],
  ['peerjs.min.js', GAME_BASE + '/peerjs.min.js', 200, /function/],
  ['qrcode.min.js', GAME_BASE + '/qrcode.min.js', 200, /QRCode/],
  ['index.html explicit', GAME_BASE + '/index.html', 200, /骰子大作战/],
  ['traversal rejected', GAME_BASE + '/../package.json', 404, /not found/],
  ['unknown file', GAME_BASE + '/secret.txt', 404, /not found/],
  ['other prefix', '/other', 404, /not found/],
]

for (const [name, url, wantStatus, wantBody] of cases) {
  const res = await hit(route, fakeReq({ url }))
  check(name + ' → ' + res.status, res.status === wantStatus && wantBody.test(res.body), JSON.stringify(res.headers))
}

// HEAD request must return headers but no body.
{
  const res = await hit(route, fakeReq({ method: 'HEAD', url: GAME_BASE + '/' }))
  check('HEAD returns 200 with empty body', res.status === 200 && res.body === '')
}
// POST must be rejected.
{
  const res = await hit(route, fakeReq({ method: 'POST', url: GAME_BASE + '/' }))
  check('POST rejected 405', res.status === 405)
}
// Content-type of the html asset.
{
  const res = await hit(route, fakeReq({ url: GAME_BASE + '/' }))
  check('html content-type', String(res.headers['content-type']).includes('text/html'))
}

console.log(failures === 0 ? '\nAll host-route checks passed ✅' : `\n${failures} check(s) failed ❌`)
process.exit(failures === 0 ? 0 : 1)
