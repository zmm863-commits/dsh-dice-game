#!/usr/bin/env node
/**
 * Client-half smoke test: run the browser half inside jsdom with a fake
 * ClientContext, then assert the sidebar entry and the game panel mount and
 * toggle correctly.
 *
 * jsdom lacks real layout (clientHeight etc. are 0) and MutationObserver
 * microtask timing is async, so we drive the observer flush explicitly.
 */
import { JSDOM } from 'jsdom'

// ── Set up a minimal DOM resembling the dsh web shell ──────────────────────
const dom = new JSDOM(`<!DOCTYPE html>
<html><head></head><body>
  <div data-pane="sidebar">
    <div class="logoRow"><button class="newSession">+ New</button></div>
    <div class="projectRow">A session row</div>
  </div>
  <div data-pane="conversation"><div class="chat">conversation content</div></div>
</body></html>`, { url: 'http://127.0.0.1:3080/', pretendToBeVisual: true })

// Install globals the plugin expects.
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.location = dom.window.location
globalThis.customElements = dom.window.customElements
globalThis.MutationObserver = dom.window.MutationObserver
globalThis.CustomEvent = dom.window.CustomEvent
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.HTMLButtonElement = dom.window.HTMLButtonElement
globalThis.HTMLIFrameElement = dom.window.HTMLIFrameElement
globalThis.HTMLDivElement = dom.window.HTMLDivElement
globalThis.Event = dom.window.Event

// ── Fake ClientContext (only what the plugin uses) ─────────────────────────
const disposers = []
const ctx = {
  effect(fn, label) {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose)
  },
}

let failures = 0
const check = (name, cond, extra = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : '  ' + extra))
  if (!cond) failures++
}

// ── Load and apply the plugin ──────────────────────────────────────────────
const { apply } = await import('../lib/client.js')
apply(ctx)

// Flush microtasks so MutationObserver callbacks run.
await new Promise((r) => setTimeout(r, 50))

// ── Assertions ─────────────────────────────────────────────────────────────
const doc = document

const entry = doc.querySelector('[data-dsh-dicegame-entry]')
check('sidebar entry mounted', entry !== null)
check('sidebar entry labelled 骰子大作战', entry?.textContent?.includes('骰子大作战') ?? false)

const view = doc.querySelector('[data-dsh-dicegame-view]')
check('panel container mounted', view !== null)
check('panel hidden by default', view !== null && view.style.display !== 'block')

// Click the entry → panel activates.
entry?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await new Promise((r) => setTimeout(r, 10))
check('panel open after click', doc.documentElement.hasAttribute('data-dsh-dicegame-active'))

const frame = doc.querySelector('[data-dsh-dicegame-view] iframe')
check('game iframe present', frame !== null)
check('iframe points at /dice-game/', frame?.getAttribute('src') === 'http://127.0.0.1:3080/dice-game/' ?? false)
check('iframe sandboxed', frame?.getAttribute('sandbox')?.includes('allow-scripts') ?? false)

// Click again → panel closes.
entry?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await new Promise((r) => setTimeout(r, 10))
check('panel closes on second click', !doc.documentElement.hasAttribute('data-dsh-dicegame-active'))

// Sidebar row click closes an open panel.
entry?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await new Promise((r) => setTimeout(r, 10))
const row = doc.querySelector('.projectRow')
row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
check('sidebar row click closes panel', !doc.documentElement.hasAttribute('data-dsh-dicegame-active'))

// Sibling activation event closes the panel.
entry?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await new Promise((r) => setTimeout(r, 10))
doc.dispatchEvent(new dom.window.CustomEvent('dsh-panel-activate', { detail: 'ssh' }))
check('sibling panel activation closes ours', !doc.documentElement.hasAttribute('data-dsh-dicegame-active'))

// Reload button resets the iframe.
entry?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await new Promise((r) => setTimeout(r, 10))
const reloadBtn = doc.querySelector('.dsh-dicegame-bar-btn')
check('reload button present', reloadBtn !== null)
reloadBtn?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
check('reload resets iframe to about:blank', frame?.getAttribute('src') === 'about:blank' ?? false)

// Disposer tears everything down.
for (const d of disposers) d()
check('entry removed after dispose', doc.querySelector('[data-dsh-dicegame-entry]') === null)
check('view removed after dispose', doc.querySelector('[data-dsh-dicegame-view]') === null)
check('active attr removed after dispose', !doc.documentElement.hasAttribute('data-dsh-dicegame-active'))

console.log(failures === 0 ? '\nAll client checks passed ✅' : `\n${failures} check(s) failed ❌`)
process.exit(failures === 0 ? 0 : 1)
