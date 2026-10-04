#!/usr/bin/env node
/**
 * 「JEV 难度」游戏侧验收：两档难度切换 + JEV 决策路径 + 上游不可用时的回退。
 *
 * 配合 smoke-jev-proxy.mjs（宿主侧代理）一起看：
 *   - 代理保证「key 不进浏览器、且 opaque-origin 也能取到响应」；
 *   - 本脚本保证「游戏真的会去用它，且用不了时不会把对局卡死」。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM, VirtualConsole } from 'jsdom'

const root = dirname(fileURLToPath(new URL('./../package.json', import.meta.url)))
let failures = 0
const check = (name, cond, extra = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : '  ' + extra))
  if (!cond) failures++
}

const rawHtml = readFileSync(join(root, 'lib/assets/index.html'), 'utf8')
const html = rawHtml
  .replace('<script src="peerjs.min.js"></script>', '')
  .replace('<script src="qrcode.min.js"></script>', '')
const errors = []
const vc = new VirtualConsole()
vc.on('jsdomError', (e) => errors.push(String((e && e.message) || e)))
const dom = new JSDOM(html, {
  url: 'http://127.0.0.1:3080/dice-game/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
})
const w = dom.window
const ev = (code) => w.eval(code)
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms))

await tick(1200)

// ── 1. 只保留两档难度 ─────────────────────────────────────────────────────
console.log('[JEV-D1] 两档难度')
ev("setAiLevel('jev')")
check("setAiLevel('jev') → liarLevel = jev", ev('liarLevel') === 'jev')
check('JEV 档不参与本地连败降档', ev('loseProtectActive = true; effectiveLiarLevel()') === 'jev')
ev("setAiLevel('master')")
check("setAiLevel('master') → liarLevel = master", ev('liarLevel') === 'master')
check('连败保护在电脑难度下仍然降档（normal）', ev("loseProtectActive = true; effectiveLiarLevel()") === 'normal')
ev("setAiLevel('rookie')")
check('旧档位被归一为 master（只剩两档）', ev('liarLevel') === 'master')
ev('loseProtectActive = false')

// ── 2. JEV 决策路径 ───────────────────────────────────────────────────────
console.log('[JEV-D2] JEV 决策路径')
ev(`
  window.__jevCalls = [];
  window.fetch = function (url, opts) {
    window.__jevCalls.push({ url: url, body: JSON.parse(opts.body) });
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve(window.__nextJevReply); } });
  };
  setAiLevel('jev');
  gamePhase = 'bidding'; currentTurn = 1; currentBid = null;
  computerDice = [2, 2, 5, 6, 1]; playerDice = [3, 3, 4, 4, 6];
  window.__nextJevReply = { answers: { action: { choice: 'raise' } } };
  computerTurn();
`)
await tick(80)
const calls = JSON.parse(ev('JSON.stringify(window.__jevCalls)'))
check('JEV 档下 computerTurn 调用了同源代理端点', calls.length === 1 && calls[0].url === 'ai')
check('提交的局面文本含「我的骰子」', typeof calls[0].body.state === 'string' && calls[0].body.state.indexOf('我的骰子') >= 0)
check('提交了 action(choice) 问题', !!(calls[0].body.questions && calls[0].body.questions.action))
check('Jev 回 raise → 电脑完成一次加注', ev('currentTurn') === 0 && ev('currentBid !== null') === true)

// ── 3. Jev 判质疑 → 转入开盅 ──────────────────────────────────────────────
console.log('[JEV-D3] Jev 判质疑 → 开盅')
ev(`
  gamePhase = 'bidding'; currentTurn = 1; currentBid = { count: 6, value: 2 };
  computerDice = [2, 2, 5, 6, 1]; playerDice = [3, 3, 4, 4, 6];
  window.__nextJevReply = { answers: { action: { choice: 'challenge' } } };
  computerTurn();
`)
await tick(120)
check('质疑后不再停留在 bidding 阶段', ev('gamePhase') !== 'bidding')

// ── 4. 上游不可用 → 回退本地，不卡死 ─────────────────────────────────────
console.log('[JEV-D4] Jev 不可用时的回退')
ev(`
  window.fetch = function () { return Promise.reject(new Error('offline')); };
  setAiLevel('jev');
  gamePhase = 'bidding'; currentTurn = 1; currentBid = null;
  computerDice = [4, 4, 5, 6, 3]; playerDice = [1, 2, 3, 4, 5];
  computerTurn();
`)
await tick(120)
check('回退后电脑仍然落子（对局不卡死）', ev('currentTurn') === 0 || ev('gamePhase') !== 'bidding')

// ── 5. 六玩法都接入 JEV ───────────────────────────────────────────────────
console.log('[JEV-D5] 六玩法 JEV 接入')
const ALL_MODES = ['liar', 'red', 'redblue', 'bigsmall', 'oddeven', 'straight']
const TURN_FN = {
  liar: 'computerTurn', red: 'computerRedTurn', straight: 'computerStraightTurn',
  bigsmall: 'computerBigSmallTurn', oddeven: 'computerOddEvenTurn', redblue: 'computerRedBlueTurn',
}
const OPEN_BID = {
  liar: '{ count: 3, value: 2 }', red: '{ total: 10 }', straight: '{ len: 2 }',
  redblue: '{ red: 3, blue: 4 }', bigsmall: '{ small: 3, big: 4 }', oddeven: '{ odd: 3, even: 4 }',
}
for (const m of ALL_MODES) {
  const ask = JSON.parse(ev("JSON.stringify(buildJevAsk('" + m + "'))"))
  check('[' + m + '] state 含「我的骰子」', typeof ask.state === 'string' && ask.state.indexOf('我的骰子') >= 0)
  check('[' + m + '] 有 believe(noul) 与 action(choice)',
    ask.questions && ask.questions.believe.type === 'noul' && ask.questions.action.type === 'choice')
}
ev('computerDice = [1,2,3,4,5]; currentBid = null;')
for (const m of ALL_MODES) {
  const r = JSON.parse(ev("JSON.stringify(localLegalBidByMode('" + m + "'))"))
  check('[' + m + '] 本地回退能给出合法叫点', r.action === 'bid')
}
// Jev 一律回 challenge → 六个玩法的回合都应转入开盅
ev(`
  window.fetch = function () {
    return Promise.resolve({ ok: true, json: function () {
      return Promise.resolve({ answers: { action: { choice: 'challenge' } } });
    } });
  };
  setAiLevel('jev');
`)
for (const m of ALL_MODES) {
  ev(`
    gameMode = '${m}';
    gamePhase = 'bidding'; currentTurn = 1;
    currentBid = ${OPEN_BID[m]};
    playerDice = [1,2,3,4,5]; computerDice = [6,6,6,6,6];
  `)
  ev(TURN_FN[m] + '()')
  await tick(90)
  check('[' + m + '] Jev 判质疑 → 离开 bidding', ev('gamePhase') !== 'bidding')
}

// ── 6. 运行期错误 ─────────────────────────────────────────────────────────
console.log('[JEV-D6] 运行期错误')
check('无未捕获错误', errors.length === 0, errors.slice(0, 2).join(' | '))

console.log(failures === 0
  ? '\nAll JEV difficulty checks passed ✅'
  : '\n' + failures + ' JEV difficulty check(s) FAILED ❌')
dom.window.close()
process.exit(failures === 0 ? 0 : 1)
