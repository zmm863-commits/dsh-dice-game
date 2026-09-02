#!/usr/bin/env node
/**
 * P0 acceptance suite (optimization plan v1.0 §八).
 * Covers: binomial tail math, payout table values, streak/title ladder,
 * AI decision chain, settlement hooks per mode, storage-bridge degradation,
 * and the host-side DICE-SAVE v1 bridge (reference auth + whitelist + cap).
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

// ── Load the game page into jsdom (external vendor scripts stripped) ──────
const rawHtml = readFileSync(join(root, 'lib/assets/index.html'), 'utf8')
const html = rawHtml
  .replace('<script src="peerjs.min.js"></script>', '')
  .replace('<script src="qrcode.min.js"></script>', '')
const errors = []
const vc = new VirtualConsole()
vc.on('jsdomError', (e) => errors.push(String(e && e.message || e)))
vc.on('error', (m) => errors.push(String(m)))
const dom = new JSDOM(html, {
  url: 'http://127.0.0.1:3080/dice-game/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
})
const w = dom.window
const ev = (code) => w.eval(code)

await new Promise((r) => setTimeout(r, 1200)) // let init/hydration settle

// ── A. binomTail 数学正确性 ──────────────────────────────────────────────
console.log('[A] binomTail 二项尾概率')
check('P(Binom≥0)=1', ev('binomTail(5, 1/3, 0)') === 1)
check('P(Binom(5,1/6)≥6)=0', ev('binomTail(5, 1/6, 6)') === 0)
const p3 = Number(ev('binomTail(5, 1/3, 3)'))
check('P(Binom(5,1/3)≥3)=51/243', Math.abs(p3 - 51 / 243) < 1e-9, String(p3))
const mono = ev('[0,1,2,3,4,5].map(k => binomTail(5, 1/3, k)).every((v,i,a)=>i===0||v<=a[i-1])')
check('对 k 单调不增', mono === true)
check('叫①时 q=1/6 生效路径', ev("currentBid={count:9,value:1};computerDice=[2,3,4,5,6];aiDecide().action") === 'challenge')

// ── B. 赔付表数值与方案 §1.2 一致 ────────────────────────────────────────
console.log('[B] 赔付表')
const T = ev('JSON.stringify(PAYOUT_TABLE)')
const pt = JSON.parse(T)
check('大小 基础×1/彩金+×2/押项×35', pt.bigsmall.winMult === 1 && pt.bigsmall.tripleBonusMult === 2 && pt.tripleSideBetMult === undefined && pt.bigsmall.tripleSideBetMult === 35)
check('单双 阶梯 [1,1.5,2]', JSON.stringify(pt.oddeven.ladderMults) === '[1,1.5,2]')
check('顺子 胜局×10', pt.straight.winMult === 10)
check('红点 分档 200/4.5/1.8', pt.red.tiers[0].mult === 200 && pt.red.tiers[1].mult === 4.5 && pt.red.tiers[2].mult === 1.8)
check('红蓝 分层 20/3/1', pt.redblue.exactMult === 20 && pt.redblue.offByOneMult === 3 && pt.redblue.offByTwoMult === 1)
check('基注 STAKE=10', Number(ev('STAKE')) === 10)

// ── C. 连胜/称号阶梯＋连败保护 ───────────────────────────────────────────
console.log('[C] 连胜称号')
ev('winStreak=0;loseStreak=0;curTitleIdx=0;loseProtectArmed=false;loseProtectActive=false')
ev('registerWin();registerWin();registerWin()')
check('3连胜升档 桌面常客', Number(ev('curTitleIdx')) === 1 && Number(ev('winStreak')) === 3)
ev('registerLoss();registerLoss();registerLoss()')
check('3连败武装保护', ev('loseProtectArmed') === true)
ev('loseProtectActive=true')
check('保护局大师降为普通', ev("liarLevel='master';effectiveLiarLevel()") === 'normal')
ev('loseProtectActive=false;liarLevel=\'normal\'')

// ── D. 吹牛 AI 决策链路（三档） ──────────────────────────────────────────
console.log('[D] 吹牛 AI')
for (const lv of ['rookie', 'normal', 'master']) {
  ev(`liarLevel='${lv}'`)
  ev('computerDice=[2,2,3,4,5];currentBid=null')
  const opening = ev('JSON.stringify(aiDecide())')
  const o = JSON.parse(opening)
  check(`${lv} 开局合法叫点`, o.action === 'bid' && o.count >= 1 && o.count <= 10 && o.value >= 2 && o.value <= 6, opening)
}
// 必吹局面：对手叫 10 个⑥，我方无⑥无① → need=10 > m=5 → pTrue=0
const forced = ev("computerDice=[2,2,3,4,5];currentBid={count:10,value:6};JSON.stringify(aiDecide())")
check('必吹局面判挑战', JSON.parse(forced).action === 'challenge', forced)
ev('computerDice=[2,2,3,4,5];currentBid={count:2,value:3}')
const follow = JSON.parse(ev('JSON.stringify(aiDecide())'))
check('低叫点跟注加码且大于上家', follow.action !== 'challenge' ? follow.count > 2 : true, forced)
check('三档延迟配置存在', ev("['rookie','normal','master'].every(k=>LIAR_AI_LEVELS[k].delay.length===2&&LIAR_AI_LEVELS[k].theta>0)") === true)

// ── E. 六玩法结算钩子赔付落地 ───────────────────────────────────────────
console.log('[E] 结算钩子赔付')
const resetWinStats = () => ev("DiceStore.data['dice_stats']={wins:0,losses:0,coins:0};playerWins=0;computerWins=0")
// 顺子 ×10
resetWinStats()
ev("gameMode='straight';mpGameActive=false;oddevenWinChain=0")
const dStraight = ev("onSettle(0, {challenger:0})")
check('顺子胜局 ×10 → +100 骰币', dStraight.includes('×10') && ev("DiceStore.data['dice_stats'].coins") === 100, dStraight)
// 单双连中 1→1.5
resetWinStats()
ev("gameMode='oddeven';oddevenWinChain=0")
ev("onSettle(0,{challenger:0}); const d2=onSettle(0,{challenger:0}); window.__d2=d2")
check('单双第二连胜 ×1.5', ev('__d2').includes('×1.5'), ev('__d2'))
check('单双败局清零连中链', (() => { ev('onSettle(1,{challenger:1}); gameMode=gameMode'); return Number(ev('oddevenWinChain')) === 0 })())
// 大小 三同色彩金
resetWinStats()
ev("gameMode='bigsmall'")
const dBs = ev("onSettle(0, {challenger:0, allDice:[5,5,5,2,3,4,6,1,2,3]})")
check('三同色彩金 ×3(+2)', dBs.includes('×3'), dBs)
// 红蓝 精确命中 ×20
resetWinStats()
ev("gameMode='redblue'")
const dRb = ev("onSettle(0, {challenger:1, actualRed:3, actualBlue:7, bidRed:3, bidBlue:7})")
check('红蓝精确 ×20 → +200', dRb.includes('×20') && ev("DiceStore.data['dice_stats'].coins") === 200, dRb)
// 红点 全红头奖 ×200
resetWinStats()
ev("gameMode='red'")
const dRed = ev("onSettle(0, {challenger:0, redDice:10})")
check('全红头奖 ×200', dRed.includes('×200'), dRed)
// 败局计生涯
ev('onSettle(1, {challenger:0})')
check('败局计入生涯 losses', ev("DiceStore.data['dice_stats'].losses") >= 1)
check('震屏三档 CSS 就绪', !!dom.window.document.querySelector('style') && rawHtml.includes('.shake-l') && rawHtml.includes('.shake-m') && rawHtml.includes('.shake-s'))

// ── F. 存储桥链路与静默降级 ─────────────────────────────────────────────
console.log('[F] 存储桥降级')
// 主 dom（http url）jsdom 提供可用 localStorage → 走第一级 'ls' 直测链路
check('LS 可用环境走 ls 链路且就绪', ev('DiceStore.readyFlag') === true && ev('DiceStore.mode') === 'ls', ev('DiceStore.mode'))
check('关键键(critical)即时落盘', (() => { ev("DiceStore.set('dice_fx', false)"); return w.localStorage.getItem('dice_fx') === 'false' })())
check('防抖键 flushDirty 后落盘', (() => { ev("DiceStore.set('dice_stats',{wins:9})"); ev('DiceStore.flushDirty()'); return w.localStorage.getItem('dice_stats') === JSON.stringify({ wins: 9 }) })())
check('无未捕获错误(ls 环境)', errors.length === 0, errors.slice(0, 3).join(' | '))
check('UI 元素就位(倍注/连胜章/生涯行/围骰押项)', ['betSelector', 'streakChip', 'careerLine', 'bigSmallTripleBet'].every(id => !!dom.window.document.getElementById(id)))
w.close()

// 毒化用例：localStorage 抛 SecurityError 且无父窗（模拟 opaque iframe 单开）→ mem 静默降级
{
  const errors2 = []
  const vc2 = new VirtualConsole()
  vc2.on('jsdomError', (e) => errors2.push(String((e && e.message) || e)))
  vc2.on('error', (m) => errors2.push(String(m)))
  const dom3 = new JSDOM(html, {
    url: 'https://opaque.example/dice-game/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc2,
    beforeParse(window) {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() { throw new window.DOMException('SecurityError: denied', 'SecurityError') },
      })
    },
  })
  const w3 = dom3.window
  await new Promise((res) => setTimeout(res, 1300)) // hello 重试 3×250ms 后落 mem
  const e3 = (c) => w3.eval(c)
  check('LS 全抛＋无父窗 → mem 模式', e3('DiceStore.readyFlag && DiceStore.mode') === 'mem', e3('DiceStore.mode'))
  check('mem 态 set/get 正常', (() => { e3("DiceStore.set('dice_lang','en')"); return e3("DiceStore.get('dice_lang')") === 'en' })())
  check('毒化环境无未捕获错误', errors2.length === 0, errors2.slice(0, 3).join(' | '))
  w3.close()
}

// ── G. 宿主侧桥：引用鉴权＋白名单＋64KB 上限 ─────────────────────────────
console.log('[G] 宿主侧存储桥')
{
  // DOM 骨架与 smoke-client.mjs 一致：侧栏行 + 会话中列（挂载定位依赖）
  const dom2 = new JSDOM(`<!DOCTYPE html>
<html><head></head><body>
  <div data-pane="sidebar">
    <div class="logoRow"><button class="newSession">+ New</button></div>
    <div class="projectRow">A session row</div>
  </div>
  <div data-pane="conversation"><div class="chat">conversation content</div></div>
</body></html>`, { url: 'http://127.0.0.1:3080/', pretendToBeVisual: true, runScripts: 'dangerously', virtualConsole: vc })
  const w2 = dom2.window
  globalThis.window = w2
  globalThis.document = w2.document
  globalThis.location = w2.location
  globalThis.MutationObserver = w2.MutationObserver
  globalThis.CustomEvent = w2.CustomEvent
  globalThis.HTMLElement = w2.HTMLElement
  globalThis.HTMLButtonElement = w2.HTMLButtonElement
  globalThis.HTMLIFrameElement = w2.HTMLIFrameElement
  globalThis.HTMLDivElement = w2.HTMLDivElement
  globalThis.Event = w2.Event
  globalThis.localStorage = w2.localStorage
  const loaderLoads = []
  w2.__ModuleLoader__ = { load: (spec) => loaderLoads.push(spec) }
  await import(join(root, 'lib/client.js'))
  const spec = loaderLoads[loaderLoads.length - 1]
  const disposers = []
  // factory(require) 返回 module.exports = { apply, inject }
  const mod = spec.factory(() => ({}))
  const ctxFake = { effect: (fn, _l) => { const d = fn(); if (typeof d === 'function') disposers.push(d) } }
  mod.apply(ctxFake)
  await new Promise((r) => setTimeout(r, 250))
  const iframe = w2.document.querySelector('iframe.dsh-dicegame-frame')
  check('面板 iframe 已挂载', !!iframe)
  if (!iframe) {
    console.log('  (mount debug: container=', !!w2.document.querySelector('[data-dsh-dicegame-view]'), ')')
    process.exit(1)
  }
  const childWin = iframe.contentWindow
  const replies = []
  childWin.addEventListener('message', (e) => replies.push(e.data))
  const send = (data, source) => w2.dispatchEvent(new w2.MessageEvent('message', { data, source: source === undefined ? childWin : source }))
  send({ v: 1, ch: 'DICE-SAVE', cmd: 'hello', req: 'h1' })
  await new Promise((r) => setTimeout(r, 30))
  check('hello→ready 回包', replies.some(r => r && r.cmd === 'ready'), JSON.stringify(replies))
  send({ v: 1, ch: 'DICE-SAVE', cmd: 'dice-set', key: 'dice_lang', json: '"en"', req: 's1' })
  await new Promise((r) => setTimeout(r, 30))
  check('dice-set 落宿主 localStorage', w2.localStorage.getItem('dice_lang') === '"en"')
  check('dice-ok 回执 ok=true', replies.some(r => r && r.cmd === 'dice-ok' && r.ok === true))
  send({ v: 1, ch: 'DICE-SAVE', cmd: 'dice-get', key: 'dice_lang', req: 'g1' })
  await new Promise((r) => setTimeout(r, 30))
  check('dice-get 读回 en', replies.some(r => r && r.cmd === 'dice-data' && r.json === '"en"'))
  send({ v: 1, ch: 'DICE-SAVE', cmd: 'dice-set', key: 'evil_key', json: '"x"', req: 's2' })
  await new Promise((r) => setTimeout(r, 30))
  check('非白名单键拒写', w2.localStorage.getItem('evil_key') === null)
  const bigJson = JSON.stringify('x'.repeat(70 * 1024))
  send({ v: 1, ch: 'DICE-SAVE', cmd: 'dice-set', key: 'dice_stats', json: bigJson, req: 's3' })
  await new Promise((r) => setTimeout(r, 30))
  check('>64KB 拒写', (w2.localStorage.getItem('dice_stats') || '').length < 70 * 1024)
  const before = replies.length
  send({ v: 1, ch: 'DICE-SAVE', cmd: 'hello', req: 'h2' }, {})
  await new Promise((r) => setTimeout(r, 30))
  check('异源(source 不符)消息忽略', replies.length === before)
  for (const d of disposers.splice(0)) try { d() } catch {}
  dom2.window.close()
}

console.log(failures === 0 ? '\nAll P0 checks passed ✅' : '\n' + failures + ' P0 check(s) FAILED ❌')
process.exit(failures === 0 ? 0 : 1)
