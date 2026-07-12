// Captures README screenshots of the playground and the capstone app.
//
// Usage:
//   PORT=5173 node scripts/serve.js &        # serve the repo root
//   node scripts/screenshots.mjs             # writes docs/screenshots/*.png
//   # (or BASE=http://host:port node scripts/screenshots.mjs)
//
// Requires Playwright + a system Google Chrome (same as the e2e test).
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5173'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'docs', 'screenshots')
fs.mkdirSync(OUT, { recursive: true })

// page path → output file (+ optional selector to wait for and clip to).
const SHOTS = [
  { url: '/examples/kanban/index.html', file: 'kanban.png', waitFor: '.board' },
  { url: '/playground/index.html', file: 'playground.png', waitFor: 'body' },
  { url: '/playground/01-reactivity.html', file: 'reactivity.png', waitFor: 'body' },
  { url: '/playground/12-capstone.html', file: 'capstone.png', waitFor: 'body' },
]

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({
  viewport: { width: 1200, height: 780 },
  deviceScaleFactor: 2,
})

for (const s of SHOTS) {
  await page.goto(BASE + s.url, { waitUntil: 'networkidle' })
  if (s.waitFor) await page.waitForSelector(s.waitFor, { timeout: 5000 })
  await page.waitForTimeout(400) // let transitions settle
  const dest = path.join(OUT, s.file)
  await page.screenshot({ path: dest })
  console.log('  ✓ ' + s.file + '  ←  ' + s.url)
}

await browser.close()
console.log('done → docs/screenshots/')
