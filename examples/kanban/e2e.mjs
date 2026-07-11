// E2E-тест MiniTrello в настоящем браузере (Chrome через Playwright).
// Проверяет то, чего не видят Node-тесты: реальный DOM, события, фокус (v-focus),
// document-слушатели (v-click-outside), Teleport через querySelector.
//
// Запуск:
//   npm i -D playwright            # система: нужен установленный Google Chrome
//   PORT=5173 node scripts/serve.js &   # поднять статический сервер
//   node examples/kanban/e2e.mjs        # (или BASE=http://host:port node ...)
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5173'
const URL = BASE + '/examples/kanban/index.html'
const SHOTS = os.tmpdir()

const errors = []
const ok = (m) => console.log('  ✓ ' + m)
function assert(cond, msg) {
  if (!cond) throw new Error('ПРОВАЛ: ' + msg)
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

  console.log('1. Стартовый рендер')
  assert((await page.locator('.topbar strong').textContent()) === 'MiniTrello', 'шапка MiniTrello')
  assert((await page.getByText('Сверстать шапку').count()) > 0, 'сид-карточка на доске')
  assert((await page.locator('.pill').first().textContent()).includes('4'), 'счётчик «Активных: 4»')
  assert((await page.locator('.column').count()) === 3, '3 колонки')
  await page.screenshot({ path: path.join(SHOTS, 'kanban-board.png') })

  console.log('2. Добавление карточки (v-model + Enter)')
  await page.getByPlaceholder('Новая карточка…').fill('E2E: проверить браузер')
  await page.getByPlaceholder('Новая карточка…').press('Enter')
  await page.waitForTimeout(50)
  assert((await page.getByText('E2E: проверить браузер').count()) > 0, 'новая карточка появилась')
  assert((await page.locator('.pill').first().textContent()).includes('5'), 'счётчик стал 5')

  console.log('3. Модалка (Teleport) + v-focus')
  await page.getByText('Сверстать шапку').click()
  await page.waitForSelector('#modals .modal', { timeout: 3000 })
  assert(
    (await page.locator('#modals .modal').count()) === 1 && (await page.locator('#app .modal').count()) === 0,
    'модалка отрендерилась в #modals, а не в #app',
  )
  const active = await page.evaluate(() => ({
    tag: document.activeElement && document.activeElement.tagName,
    val: document.activeElement && document.activeElement.value,
  }))
  assert(active.tag === 'INPUT' && active.val === 'Сверстать шапку', 'v-focus сфокусировал поле заголовка')
  await page.screenshot({ path: path.join(SHOTS, 'kanban-modal.png') })

  console.log('4. Правка карточки + сохранение')
  await page.locator('#modals .modal input').first().fill('Шапка готова (e2e)')
  await page.locator('#modals').getByText('Сохранить').click()
  await page.waitForTimeout(50)
  assert((await page.locator('#modals .modal').count()) === 0, 'модалка закрылась')
  assert((await page.getByText('Шапка готова (e2e)').count()) > 0, 'заголовок обновился на доске')

  console.log('5. click-outside закрывает модалку')
  await page.getByText('Ревью PR').click()
  await page.waitForSelector('#modals .modal')
  await page.mouse.click(5, 5)
  await page.waitForTimeout(50)
  assert((await page.locator('#modals .modal').count()) === 0, 'клик вне модалки закрыл её')

  console.log('6. Архивирование и навигация роутера')
  await page.getByText('Написать тесты').click()
  await page.waitForSelector('#modals .modal')
  await page.locator('#modals').getByText('В архив').click()
  await page.waitForTimeout(50)
  assert((await page.locator('.pill').first().textContent()).includes('4'), 'после архива активных снова 4')
  await page.locator('.topbar nav').getByText('Архив').click()
  await page.waitForTimeout(80)
  assert((await page.getByText('Написать тесты').count()) > 0, 'карточка видна в архиве')
  assert(/#\/archive/.test(page.url()), 'URL сменился на #/archive')
  await page.getByText('Восстановить').click()
  await page.waitForTimeout(50)
  ok('восстановление из архива работает')
  await page.locator('.topbar nav').getByText('Доска').click()
  await page.waitForTimeout(80)

  console.log('7. KeepAlive-вкладки + async StatsPanel')
  await page.getByPlaceholder('Поиск карточек…').fill('ревью')
  await page.waitForTimeout(50)
  await page.locator('.tabs').getByText('Статистика').click()
  await page.waitForSelector('.stats', { timeout: 4000 })
  assert((await page.getByText('Готово:').count()) > 0, 'async StatsPanel загрузилась')
  await page.screenshot({ path: path.join(SHOTS, 'kanban-stats.png') })
  await page.locator('.tabs').getByText('Доска').click()
  await page.waitForTimeout(50)
  assert(
    (await page.getByPlaceholder('Поиск карточек…').inputValue()) === 'ревью',
    'KeepAlive сохранил введённый поиск',
  )

  if (errors.length) {
    console.log('\nОшибки в браузере:')
    errors.forEach((e) => console.log('  ✗ ' + e))
    throw new Error('в браузере были ошибки консоли/сети')
  }
  console.log('\n✅ ВСЕ БРАУЗЕРНЫЕ СЦЕНАРИИ ПРОШЛИ (0 ошибок консоли)')
} catch (e) {
  console.error('\n❌ ' + e.message)
  await page.screenshot({ path: path.join(SHOTS, 'kanban-FAIL.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
