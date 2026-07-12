// E2E test of MiniTrello in a real browser (Chrome via Playwright).
// Covers what the Node tests can't see: the real DOM, events, focus (v-focus),
// document listeners (v-click-outside), and Teleport via querySelector.
//
// Run:
//   npm i -D playwright            # system: a real Google Chrome must be installed
//   PORT=5173 node scripts/serve.js &   # start the static server
//   node examples/kanban/e2e.mjs        # (or BASE=http://host:port node ...)
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5173'
const URL = BASE + '/examples/kanban/index.html'
const SHOTS = os.tmpdir()

const errors = []
const ok = (m) => console.log('  ✓ ' + m)
function assert(cond, msg) {
  if (!cond) throw new Error('FAILED: ' + msg)
  ok(msg)
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage()
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('response', (r) => {
  if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) {
    errors.push(`HTTP ${r.status()}: ${r.url()}`)
  }
})

try {
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForSelector('.board', { timeout: 5000 })

  console.log('1. Initial render')
  assert((await page.locator('.topbar strong').textContent()) === 'MiniTrello', 'MiniTrello header')
  assert((await page.getByText('Design the header').count()) > 0, 'seed card on the board')
  assert((await page.locator('.pill').first().textContent()).includes('4'), 'counter "Active: 4"')
  assert((await page.locator('.column').count()) === 3, '3 columns')
  await page.screenshot({ path: path.join(SHOTS, 'kanban-board.png') })

  console.log('2. Add a card (v-model + Enter)')
  await page.getByPlaceholder('New card…').fill('E2E: check the browser')
  await page.getByPlaceholder('New card…').press('Enter')
  await page.waitForTimeout(50)
  assert((await page.getByText('E2E: check the browser').count()) > 0, 'new card appeared')
  assert((await page.locator('.pill').first().textContent()).includes('5'), 'counter became 5')

  console.log('3. Modal (Teleport) + v-focus')
  await page.getByText('Design the header').click()
  await page.waitForSelector('#modals .modal', { timeout: 3000 })
  assert(
    (await page.locator('#modals .modal').count()) === 1 && (await page.locator('#app .modal').count()) === 0,
    'modal rendered into #modals, not #app',
  )
  const active = await page.evaluate(() => ({
    tag: document.activeElement && document.activeElement.tagName,
    val: document.activeElement && document.activeElement.value,
  }))
  assert(active.tag === 'INPUT' && active.val === 'Design the header', 'v-focus focused the title field')
  await page.screenshot({ path: path.join(SHOTS, 'kanban-modal.png') })

  console.log('4. Edit a card + save')
  await page.locator('#modals .modal input').first().fill('Header done (e2e)')
  await page.locator('#modals').getByText('Save').click()
  await page.waitForTimeout(50)
  assert((await page.locator('#modals .modal').count()) === 0, 'modal closed')
  assert((await page.getByText('Header done (e2e)').count()) > 0, 'title updated on the board')

  console.log('5. click-outside closes the modal')
  await page.getByText('Review PR').click()
  await page.waitForSelector('#modals .modal')
  await page.mouse.click(5, 5)
  await page.waitForTimeout(50)
  assert((await page.locator('#modals .modal').count()) === 0, 'a click outside the modal closed it')

  console.log('6. Archiving and router navigation')
  await page.getByText('Write tests').click()
  await page.waitForSelector('#modals .modal')
  await page.locator('#modals').getByText('Archive').click()
  await page.waitForTimeout(50)
  assert((await page.locator('.pill').first().textContent()).includes('4'), 'after archiving, active is 4 again')
  await page.locator('.topbar nav').getByText('Archive').click()
  await page.waitForTimeout(80)
  assert((await page.getByText('Write tests').count()) > 0, 'card is visible in the archive')
  assert(/#\/archive/.test(page.url()), 'URL changed to #/archive')
  await page.getByText('Restore').click()
  await page.waitForTimeout(50)
  ok('restoring from the archive works')
  await page.locator('.topbar nav').getByText('Board').click()
  await page.waitForTimeout(80)

  console.log('7. KeepAlive tabs + async StatsPanel')
  await page.getByPlaceholder('Search cards…').fill('review')
  await page.waitForTimeout(50)
  await page.locator('.tabs').getByText('Stats').click()
  await page.waitForSelector('.stats', { timeout: 4000 })
  assert((await page.getByText('Done:').count()) > 0, 'async StatsPanel loaded')
  await page.screenshot({ path: path.join(SHOTS, 'kanban-stats.png') })
  await page.locator('.tabs').getByText('Board').click()
  await page.waitForTimeout(50)
  assert(
    (await page.getByPlaceholder('Search cards…').inputValue()) === 'review',
    'KeepAlive preserved the typed search',
  )

  console.log('8. Search with no matches: hint + reset')
  await page.getByPlaceholder('Search cards…').fill('zzznope')
  await page.waitForTimeout(50)
  assert((await page.locator('.kcard').count()) === 0, 'cards hidden by the filter')
  assert((await page.getByText('Nothing found').count()) > 0, 'empty-result hint shown')
  await page.getByText('Show all').click()
  await page.waitForTimeout(50)
  assert((await page.locator('.kcard').count()) > 0, '"Show all" brought the cards back')
  assert((await page.getByPlaceholder('Search cards…').inputValue()) === '', 'search cleared')

  if (errors.length) {
    console.log('\nBrowser errors:')
    errors.forEach((e) => console.log('  ✗ ' + e))
    throw new Error('there were console/network errors in the browser')
  }
  console.log('\n✅ ALL BROWSER SCENARIOS PASSED (0 console errors)')
} catch (e) {
  console.error('\n❌ ' + e.message)
  await page.screenshot({ path: path.join(SHOTS, 'kanban-FAIL.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
