#!/usr/bin/env node
/**
 * v3 §三 B2 验收：房主权威掷骰（host-authoritative dice roll）。
 *
 * 被验收的不变量：
 *  1. 房主 newRound() 一次性生成双方骰子并广播 { host, guest }；
 *  2. 客人 newRound() 不本地掷骰，只发 { type:'need_dice' } 向房主索要；
 *  3. 房主收到 need_dice 后代为生成并广播（所以客人点「开始新局」也能开局）；
 *  4. 客人收到 { host, guest } 后：playerDice = guest、computerDice = host（视角正确），
 *     且 waiting 态下接上 startBidding()；
 *  5. 旧协议 { dice } 仍被接受——对端是旧构建时不至于互相听不懂。
 *
 * 前提说明：该模型信任房主（骰子在房主本地生成，房主天然知道双方点数）。
 * 真正的防作弊需要服务端裁决，见 OPTIMIZATION_PLAN_V3.md §三 B2。
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
vc.on('error', (m) => errors.push(String(m)))
const dom = new JSDOM(html, {
  url: 'http://127.0.0.1:3080/dice-game/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
})
const w = dom.window
const ev = (code) => w.eval(code)

await new Promise((r) => setTimeout(r, 1200))

// 发送探针 + 进入联机态
ev(`
  window.__sent = [];
  conn = { open: true, send: function (d) { window.__sent.push(d); } };
  mpGameActive = true;
`)
const sent = () => JSON.parse(ev('JSON.stringify(window.__sent)'))
const reset = () => ev('window.__sent = []')
const inRange = (arr) => Array.isArray(arr) && arr.length === 5
  && arr.every((v) => Number.isInteger(v) && v >= 1 && v <= 6)

// ── [MP-A] 房主开局：一次广播双方骰子 ───────────────────────────────────
console.log('[MP-A] 房主权威掷骰 · 房主侧')
reset()
ev('mpIsHost = true; newRound();')
const a1 = sent()
const diceMsg = a1.find((m) => m.type === 'dice')
check('房主 newRound 广播了 dice 消息', !!diceMsg)
check('消息携带 host 5 颗且点数合法', inRange(diceMsg && diceMsg.host))
check('消息携带 guest 5 颗且点数合法', inRange(diceMsg && diceMsg.guest))
check('不再发送旧的单边 dice 字段', !!diceMsg && diceMsg.dice === undefined)
check('房主视角 playerDice === host', ev('JSON.stringify(playerDice) === JSON.stringify(mpHostDice)') === true)
check('房主视角 computerDice === guest', ev('JSON.stringify(computerDice) === JSON.stringify(mpGuestDice)') === true)

// ── [MP-B] 客人开局：不本地掷骰，只索要 ─────────────────────────────────
console.log('[MP-B] 房主权威掷骰 · 客人侧')
reset()
ev('mpIsHost = false; newRound();')
const b1 = sent()
check('客人发送 need_dice 索要本局骰子', b1.some((m) => m.type === 'need_dice'))
check('客人不广播 dice（骰子只能由房主生成）', !b1.some((m) => m.type === 'dice'))
check('客人未本地掷骰（playerDice 全 0）', ev('playerDice.every(function (v) { return v === 0; })') === true)
check('客人未本地掷骰（computerDice 全 0）', ev('computerDice.every(function (v) { return v === 0; })') === true)

// ── [MP-C] 房主响应 need_dice ───────────────────────────────────────────
console.log('[MP-C] 房主响应客人的开局请求')
reset()
ev('mpIsHost = true; mpHandleData({ type: "need_dice" });')
check('房主收到 need_dice 后代为广播 dice', sent().some((m) => m.type === 'dice'))

// ── [MP-D] 客人接收广播：视角与开局（同步断言，避免被 800ms 动画定时器干扰）──
console.log('[MP-D] 客人接收房主广播')
ev(`
  mpIsHost = false;
  gamePhase = 'waiting';
  mpHandleData({ type: 'dice', host: [1,2,3,4,5], guest: [6,6,6,6,6] });
  window.__phaseAfter = gamePhase;
`)
check('客人 playerDice = guest（自己）', ev('JSON.stringify(playerDice)') === '[6,6,6,6,6]')
check('客人 computerDice = host（对手）', ev('JSON.stringify(computerDice)') === '[1,2,3,4,5]')
check('waiting 态收到骰子后进入 bidding', ev('window.__phaseAfter') === 'bidding')

// ── [MP-E] 旧协议兼容 ───────────────────────────────────────────────────
console.log('[MP-E] 旧协议兼容（对端仍是旧构建）')
ev('gamePhase = "revealing"; mpHandleData({ type: "dice", dice: [2,2,2,2,2] });')
check('旧 {dice} 消息仍能填对手骰子', ev('JSON.stringify(computerDice)') === '[2,2,2,2,2]')

// ── [MP-G] A5 记账分区：联机只写 dice_stats_mp，绝不碰单人账本 ────────────
console.log('[MP-G] A5 联机记账分区')
ev(`
  DiceStore.set('dice_stats', { coins: 777, wins: 5, losses: 1, payoutTotal: 999 });
  DiceStore.set('dice_stats_mp', { rounds: 0, wins: 0, losses: 0, bestStreak: 0, curStreak: 0, seriesWon: 0, seriesLost: 0 });
  mpGameActive = true;
  recordMpRound(true); recordMpRound(true); recordMpRound(false);
`)
const mpS = JSON.parse(ev('JSON.stringify(getMpStats())'))
check('联机账本 rounds=3', mpS.rounds === 3)
check('联机账本 wins=2 / losses=1', mpS.wins === 2 && mpS.losses === 1)
check('联机最长连胜=2', mpS.bestStreak === 2)
check('败局清零当前连胜', mpS.curStreak === 0)
const soloStats = JSON.parse(ev('JSON.stringify(DiceStore.get("dice_stats", {}))'))
check('单人账本 coins 未被联机改动（仍 777）', soloStats.coins === 777)
check('单人账本 wins 未被联机改动（仍 5）', soloStats.wins === 5)

// ── [MP-F] 运行期错误 ───────────────────────────────────────────────────
console.log('[MP-F] 运行期错误')
check('无未捕获错误', errors.length === 0, errors.slice(0, 3).join(' | '))

console.log(failures === 0
  ? '\nAll host-authoritative dice checks passed ✅'
  : '\n' + failures + ' host-authoritative dice check(s) FAILED ❌')
dom.window.close()
process.exit(failures === 0 ? 0 : 1)
