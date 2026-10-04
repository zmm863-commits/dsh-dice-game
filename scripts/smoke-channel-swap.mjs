#!/usr/bin/env node
/**
 * ② 换频道（跨玩法反制）验收。
 *
 * 规则：一方叫点后，另一方若判断开盅可能输，可「换频道」切到另一种玩法并**叫满**
 * （1v1 全场 10 颗 → 两项计数之和 = 10，如 6大4小；切到猜红点须 ≥20 分）；
 * 之后对方只能开盅或继续换频道，不能再正常加注。判定按最后所在频道。
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

// ── 1. applyModeUI 切面板但不动对局 ───────────────────────────────────────
console.log('[CS-1] applyModeUI 不重置对局')
ev(`
  gamePhase = 'bidding'; currentBid = { count: 3, value: 2 }; currentTurn = 0;
  playerDice = [1, 2, 3, 4, 5]; computerDice = [6, 6, 6, 6, 6];
  applyModeUI('bigsmall');
`)
check('gameMode 切到目标玩法', ev('gameMode') === 'bigsmall')
check('currentBid 未被清空（对局没被重置）', ev('currentBid && currentBid.count') === 3)
check('gamePhase 未变', ev('gamePhase') === 'bidding')
check('目标面板已显示', ev("document.getElementById('bigSmallPanel').style.display") === '')
check('原面板已隐藏', ev("document.getElementById('liarPanel').style.display") === 'none')

// ── 2. 「叫满」算式 ───────────────────────────────────────────────────────
console.log('[CS-2] 叫满算式')
ev('playerDice = [1, 1, 2, 2, 3]') // 5 颗全为「小」(≤3)
const cap = Number(ev('swapCapacity()'))
check('全场容量 = 10（双方各 5）', cap === 10)
const bs = JSON.parse(ev("JSON.stringify(buildSwapBid('bigsmall', 0))"))
check('大小：两项之和 = 10（得 ' + bs.small + '小' + bs.big + '大）', bs.small + bs.big === 10)
const rb = JSON.parse(ev("JSON.stringify(buildSwapBid('redblue', 0))"))
check('红蓝：两项之和 = 10', rb.red + rb.blue === 10)
const oe = JSON.parse(ev("JSON.stringify(buildSwapBid('oddeven', 0))"))
check('单双：两项之和 = 10', oe.odd + oe.even === 10)
const rd = JSON.parse(ev("JSON.stringify(buildSwapBid('red', 0))"))
check('红点：不低于 ' + ev('SWAP_RED_MIN') + ' 分（得 ' + rd.total + '）', rd.total >= Number(ev('SWAP_RED_MIN')))
const lr = JSON.parse(ev("JSON.stringify(buildSwapBid('liar', 0))"))
check('吹牛：叫满 10 个（得 ' + lr.count + ' 个 ' + lr.value + '）', lr.count === 10)

// ── 3. 执行换频道 ─────────────────────────────────────────────────────────
console.log('[CS-3] 执行换频道')
ev(`
  applyModeUI('liar'); currentBid = { count: 3, value: 2 }; currentTurn = 0; gamePhase = 'bidding';
  playerDice = [1, 1, 2, 2, 3]; computerDice = [4, 4, 5, 6, 6];
  resetChannelSwap();
  window.__swapOk = doSwapChannel('bigsmall', 0);
`)
check('换频道成功', ev('window.__swapOk') === true)
check('gameMode 变为目标频道', ev('gameMode') === 'bigsmall')
check('进入换频道状态', ev('channelSwap.active') === true)
check('记录了来源频道', ev('channelSwap.from') === 'liar')
check('叫点已换成目标玩法的结构（和为 10）', ev('currentBid.small + currentBid.big') === 10)
check('回合交给对手', ev('currentTurn') === 1)
check('拒绝换到当前所在频道', ev("doSwapChannel('bigsmall', 0)") === false)

// ── 4. 换频道后只能开盅或继续换频道 ───────────────────────────────────────
console.log('[CS-4] 换频道后的操作限制')
ev('currentTurn = 0; updateUI()')
check('正常加注按钮被禁用（大小）', ev("document.getElementById('btnBigSmallBid').disabled") === true)
check('开盅按钮仍可用', ev("document.getElementById('btnBigSmallChallenge').disabled") === false)
check('换频道按钮已显示', ev("document.getElementById('btnSwap').style.display") !== 'none')
check('换频道横幅已显示', ev("document.getElementById('swapBanner').style.display") !== 'none')
ev('gamePhase = "bidding"; updateUI()')
check('换频道按钮在玩家回合可用', ev("document.getElementById('btnSwap').disabled") === false)

// ── 5. 判定入口按当前频道分发 ─────────────────────────────────────────────
console.log('[CS-5] 判定按最后所在频道')
check('revealByMode 存在（六玩法统一开盅入口）', ev("typeof revealByMode === 'function'") === true)
check('六个玩法都有对应判定函数', ev(`
  ['revealAndJudge','revealRedJudge','revealRedBlueJudge','revealBigSmallJudge','revealOddEvenJudge','revealStraightJudge']
    .every(function (f) { return typeof window[f] === 'function'; })
`) === true)

// ── 6. 新局复位 ───────────────────────────────────────────────────────────
console.log('[CS-6] 新局复位')
ev('channelSwap.active = true; newRound()')
await tick(60)
check('新局开始后换频道状态被复位', ev('channelSwap.active') === false)
check('新局横幅已隐藏', ev("document.getElementById('swapBanner').style.display") === 'none')

// ── 7. 运行期错误 ─────────────────────────────────────────────────────────
console.log('[CS-7] 运行期错误')
check('无未捕获错误', errors.length === 0, errors.slice(0, 2).join(' | '))

console.log(failures === 0
  ? '\nAll channel-swap checks passed ✅'
  : '\n' + failures + ' channel-swap check(s) FAILED ❌')
dom.window.close()
process.exit(failures === 0 ? 0 : 1)
