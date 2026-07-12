// ============================================================================
//  directives.js — custom directives used by the shop.
//  Both are written to be safe outside a browser (no DOM → they do nothing).
// ============================================================================

// v-focus — focus the element when it mounts (used on the search field).
export const focus = {
  mounted(el) {
    if (el && typeof el.focus === 'function') el.focus()
  },
}

// A tiny transparent-grey SVG shown when a product image fails to load.
const FALLBACK =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">' +
      '<rect width="100%" height="100%" fill="#eef1f4"/>' +
      '<text x="50%" y="50%" fill="#9ca3af" font-family="sans-serif" font-size="14" ' +
      'text-anchor="middle" dominant-baseline="middle">no image</text></svg>',
  )

// v-img-fallback — swap a broken <img> for the placeholder above.
export const imgFallback = {
  mounted(el) {
    if (!el || typeof el.addEventListener !== 'function') return
    el.__onError = () => {
      if (el.src !== FALLBACK) el.src = FALLBACK
    }
    el.addEventListener('error', el.__onError)
  },
  unmounted(el) {
    if (el && el.__onError) el.removeEventListener('error', el.__onError)
  },
}
