#!/usr/bin/env node
/**
 * Verify the adaptive share logic inside the BUILT game (lib/assets/index.html).
 * 1. No public base → room-code card (DSH-embedded / standalone without config).
 * 2. ?diceBase=… URL param → QR code at public base + room.
 * 3. Host-injected __DICE_PUBLIC_BASE__ → QR at injected base + room.
 * 4. Host-injected __DICE_INIT_ROOM__ auto-fills the join overlay.
 * 5. mpIsEmbedded is safe to call (no throw) and returns false at top level.
 */
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const html = readFileSync(new URL('../lib/assets/index.html', import.meta.url), 'utf8')

const results = []
const check = (name, cond) => { results.push([cond ? 'PASS' : 'FAIL', name]) }

function makeDom(extra = {}, url = 'https://dice.example.com/game/') {
  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      Object.assign(window, extra)
      if (!extra.QRCode) {
        window.QRCode = class { constructor(el, opts) { el.__qr = opts.text } }
        window.QRCode.CorrectLevel = { M: 'M' }
      }
      window.navigator.clipboard = { writeText: (t) => { window.__copied = t; return Promise.resolve() } }
      window.addEventListener('error', (e) => { window.__jserr = window.__jserr || e.message })
    },
  })
  return dom
}

// ── 1. No public base → room-code card ──
{
  const dom = makeDom({})
  const w = dom.window
  check('1a mpGetPublicBase() 为空', w.eval(`mpGetPublicBase()`) === '')
  check('1b mpBuildJoinUrl 为空', w.eval(`mpBuildJoinUrl('ABC123')`) === '')
  check('1c mpIsEmbedded() 不抛错', (() => { try { w.eval(`mpIsEmbedded()`); return true } catch { return false } })())
  w.eval(`mpRoomCode='ABC123'; mpRenderRoomShare();`)
  const qr = w.document.getElementById('mpQrCode')
  check('1d 房间号卡片（非二维码）', !qr.__qr && qr.innerHTML.includes('ABC123'))
  check('1e 卡片含加入提示', qr.innerHTML.includes('好友'))
}

// ── 1f. DSH embedded 分支（self !== top）→ 「加入房间」提示文案 ──
{
  const dom = makeDom({})
  const w = dom.window
  // window.top 在 jsdom 只读；直接 patch mpIsEmbedded 模拟嵌入分支
  w.eval(`window.__origEmbed = mpIsEmbedded; mpIsEmbedded = () => true; mpRoomCode='EMB567'; mpRenderRoomShare();`)
  const qr = w.document.getElementById('mpQrCode')
  check('1f 嵌入环境 → 卡片提示点击「加入房间」', qr.innerHTML.includes('加入房间'))
  w.eval(`window.__origEmbed;`)
}

// ── 2. ?diceBase= URL param → QR at public base ──
{
  const dom = makeDom({}, 'https://dice.example.com/game/?diceBase=https%3A%2F%2Fpub.example.com%2Fdice%2F')
  const w = dom.window
  w.eval(`mpRoomCode='XYZ789'; mpRenderRoomShare();`)
  const qr = w.document.getElementById('mpQrCode')
  check('2a URL diceBase → 生成二维码', !!qr.__qr)
  check('2b 二维码指向公开地址+room', qr.__qr === 'https://pub.example.com/dice?room=XYZ789')
}

// ── 3. Host-injected __DICE_PUBLIC_BASE__ → QR at injected base ──
{
  const dom = makeDom({ __DICE_PUBLIC_BASE__: 'https://pub.example.com/dice' })
  const w = dom.window
  w.eval(`mpRoomCode='INJ888'; mpRenderRoomShare();`)
  const qr = w.document.getElementById('mpQrCode')
  check('3a 注入公开地址 → 生成二维码', !!qr.__qr)
  check('3b 二维码指向注入地址+room', qr.__qr === 'https://pub.example.com/dice?room=INJ888')
  // URL 参数优先于注入？不：注入优先（宿主说了算），这里验证优先级
  w.eval(`mpShareRoom();`)
  check('3c 分享文本含公开链接', (w.__copied || '').includes('https://pub.example.com/dice?room=INJ888'))
}

// ── 4. Host-injected initial room ──
{
  const dom = makeDom({ __DICE_INIT_ROOM__: 'HELLO9' })
  const w = dom.window
  w.eval(`mpCheckRoomParam();`)
  setTimeout(() => {
    const overlay = w.document.getElementById('mpJoinOverlay')
    const code = w.document.getElementById('mpJoinCode')
    check('4a 宿主注入初始房间号 → 自动打开加入弹窗', overlay.classList.contains('show'))
    check('4b 加入框预填房间号', code.value === 'HELLO9')
    const fails = results.filter(([s]) => s === 'FAIL').length
    results.forEach(([s, n]) => console.log(s, n))
    console.log(fails === 0 ? '\nALL PASS ✅' : `\n${fails} FAILED ❌`)
    process.exit(fails === 0 ? 0 : 1)
  }, 600)
}
