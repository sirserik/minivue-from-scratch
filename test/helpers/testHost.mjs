// Fake "DOM" for the renderer tests. It implements the same set of operations
// as the browser's nodeOps/patchProp, but builds a plain in-memory JS tree.
// This lets us test the diff algorithm without a browser — and also proves the
// renderer really is platform-independent.
import { normalizeClass, styleToString } from '../../packages/shared.js'

// Nodes are plain objects. type: 'element' | 'text'.
function createElement(tag) {
  return { type: 'element', tag, props: {}, events: {}, children: [], parent: null }
}
function createText(text) {
  return { type: 'text', text: String(text), parent: null }
}
function setText(node, text) {
  node.text = String(text)
}
function setElementText(el, text) {
  // Like textContent: replaces all content with a single text node.
  el.children = text === '' ? [] : [{ type: 'text', text: String(text), parent: el }]
}
function detach(node) {
  const p = node.parent
  if (p) {
    const i = p.children.indexOf(node)
    if (i !== -1) p.children.splice(i, 1)
  }
  node.parent = null
}
function insert(child, parent, anchor = null) {
  // Move support: if the node already lived somewhere, detach it first.
  detach(child)
  child.parent = parent
  if (anchor == null) {
    parent.children.push(child)
  } else {
    const i = parent.children.indexOf(anchor)
    parent.children.splice(i === -1 ? parent.children.length : i, 0, child)
  }
}
function remove(child) {
  detach(child)
}
function patchProp(el, key, prev, next) {
  if (/^on[A-Z]/.test(key)) {
    // Store handlers separately so the test can call them manually.
    const name = key.slice(2).toLowerCase()
    if (next) el.events[name] = next
    else delete el.events[name]
    return
  }
  // Normalize class/style just like the browser patchProp — so the DOM holds
  // strings (object/array → string), as on a real page.
  if (key === 'class') {
    const c = normalizeClass(next)
    if (c) el.props.class = c
    else delete el.props.class
    return
  }
  if (key === 'style') {
    const s = styleToString(next)
    if (s) el.props.style = s
    else delete el.props.style
    return
  }
  if (next == null || next === false) delete el.props[key]
  else el.props[key] = next
}

export const testOptions = {
  createElement,
  createText,
  setText,
  setElementText,
  insert,
  remove,
  patchProp,
  parentNode: (n) => n.parent,
  nextSibling: (n) => {
    const p = n.parent
    if (!p) return null
    return p.children[p.children.indexOf(n) + 1] || null
  },
}

// Root container for rendering.
export function createRoot() {
  return { type: 'element', tag: 'root', props: {}, events: {}, children: [], parent: null }
}

// Serialize the tree into an HTML-like string — for readable assertions.
export function serialize(node) {
  if (node.type === 'text') return node.text
  const attrs = Object.keys(node.props)
    .sort()
    .map((k) => ` ${k}="${node.props[k]}"`)
    .join('')
  const inner = node.children.map(serialize).join('')
  if (node.tag === 'root') return inner
  return `<${node.tag}${attrs}>${inner}</${node.tag}>`
}

// Find the first node whose props.id === id (for identity checks).
export function findById(node, id) {
  if (node.type === 'element' && node.props.id === id) return node
  for (const c of node.children || []) {
    const found = findById(c, id)
    if (found) return found
  }
  return null
}
