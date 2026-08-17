#!/usr/bin/env node
/**
 * Verify the 联机下线 (MP_DISABLED) behavior on the BUILT game:
 *  1. Cover "开始游戏" click → enters single-player (cover hidden), no mode overlay.
 *  2. mpCheckRoomParam ignores ?room= / __DICE_INIT_ROOM__ (no join overlay).
 *  3. Restore path: a build with `const MP_DISABLED = false;` → cover click
 *     re-opens the mode overlay (proves flipping the flag restores MP).
 */
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const html = readFileSync(new URL('../lib/assets/index.html', import.meta.url), 'utf8')
const results = []
const check = (name, cond) => { results.push([cond ? 'PASS' : 'FAIL', name]) }

function makeDom(extra = {}, url = 'https://dice.example.com/game/?room=ABC123', source = html) {
  const dom = new JSDOM(source, {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      Object.assign(window, extra)
      window.QRCode = class { constructor(el, opts) { el.__qr = opts.text } }
      window.QRCode.CorrectLevel = { M: 'M' }
      window.navigator.clipboard = { writeText: () => Promise.resolve() }
      window.addEventListener('error', (e) => { window.__jserr = window.__jserr || e.message })
    },
  })
  return dom
}

// ── 1. 联机下线：封面 → 直接进单人 ──
{
  const dom = makeDom({})
  const w = dom.window
  const d = w.document
  d.getElementById('coverStartBtn').click()
  check('1a 封面隐藏（进入单人）', d.getElementById('coverPage').classList.contains('hidden'))
  check('1b 联机模式弹窗未弹出', !d.getElementById('mpModeOverlay').classList.contains('show'))
}

// ── 2. 联机下线：URL 房间号被忽略 ──
{
  const dom = makeDom({ __DICE_INIT_ROOM__: 'HELLO9' }, 'https://dice.example.com/game/?room=ABC123')
  const w = dom.window
  const d = w.document
  w.eval(`mpCheckRoomParam();`)
  setTimeout(() => {
    check('2a 未自动打开加入弹窗', !d.getElementById('mpJoinOverlay').classList.contains('show'))
    check('2b 加入框未预填', d.getElementById('mpJoinCode').value === '')
  }, 400)
}

// ── 3. 恢复路径：MP_DISABLED=false 的构建 → 封面弹出联机模式 ──
{
  const restored = html.replace('const MP_DISABLED = true;', 'const MP_DISABLED = false;')
  const dom = makeDom({}, 'https://dice.example.com/game/', restored)
  const w = dom.window
  const d = w.document
  d.getElementById('coverStartBtn').click()
  check('3a 恢复构建后封面点击弹出联机模式', d.getElementById('mpModeOverlay').classList.contains('show'))
  check('3b 弹窗含创建房间按钮', !!d.getElementById('mpCreateBtn'))
}

setTimeout(() => {
  const fails = results.filter(([s]) => s === 'FAIL').length
  results.forEach(([s, n]) => console.log(s, n))
  console.log(fails === 0 ? '\nALL PASS ✅' : `\n${fails} FAILED ❌`)
  process.exit(fails === 0 ? 0 : 1)
}, 700)
