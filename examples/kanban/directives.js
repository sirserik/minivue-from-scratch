// ============================================================================
//  directives.js — the app's custom directives
// ----------------------------------------------------------------------------
//  Both are written with a DOM-less environment in mind (tests, server): if the
//  element lacks the needed method or there is no document, the directive just
//  does nothing.
// ============================================================================

// v-focus — focus the field when it appears.
export const focus = {
  mounted(el) {
    if (el && typeof el.focus === 'function') el.focus()
  },
}

// v-click-outside="fn" — call fn on a click outside the element (close menu/modal).
export const clickOutside = {
  mounted(el, binding) {
    if (typeof document === 'undefined') return
    el.__onDocClick = (e) => {
      if (!el.contains(e.target)) binding.value(e)
    }
    document.addEventListener('click', el.__onDocClick, true)
  },
  unmounted(el) {
    if (typeof document === 'undefined') return
    document.removeEventListener('click', el.__onDocClick, true)
  },
}
