// Mini-DOM for the hydration test: unlike testHost.mjs (flat children arrays),
// here nodes support browser-style traversal — firstChild, nextSibling,
// parentNode — which the hydrate function needs. Plus addEventListener, to
// verify that handlers get attached during hydration.

class SNode {
  constructor(nodeType) {
    this.nodeType = nodeType // 1 = element, 3 = text
    this.childNodes = []
    this.parentNode = null
    this.attrs = {}
    this.events = {}
    this.nodeValue = ''
  }
  get firstChild() {
    return this.childNodes[0] || null
  }
  get nextSibling() {
    const p = this.parentNode
    if (!p) return null
    return p.childNodes[p.childNodes.indexOf(this) + 1] || null
  }
  insertBefore(child, anchor) {
    if (child.parentNode) child.parentNode.removeChild(child)
    child.parentNode = this
    if (anchor == null) this.childNodes.push(child)
    else this.childNodes.splice(this.childNodes.indexOf(anchor), 0, child)
  }
  appendChild(child) {
    this.insertBefore(child, null)
  }
  removeChild(child) {
    const i = this.childNodes.indexOf(child)
    if (i !== -1) this.childNodes.splice(i, 1)
    child.parentNode = null
  }
  setAttribute(k, v) {
    this.attrs[k] = v
  }
  removeAttribute(k) {
    delete this.attrs[k]
  }
  addEventListener(name, handler) {
    this.events[name] = handler
  }
  removeEventListener(name, handler) {
    if (this.events[name] === handler) delete this.events[name]
  }
  set textContent(t) {
    this.childNodes = []
    if (t !== '') {
      const tn = new SNode(3)
      tn.nodeValue = String(t)
      tn.parentNode = this
      this.childNodes.push(tn)
    }
  }
}

function el(tag) {
  const n = new SNode(1)
  n.tag = tag
  return n
}
function text(t) {
  const n = new SNode(3)
  n.nodeValue = String(t)
  return n
}

// Node operations for the renderer (like the browser's nodeOps, but over the shim).
export const shimOptions = {
  createElement: el,
  createText: text,
  setText: (n, t) => (n.nodeValue = String(t)),
  setElementText: (n, t) => (n.textContent = t),
  insert: (child, parent, anchor = null) => parent.insertBefore(child, anchor),
  remove: (child) => child.parentNode && child.parentNode.removeChild(child),
  parentNode: (n) => n.parentNode,
  nextSibling: (n) => n.nextSibling,
  patchProp(node, key, prev, next) {
    if (/^on[A-Z]/.test(key)) {
      const name = key.slice(2).toLowerCase()
      if (prev) node.removeEventListener(name, prev)
      if (next) node.addEventListener(name, next)
    } else if (next == null || next === false) {
      node.removeAttribute(key)
    } else {
      node.setAttribute(key, next === true ? '' : next)
    }
  },
}

export function createRoot() {
  const r = new SNode(1)
  r.tag = 'root'
  return r
}

// Build a "server" DOM from a VNode WITHOUT event handlers (as if the HTML
// came from the server). Hydration will attach the events afterwards.
export function buildServerDom(container, vnode, normalizeVNode) {
  build(vnode, container)
  function build(vnode, parent) {
    vnode = normalizeVNode(vnode)
    const { type } = vnode
    if (typeof type === 'symbol') {
      // Text/Fragment
      if (Array.isArray(vnode.children)) vnode.children.forEach((c) => build(c, parent))
      else parent.appendChild(text(vnode.children))
      return
    }
    const node = el(type)
    for (const key in vnode.props) {
      if (key === 'key' || /^on[A-Z]/.test(key)) continue // the server doesn't write events
      const v = vnode.props[key]
      if (v != null && v !== false) node.setAttribute(key, v === true ? '' : v)
    }
    const c = vnode.children
    if (typeof c === 'string' || typeof c === 'number') node.textContent = String(c)
    else if (Array.isArray(c)) c.forEach((ch) => build(ch, node))
    parent.appendChild(node)
  }
}

export function serialize(node) {
  if (node.nodeType === 3) return node.nodeValue
  const attrs = Object.keys(node.attrs)
    .sort()
    .map((k) => ` ${k}="${node.attrs[k]}"`)
    .join('')
  const inner = node.childNodes.map(serialize).join('')
  if (node.tag === 'root') return inner
  return `<${node.tag}${attrs}>${inner}</${node.tag}>`
}

export function findByTag(node, tag) {
  if (node.nodeType === 1 && node.tag === tag) return node
  for (const c of node.childNodes) {
    const f = findByTag(c, tag)
    if (f) return f
  }
  return null
}
