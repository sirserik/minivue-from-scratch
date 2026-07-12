// ============================================================================
//  server-renderer — rendering to an HTML string on the server (SSR)
// ----------------------------------------------------------------------------
//  So far we've been drawing into the browser DOM. But the same VNode tree can
//  be turned not into nodes but into text — a ready HTML string. The server
//  sends it right away, and the user sees the content instantly, even before
//  JavaScript loads. That's SSR (server-side rendering): a fast first paint and
//  indexability by search engines.
//
//  There's no DOM and no reactive effect here — just tree traversal and string
//  concatenation. "Bringing this string to life" on the client (hydration) lives
//  in the renderer (layer 7), the hydrate function.
// ============================================================================

import { Text, Fragment, createVNode, normalizeVNode } from '../runtime-core/vnode.js'
import { createSSRComponent, createAppContext } from '../runtime-core/component.js'
import { normalizeClass, styleToString } from '../shared.js'

// Void tags: no content and no closing tag.
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link'])

/**
 * Render a VNode tree into an HTML string.
 * @param {object} vnode - The root VNode.
 * @returns {string} The serialized HTML.
 */
export function renderToString(vnode) {
  return renderVNode(normalizeVNode(vnode), null)
}

function renderVNode(vnode, parentComponent) {
  vnode = normalizeVNode(vnode)
  const { type } = vnode

  if (type === Text) {
    return escapeHtml(vnode.children)
  }
  if (type === Fragment) {
    return renderChildren(vnode.children, parentComponent)
  }
  if (typeof type === 'string') {
    return renderElement(vnode, parentComponent)
  }
  if (typeof type === 'object' || typeof type === 'function') {
    // Component: on the server we create an instance, run setup, get the subtree
    // and serialize it recursively.
    const { instance, subTree } = createSSRComponent(vnode, parentComponent)
    return renderVNode(subTree, instance)
  }
  return ''
}

function renderElement(vnode, parentComponent) {
  const { type: tag, props, children } = vnode
  const open = `<${tag}${renderAttrs(props)}>`
  if (VOID_TAGS.has(tag)) return open // <input ...> with no closing tag
  return open + renderChildren(children, parentComponent) + `</${tag}>`
}

function renderChildren(children, parentComponent) {
  if (children == null) return ''
  if (typeof children === 'string' || typeof children === 'number') {
    return escapeHtml(children)
  }
  if (Array.isArray(children)) {
    return children.map((c) => renderVNode(c, parentComponent)).join('')
  }
  return ''
}

// Serialize attributes. Events (onClick) are not emitted into HTML — they get
// attached on the client during hydration. class/style/booleans are special-cased.
function renderAttrs(props) {
  let out = ''
  for (const key in props) {
    if (key === 'key') continue
    if (/^on[A-Z]/.test(key)) continue // event handlers — client-only
    const value = props[key]
    if (value == null || value === false) continue

    if (key === 'class') {
      const cls = normalizeClass(value)
      if (cls) out += ` class="${escapeAttr(cls)}"`
    } else if (key === 'style') {
      const style = styleToString(value)
      if (style) out += ` style="${escapeAttr(style)}"`
    } else if (value === true) {
      out += ` ${key}` // boolean attribute: <input disabled>
    } else {
      out += ` ${key}="${escapeAttr(String(value))}"`
    }
  }
  return out
}

// Escape so user data can't break the markup or open an XSS hole.
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/**
 * Like createApp, but instead of mounting it returns an HTML string. Plugins
 * (router, pinia) are installed the same way via use().
 * @param {object|Function} rootComponent - The root component.
 * @param {object|null} [rootProps] - Props for the root component.
 * @returns {object} An SSR app instance exposing use/provide/component/directive
 *   and renderToString().
 */
export function createSSRApp(rootComponent, rootProps = null) {
  const context = createAppContext()

  const app = {
    _context: context,
    config: context.config, // for plugins: app.config.globalProperties
    use(plugin, ...options) {
      if (plugin && typeof plugin.install === 'function') plugin.install(app, ...options)
      else if (typeof plugin === 'function') plugin(app, ...options)
      return app
    },
    provide(key, value) {
      context.provides[key] = value
      return app
    },
    component(name, comp) {
      context.components[name] = comp
      return app
    },
    directive(name, def) {
      context.directives[name] = def
      return app
    },
    renderToString() {
      const vnode = createVNode(rootComponent, rootProps)
      vnode.appContext = context
      return renderVNode(vnode, null)
    },
  }
  return app
}
