#!/usr/bin/env node
/**
 * ③.1 AI 决策参数化验收。
 *
 * 目标：把 AI 决策从「读全局」改成「纯参数」，从而同一份逻辑能同时服务
 * 真人对手、无头对局模拟（全 AI 真打）、以及 JEV 不可用时的回退。
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
await new Promise((r) => setTimeout(r, 1200))

// ── 1. 纯参数化：不读全局 ─────────────────────────────────────────────────
console.log('[AP-1] 纯参数化')
// 注意：内部含 aiNoise 随机噪声，不能用「两次结果全等」来验证纯参数化；
// 改用与噪声无关的必吹局面——若它偷读全局 currentBid，结论就会翻转。
ev('computerDice = [6,6,6,6,6]; currentBid = { count: 3, value: 2 };')
const a1 = ev("aiDecideLiarPure([1,2,3,4,5], { count: 10, value: 6 }, 'master').action")
ev('computerDice = [1,1,1,1,1]; currentBid = null; liarLevel = "master";')
const a2 = ev("aiDecideLiarPure([1,2,3,4,5], { count: 10, value: 6 }, 'master').action")
check('决策只认传入参数，不随全局 currentBid 翻转', a1 === 'challenge' && a2 === 'challenge', a1 + ' / ' + a2)
check('必吹局面（叫 10 个 6，我只有 1 个 6）判质疑',
  JSON.parse(ev("JSON.stringify(aiDecideLiarPure([1,2,3,4,5], { count: 10, value: 6 }, 'master'))")).action === 'challenge')
check('低叫点会选择加注而非开盅',
  JSON.parse(ev("JSON.stringify(aiDecideLiarPure([2,2,2,2,2], { count: 2, value: 2 }, 'master'))")).action === 'bid')

// ── 2. 纯判定函数 ─────────────────────────────────────────────────────────
console.log('[AP-2] 纯判定')
// [3,3,1,5,6] 中 3 与万能 1 共 3 个；对手全 2 → 全场共 3 个 → 叫 2 个成立、叫 5 个不成立
check('liarBidHolds：叫 2 个 3 成立', ev("liarBidHolds({ count: 2, value: 3 }, [3,3,1,5,6], [2,2,2,2,2])") === true)
check('liarBidHolds：叫 5 个 3 不成立', ev("liarBidHolds({ count: 5, value: 3 }, [3,3,1,5,6], [2,2,2,2,2])") === false)

// ── 3. 无头模拟 ───────────────────────────────────────────────────────────
console.log('[AP-3] 无头真模拟')
const results = []
for (let i = 0; i < 40; i++) {
  results.push(ev("simulateLiarGame(tntRollDice(5), tntRollDice(5), 'master', 'master')"))
}
check('每局都返回 0 或 1', results.every((r) => r === 0 || r === 1), JSON.stringify(results.slice(0, 8)))
check('40 局里双方都赢过（不是恒定结果）', results.includes(0) && results.includes(1))
check('无头掷骰点数合法', ev('tntRollDice(5).every(function (d) { return d >= 1 && d <= 6; })') === true)

// ── 4. 锦标赛的吹牛局确实走真模拟 ─────────────────────────────────────────
console.log('[AP-4] 锦标赛接入真模拟')
ev(`
  window.__simCalls = 0;
  window.__origSim = simulateLiarGame;
  simulateLiarGame = function () { window.__simCalls++; return window.__origSim.apply(null, arguments); };
  tntSimulateGame({ name: 'x', power: 0.5 }, { name: 'y', power: 0.5 }, 'liar');
`)
check('吹牛局调用了无头真模拟', ev('window.__simCalls') === 1)
check('锦标赛六玩法都经统一入口真模拟', ev(`
  window.__anyCalls = [];
  window.__origAny = simulateAnyGame;
  simulateAnyGame = function () { window.__anyCalls.push(arguments[0]); return window.__origAny.apply(null, arguments); };
  ['liar','red','redblue','bigsmall','oddeven','straight'].forEach(function (m) {
    tntSimulateGame({ name: 'x', power: 0.5 }, { name: 'y', power: 0.5 }, m);
  });
  window.__anyCalls.join(',')
`) === 'liar,red,redblue,bigsmall,oddeven,straight')

// ── 5. 薄封装保持原行为 ───────────────────────────────────────────────────
console.log('[AP-5] 原 aiDecide 薄封装')
ev('liarLevel = "master"; computerDice = [1,2,3,4,5]; currentBid = { count: 10, value: 6 };')
check('aiDecide() 仍按全局给出决策', ev('typeof aiDecide().action') === 'string')
check('aiDecide() 在必吹局面下也判质疑', ev('aiDecide().action') === 'challenge')

// ── 6. 六玩法全部可无头真模拟（③.1 第二批）───────────────────────────────
console.log('[AP-6] 六玩法无头真模拟')
for (const m of ['liar', 'red', 'redblue', 'bigsmall', 'oddeven', 'straight']) {
  const rs = []
  for (let i = 0; i < 20; i++) rs.push(ev("simulateAnyGame('" + m + "', tntRollDice(5), tntRollDice(5))"))
  check('[' + m + '] 20 局都返回 0/1', rs.every((r) => r === 0 || r === 1))
}
check('大小：两项都够才算成立',
  ev("twoCountBidHolds('bigsmall', { small: 2, big: 2 }, [1,2,3,4,5], [1,2,3,4,5])") === true)
check('大小：任一项不够即不成立',
  ev("twoCountBidHolds('bigsmall', { small: 9, big: 2 }, [1,2,3,4,5], [1,2,3,4,5])") === false)
check('红点：分数够才算成立',
  ev("redBidHolds({ total: 10 }, [1,4,1,4,1], [4,4,4,1,1])") === true)
check('红点：分数不够即不成立',
  ev("redBidHolds({ total: 30 }, [1,4,1,4,1], [4,4,4,1,1])") === false)
check('顺子：靠万能 1 补齐也算成立',
  ev("straightBidHolds({ len: 3 }, [2,3,4,5,6], [1,1,1,1,1])") === true)
check('顺子：缺面且无万能即不成立',
  ev("straightBidHolds({ len: 6 }, [2,2,2,2,2], [2,2,2,2,2])") === false)
check('统一入口覆盖全部六玩法', ev(`
  ['liar','red','redblue','bigsmall','oddeven','straight'].every(function (m) {
    var v = simulateAnyGame(m, tntRollDice(5), tntRollDice(5));
    return v === 0 || v === 1;
  })
`) === true)

// ── 7. 运行期错误 ─────────────────────────────────────────────────────────
console.log('[AP-7] 运行期错误')
check('无未捕获错误', errors.length === 0, errors.slice(0, 2).join(' | '))

console.log(failures === 0
  ? '\nAll parameterised-AI checks passed ✅'
  : '\n' + failures + ' parameterised-AI check(s) FAILED ❌')
dom.window.close()
process.exit(failures === 0 ? 0 : 1)
