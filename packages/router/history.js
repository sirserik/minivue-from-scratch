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
//    history.listen(callback)    — subscribe to URL changes
//
//  There are three implementations: a plain URL (pushState), a hash URL (#/path),
//  and an in-memory one (for tests and the server, where there is no window).
// ============================================================================

// --- 1. Plain "clean" URLs via the History API ------------------------------
// /about, /user/42 — no hash. Requires server setup (any path must serve
// index.html), but the URLs are clean.
/**
 * Create an HTML5 history using the browser History API and pushState.
 * @returns {object} a history object ({ location, push, replace, listen }).
 */
export function createWebHistory() {
  const listeners = []
  const notify = (path) => listeners.forEach((cb) => cb(path))

  // The browser's back/forward buttons fire a popstate event.
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

// --- 2. Hash URLs: /#/about -------------------------------------------------
// Everything after the # is not sent to the server, so this routing works on
// any static host without configuration. The trade-off is an ugly URL.
/**
 * Create a hash history that keeps the path after the URL hash (#/about).
 * Works on any static host without server configuration.
 * @returns {object} a history object ({ location, push, replace, listen }).
 */
export function createWebHashHistory() {
  const listeners = []
  const notify = () => listeners.forEach((cb) => cb(current()))
  const current = () => window.location.hash.slice(1) || '/' // strip the '#'

  window.addEventListener('hashchange', notify)

  return {
    get location() {
      return current()
    },
    push(path) {
      window.location.hash = path // this itself triggers hashchange → notify
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

// --- 3. In-memory history ---------------------------------------------------
// No window: the URL lives in a plain variable. Needed for tests and for
// server-side rendering (layer 7), where there is no browser.
/**
 * Create an in-memory history for tests and server-side rendering.
 * @param {string} [start='/'] - the initial path.
 * @returns {object} a history object ({ location, push, replace, listen }).
 */
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
