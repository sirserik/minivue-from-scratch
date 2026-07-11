// ============================================================================
//  history.js — три способа хранить «текущий адрес»
// ----------------------------------------------------------------------------
//  Роутеру нужно знать, какой адрес открыт, уметь его менять и сообщать об этом,
//  когда пользователь жмёт «назад» в браузере. Как именно хранится адрес —
//  деталь окружения, поэтому мы прячем её за объектом history с единым
//  интерфейсом:
//
//    history.location            — текущий путь ('/user/42')
//    history.push(path)          — перейти на новый адрес
//    history.replace(path)       — заменить текущий (без новой записи в истории)
//    history.listen(callback)    — подписаться на изменения адреса
//
//  Реализаций три: обычный URL (pushState), URL с решёткой (#/path) и «в памяти»
//  (для тестов и сервера, где нет объекта window).
// ============================================================================

// --- 1. Обычные «красивые» URL через History API ---------------------------
// /about, /user/42 — без решётки. Требует настройки сервера (любой путь должен
// отдавать index.html), зато адреса чистые.
export function createWebHistory() {
  const listeners = []
  const notify = (path) => listeners.forEach((cb) => cb(path))

  // Кнопки «назад/вперёд» браузера стреляют событием popstate.
  window.addEventListener('popstate', () => notify(window.location.pathname))

  return {
    get location() {
      return window.location.pathname
    },
    push(path) {
      window.history.pushState(null, '', path)
      notify(path)
    },
    replace(path) {
      window.history.replaceState(null, '', path)
      notify(path)
    },
    listen(cb) {
      listeners.push(cb)
    },
  }
}

// --- 2. URL с решёткой: /#/about -------------------------------------------
// Всё после # браузер серверу не отправляет, поэтому такой роутинг работает на
// любом статическом хостинге без настройки. Расплата — некрасивый адрес.
export function createWebHashHistory() {
  const listeners = []
  const notify = () => listeners.forEach((cb) => cb(current()))
  const current = () => window.location.hash.slice(1) || '/' // убираем '#'

  window.addEventListener('hashchange', notify)

  return {
    get location() {
      return current()
    },
    push(path) {
      window.location.hash = path // само вызовет hashchange → notify
    },
    replace(path) {
      const href = window.location.href.replace(/#.*$/, '') + '#' + path
      window.location.replace(href)
      notify()
    },
    listen(cb) {
      listeners.push(cb)
    },
  }
}

// --- 3. История «в памяти» --------------------------------------------------
// Никакого window: адрес хранится в обычной переменной. Нужна для тестов и для
// рендеринга на сервере (слой 7), где браузера нет.
export function createMemoryHistory(start = '/') {
  const listeners = []
  let location = start
  const notify = () => listeners.forEach((cb) => cb(location))

  return {
    get location() {
      return location
    },
    push(path) {
      location = path
      notify()
    },
    replace(path) {
      location = path
      notify()
    },
    listen(cb) {
      listeners.push(cb)
    },
  }
}
