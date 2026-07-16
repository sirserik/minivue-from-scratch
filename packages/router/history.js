// ============================================================================
//  history.js — three ways to store the "current URL"
// ----------------------------------------------------------------------------
//  The router needs to know which URL is open, be able to change it, and report
//  it when the user hits "back" in the browser. Exactly how the URL is stored is
//  an environment detail, so we hide it behind a history object with a single
//  interface:
//
//    history.location            — the current path ('/user/42')
//    history.push(path)          — navigate to a new URL
//    history.replace(path)       — replace the current one (no new history entry)
//    history.go(delta)           — move through the history stack (back/forward)
//    history.listen(callback)    — subscribe to URL changes; returns unlisten()
//    history.destroy()           — remove window listeners (app teardown)
//
//  There are three implementations: a plain URL (pushState), a hash URL (#/path),
//  and an in-memory one (for tests and the server, where there is no window).
// ============================================================================

// Shared subscription list. listen() must return an "unlisten" function —
// otherwise every subscriber (a router, a test) stays attached forever and
// keeps reacting to URLs long after its app was unmounted (a memory leak).
function createListeners() {
  const listeners = []
  return {
    notify: (path) => listeners.slice().forEach((cb) => cb(path)),
    listen(cb) {
      listeners.push(cb)
      return () => {
        const i = listeners.indexOf(cb)
        if (i > -1) listeners.splice(i, 1)
      }
    },
    clear: () => (listeners.length = 0),
  }
}

// --- 1. Plain "clean" URLs via the History API ------------------------------
// /about, /user/42 — no hash. Requires server setup (any path must serve
// index.html), but the URLs are clean.
/**
 * Create an HTML5 history using the browser History API and pushState.
 * @returns {object} a history object ({ location, push, replace, go, listen, destroy }).
 */
export function createWebHistory() {
  const { notify, listen, clear } = createListeners()

  // Full URL for the router = path + query + hash. The `|| ''` guards keep
  // this working in tests that stub window.location with only a pathname.
  const current = () =>
    window.location.pathname + (window.location.search || '') + (window.location.hash || '')

  // The browser's back/forward buttons fire a popstate event. We keep a named
  // reference to the handler so destroy() can remove exactly this listener.
  const onPopstate = () => notify(current())
  window.addEventListener('popstate', onPopstate)

  return {
    get location() {
      return current()
    },
    push(path) {
      window.history.pushState(null, '', path)
      notify(path)
    },
    replace(path) {
      window.history.replaceState(null, '', path)
      notify(path)
    },
    // Programmatic back/forward: the browser will answer with popstate → notify.
    go(delta) {
      window.history.go(delta)
    },
    listen,
    // Without this, every createWebHistory() call would leave a popstate
    // listener on window for the lifetime of the page.
    destroy() {
      window.removeEventListener('popstate', onPopstate)
      clear()
    },
  }
}

// --- 2. Hash URLs: /#/about -------------------------------------------------
// Everything after the # is not sent to the server, so this routing works on
// any static host without configuration. The trade-off is an ugly URL.
/**
 * Create a hash history that keeps the path after the URL hash (#/about).
 * Works on any static host without server configuration.
 * @returns {object} a history object ({ location, push, replace, go, listen, destroy }).
 */
export function createWebHashHistory() {
  const { notify, listen, clear } = createListeners()
  const current = () => window.location.hash.slice(1) || '/' // strip the '#'

  // The browser fires hashchange both for user navigation AND for our own
  // hash writes below. Deduplicate: only notify when the path really changed,
  // otherwise replace() would notify twice (once manually, once via the
  // browser's hashchange for the same URL).
  let lastPath = current()
  const notifyIfChanged = () => {
    const path = current()
    if (path === lastPath) return
    lastPath = path
    notify(path)
  }

  window.addEventListener('hashchange', notifyIfChanged)

  return {
    get location() {
      return current()
    },
    push(path) {
      window.location.hash = path // this itself triggers hashchange → notify
      notifyIfChanged() // fallback for environments where hashchange is async/missing
    },
    replace(path) {
      const href = window.location.href.replace(/#.*$/, '') + '#' + path
      // location.replace also fires hashchange in real browsers — the
      // deduplication above turns the second call into a no-op.
      window.location.replace(href)
      notifyIfChanged()
    },
    go(delta) {
      window.history.go(delta)
    },
    listen,
    destroy() {
      window.removeEventListener('hashchange', notifyIfChanged)
      clear()
    },
  }
}

// --- 3. In-memory history ---------------------------------------------------
// No window: the URL lives in a plain array. Needed for tests and for
// server-side rendering (layer 7), where there is no browser. Unlike the two
// browser histories it keeps its own stack, so go/back/forward work too.
/**
 * Create an in-memory history for tests and server-side rendering.
 * @param {string} [start='/'] - the initial path.
 * @returns {object} a history object ({ location, push, replace, go, back, forward, listen, destroy }).
 */
export function createMemoryHistory(start = '/') {
  const { notify, listen, clear } = createListeners()
  // The stack mirrors the browser's session history: push appends, back/forward
  // move an index without changing the stack.
  const stack = [start]
  let index = 0

  return {
    get location() {
      return stack[index]
    },
    push(path) {
      // A new entry erases any "forward" entries — just like a real browser.
      stack.splice(index + 1)
      stack.push(path)
      index++
      notify(path)
    },
    replace(path) {
      stack[index] = path
      notify(path)
    },
    go(delta) {
      const target = index + delta
      // Out of bounds — the browser silently ignores it; so do we.
      if (target < 0 || target >= stack.length) return
      index = target
      notify(stack[index])
    },
    back() {
      this.go(-1)
    },
    forward() {
      this.go(1)
    },
    listen,
    destroy: clear,
  }
}
