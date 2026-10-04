#!/usr/bin/env node
/**
 * ③ 锦标赛（骰王争霸赛）验收。
 *
 * 被验收的不变量：
 *  1. 8 席位 → 首轮 4 场，淘汰赛共 3 轮（4 → 2 → 1）；
 *  2. 每场对决三局两胜（胜者恰好拿到 2 胜）；
 *  3. 全 AI 对局能自动从首轮跑到冠军（不需要人工介入）；
 *  4. 人类参与的对局会切到实玩（关面板 / 选玩法 / 开新局），胜负经 onSettle 上报；
 *  5. 人类夺冠解锁「骰王之王」。
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

// ── 1. 赛制结构 ───────────────────────────────────────────────────────────
console.log('[TN-1] 赛制结构')
ev('tntBuild()')
check('8 个席位', ev('TNT.players.length') === 8)
check('首轮 4 场', ev('TNT.rounds[0].length') === 4)
check('恰好 1 个人类席位', ev('TNT.players.filter(function (p) { return p.human; }).length') === 1)

// ── 2. 全 AI 赛事能自动跑到冠军 ───────────────────────────────────────────
console.log('[TN-2] 全 AI 赛事自动推进')
ev(`
  tntBuild();
  TNT.players = TNT.players.map(function (p) { return { name: p.name, human: false, power: p.power }; });
  TNT.rounds = [tntPair(TNT.players)];
`)
let guard = 0
while (!ev('!!TNT.champion') && guard < 30) { ev('tntPrimary()'); guard++ }
check('全 AI 赛事跑出了冠军（用了 ' + guard + ' 次推进）', ev('!!TNT.champion') === true)
check('淘汰赛共 3 轮（8→4→2→1）', ev('TNT.rounds.length') === 3)
check('各轮场数为 4,2,1', ev('TNT.rounds.map(function (r) { return r.length; }).join(",")') === '4,2,1')
check('每场都是三局两胜（胜者恰好 2 胜）', ev(`
  TNT.rounds.every(function (r) {
    return r.every(function (m) { return m.winsA === 2 || m.winsB === 2; });
  })
`) === true)
check('冠军只可能来自决赛胜者', ev('TNT.champion === TNT.rounds[2][0].winner') === true)

// ── 3. 人类参与的对局切到实玩 ─────────────────────────────────────────────
console.log('[TN-3] 人类对局切实玩')
ev(`
  tntBuild();
  document.getElementById('tntOverlay').classList.add('show');
  tntPrimary();
`)
check('进入实玩等待态', ev('TNT.awaitingRound') === true)
check('实玩时赛事面板已关闭', ev("document.getElementById('tntOverlay').classList.contains('show')") === false)
check('gameMode 已切到本局所选玩法', ev('TNT_MODES.indexOf(gameMode) >= 0') === true)
check('本场比分从 0:0 起', ev('TNT.series.winsA === 0 && TNT.series.winsB === 0') === true)

ev('tntReportHumanRound(true)')
check('人类胜一局 → 比分 1:0', ev('TNT.series.winsA + TNT.series.winsB') === 1)

ev('TNT.awaitingRound = true; tntReportHumanRound(true); tntAfterHumanRound()')
await tick(30)
check('人类 2 连胜 → 本场立刻结束', ev('!!TNT.series') === false)
check('本场胜者写回对局树', ev('TNT.rounds[0][0].winner === TNT.players[0]') === true)
check('本场结束后重新打开赛事面板', ev("document.getElementById('tntOverlay').classList.contains('show')") === true)

// ── 4. 人类夺冠解锁「骰王之王」 ───────────────────────────────────────────
console.log('[TN-4] 人类夺冠解锁称号')
ev(`
  DiceStore.set('dice_streak', {});
  TNT.champion = TNT.players[0];
  tntOnChampion();
`)
check('人类夺冠 → dice_streak.king = true', ev('(DiceStore.get("dice_streak", {}) || {}).king') === true)
ev("TNT.champion = TNT.players[1]; tntOnChampion(); DiceStore.set('dice_streak', {})")
check('AI 夺冠不解锁称号', ev('(DiceStore.get("dice_streak", {}) || {}).king') === undefined)

// ── 5. 运行期错误 ─────────────────────────────────────────────────────────
console.log('[TN-5] 运行期错误')
check('无未捕获错误', errors.length === 0, errors.slice(0, 2).join(' | '))

console.log(failures === 0
  ? '\nAll tournament checks passed ✅'
  : '\n' + failures + ' tournament check(s) FAILED ❌')
dom.window.close()
process.exit(failures === 0 ? 0 : 1)
