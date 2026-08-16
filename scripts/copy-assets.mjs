#!/usr/bin/env node
/**
 * Copy the game's static assets (index.html, peerjs.min.js, qrcode.min.js)
 * into lib/assets so the built host half can serve them at runtime.
 * tsdown does not copy non-source files, so this runs after every build.
 */
import { cpSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const from = join(root, 'assets')
const to = join(root, 'lib', 'assets')

mkdirSync(to, { recursive: true })
cpSync(from, to, { recursive: true })
console.log('[dsh-dice-game] assets copied:', from, '->', to)
