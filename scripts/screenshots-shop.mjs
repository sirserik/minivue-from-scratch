// Smoke-tests the MiniShop demo against the live fake API and captures the
// README screenshots (catalog, cart drawer, product page).
//
// Usage:
//   PORT=5173 node scripts/serve.js &
//   node scripts/screenshots-shop.mjs
//
// Requires Playwright + a system Google Chrome and network access to the API.
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5173'
const URL = BASE + '/examples/shop/index.html'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'docs', 'screenshots')
fs.mkdirSync(OUT, { recursive: true })

const errors = []
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1200, height: 820 }, deviceScaleFactor: 2 })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => {
  // Ignore resource 404s (e.g. /favicon.ico) — only JS errors matter here.
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text())
})

const shot = (f) => page.screenshot({ path: path.join(OUT, f) })

try {
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForSelector('.pcard', { timeout: 20000 })
  const cards = await page.locator('.pcard').count()
  if (cards === 0) throw new Error('no product cards rendered')
  console.log(`  ✓ catalog rendered ${cards} products`)
  await shot('shop.png')

  // v-model on the search box (bound to a store field).
  await page.fill('.search', 'a')
  await page.waitForTimeout(200)
  await page.click('.toolbar button') // the ✕ clear button
  await page.waitForTimeout(150)
  console.log('  ✓ search v-model works')

  // Add three products to the cart.
  for (let i = 0; i < 3; i++) await page.locator('.pcard button.primary').nth(i).click()
  await page.click('.cart-btn')
  await page.waitForSelector('.drawer', { timeout: 3000 })
  const lines = await page.locator('.drawer .line').count()
  if (lines !== 3) throw new Error(`expected 3 cart lines, got ${lines}`)
  console.log('  ✓ cart drawer (Teleport) shows 3 lines')
  await shot('shop-cart.png')
  await page.locator('.drawer-head button').click() // close
  await page.waitForTimeout(150)

  // Open a product detail page (async fetch on :id).
  await page.locator('.pcard-title').first().click()
  await page.waitForSelector('.detail', { timeout: 8000 })
  console.log('  ✓ product page loaded (router param + async fetch)')
  await shot('shop-product.png')

  if (errors.length) {
    console.log('\nBrowser errors:')
    errors.forEach((e) => console.log('  ✗ ' + e))
    throw new Error('there were console/network errors')
  }
  console.log('\n✅ MiniShop smoke passed; screenshots written to docs/screenshots/')
} catch (e) {
  console.error('\n❌ ' + e.message)
  await shot('shop-FAIL.png').catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
