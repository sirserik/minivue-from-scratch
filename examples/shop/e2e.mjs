// E2E test of MiniShop in a real browser (Chrome via Playwright).
// The fake API is fully MOCKED with Playwright request interception, so the test
// is deterministic and needs no network — unlike the live screenshot script.
//
// Run:
//   npm i -D playwright            # system: a real Google Chrome must be installed
//   PORT=5173 node scripts/serve.js &
//   node examples/shop/e2e.mjs     # (or BASE=http://host:port node ...)
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5173'
const URL = BASE + '/examples/shop/index.html'

// A 1x1 grey PNG so <img> loads offline.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC'

const PRODUCTS = [
  { id: 1, title: 'Wireless Headphones', price: 59.99, thumbnail: PNG, rating: 4.5, stock: 20, category: 'audio', brand: 'Acme' },
  { id: 2, title: 'Mechanical Keyboard', price: 89.0, thumbnail: PNG, rating: 4.7, stock: 12, category: 'peripherals', brand: 'KeyCo' },
  { id: 3, title: 'USB-C Cable', price: 9.99, thumbnail: PNG, rating: 4.2, stock: 99, category: 'accessories', brand: 'Wired' },
  { id: 4, title: '4K Monitor', price: 329.0, thumbnail: PNG, rating: 4.8, stock: 5, category: 'peripherals', brand: 'ViewMax' },
]
const CATEGORIES = [...new Set(PRODUCTS.map((p) => p.category))].map((s) => ({ slug: s, name: s }))
const detail = (p) => ({ ...p, description: `A fine ${p.title}.`, images: [p.thumbnail] })

const errors = []
const ok = (m) => console.log('  ✓ ' + m)
function assert(cond, msg) {
  if (!cond) throw new Error('FAILED: ' + msg)
  ok(msg)
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage()
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text())
})

// Intercept every call to the fake API and answer from the fixtures above.
await page.route('**/dummyjson.com/**', (route) => {
  const url = route.request().url()
  let body
  if (url.includes('/products/categories')) body = CATEGORIES
  else {
    const m = url.match(/\/products\/(\d+)/)
    if (m) body = detail(PRODUCTS.find((p) => p.id === Number(m[1])))
    else body = { products: PRODUCTS, total: PRODUCTS.length }
  }
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
})

try {
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForSelector('.pcard', { timeout: 5000 })

  console.log('1. Catalog renders from the (mocked) API')
  assert((await page.locator('.pcard').count()) === 4, 'four product cards')
  assert((await page.getByText('Wireless Headphones').count()) > 0, 'a product title is shown')

  console.log('2. Category chip filters the grid (computed)')
  await page.locator('.chip', { hasText: 'peripherals' }).click()
  await page.waitForTimeout(50)
  assert((await page.locator('.pcard').count()) === 2, 'two peripherals')
  await page.locator('.chip', { hasText: 'All' }).click()
  await page.waitForTimeout(50)
  assert((await page.locator('.pcard').count()) === 4, 'reset shows all four')

  console.log('3. Search box (v-model bound to a store field)')
  await page.fill('.search', 'cable')
  await page.waitForTimeout(50)
  assert((await page.locator('.pcard').count()) === 1, 'one match for "cable"')
  await page.click('.toolbar button') // ✕ clear
  await page.waitForTimeout(50)
  assert((await page.locator('.pcard').count()) === 4, 'clearing search restores all')

  console.log('4. Add to cart + Teleport drawer')
  // Target a product by name so the test never depends on grid order.
  await page.locator('.pcard', { hasText: 'Wireless Headphones' }).locator('button.primary').click()
  assert((await page.locator('.cart-btn .pill').textContent()) === '1', 'cart count is 1')
  await page.click('.cart-btn')
  await page.waitForSelector('.drawer', { timeout: 3000 })
  assert(
    (await page.locator('#modals .drawer').count()) === 1 && (await page.locator('#app .drawer').count()) === 0,
    'drawer teleported into #modals, not #app',
  )
  assert((await page.locator('.drawer .line').count()) === 1, 'one line in the cart')

  console.log('5. Quantity stepper updates the total')
  await page.locator('.drawer .line .qty button').nth(1).click() // "+"
  await page.waitForFunction(() => document.querySelector('.cart-btn .pill')?.textContent === '2')
  assert((await page.locator('.cart-btn .pill').textContent()) === '2', 'cart count is 2 after +')
  await page.waitForFunction(() => document.querySelector('.drawer .total strong')?.textContent.includes('119.98'))
  assert((await page.locator('.drawer .total strong').textContent()).includes('119.98'), 'total = 2 × 59.99')

  console.log('6. Checkout clears the cart')
  await page.locator('.drawer-foot .primary').click()
  await page.waitForTimeout(50)
  assert((await page.locator('#modals .drawer').count()) === 0, 'drawer closed after checkout')
  assert((await page.locator('.cart-btn .pill').count()) === 0, 'cart badge gone (empty)')

  console.log('7. Product page: router param + async fetch (watchEffect)')
  await page.locator('.pcard-title', { hasText: 'Wireless Headphones' }).click()
  await page.waitForSelector('.detail', { timeout: 5000 })
  assert(/#\/product\/1/.test(page.url()), 'URL is /product/1')
  assert((await page.locator('.detail h2').textContent()) === 'Wireless Headphones', 'detail shows the product')
  await page.getByText('Back to catalog').click()
  await page.waitForSelector('.grid', { timeout: 3000 })
  ok('back navigation returns to the catalog')

  if (errors.length) {
    console.log('\nBrowser errors:')
    errors.forEach((e) => console.log('  ✗ ' + e))
    throw new Error('there were console/network errors in the browser')
  }
  console.log('\n✅ ALL SHOP SCENARIOS PASSED (0 console errors)')
} catch (e) {
  console.error('\n❌ ' + e.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
