// ============================================================================
//  renderer.js — turns a tree of VNodes into real nodes and updates them
// ----------------------------------------------------------------------------
//  The renderer doesn't know where it runs — in the browser, on the server, or
//  in a test. It receives all operations over "real" nodes from the outside, in
//  the options object (this is nodeOps). That way the same diff algorithm works
//  both with the DOM and with a made-up tree in a test. This is exactly how the
//  real Vue is built.
//
//  The main players:
//    render(vnode, container) — entry point: show vnode inside container
//    patch(n1, n2, ...)       — compare old node n1 with new n2, apply changes
//    mount* / patch* / unmount — concrete mount/update operations
// ============================================================================

import { Text, Fragment, normalizeVNode } from './vnode.js'

/**
 * Create a renderer bound to a set of platform node operations (nodeOps).
 * The renderer is platform-agnostic: give it browser DOM ops and it renders to
 * the DOM; give it test ops and it renders to a mock tree.
 * @param {object} options Host node operations (createElement, insert, patchProp, ...).
 * @returns {{ render: Function, hydrate: Function, createRenderer: Function, patch: Function, __installComponents: Function }}
 */
export function createRenderer(options) {
  // Unpack the platform operations. For the browser they come from runtime-dom.
  const {
    createElement: hostCreateElement,
    createText: hostCreateText,
    setText: hostSetText,
    setElementText: hostSetElementText,
    insert: hostInsert,
    remove: hostRemove,
    patchProp: hostPatchProp,
  } = options

  // -------------------------------------------------------------------------
  //  patch — the heart of the renderer. Compares n1 ("was") and n2 ("is now").
  //   n1 === null           → this is the node's first appearance, mount it.
  //   n1.type !== n2.type   → nodes are incompatible: remove the old, mount new.
  //   otherwise             → update in place (the most common and cheapest path).
  //  anchor — the "anchor": which node to insert before (needed to land in the
  //  right spot among siblings). null means "at the end".
  // -------------------------------------------------------------------------
  function patch(n1, n2, container, anchor = null) {
    // The very same object — nothing to compare.
    if (n1 === n2) return

    // Nodes of different types can't be updated into one another (a div won't
    // become a span). Remove the old one and continue down the mount branch.
    if (n1 && n1.type !== n2.type) {
      unmount(n1)
      n1 = null
    }

    const { type } = n2
    if (type === Text) {
      processText(n1, n2, container, anchor)
    } else if (type === Fragment) {
      processFragment(n1, n2, container, anchor)
    } else if (typeof type === 'string') {
      processElement(n1, n2, container, anchor)
    } else if (type && type.__isTeleport) {
      // Teleport (layer 11): children move to a different container.
      processTeleport(n1, n2, container, anchor)
    } else if (typeof type === 'object' || typeof type === 'function') {
      if (n1 == null && n2.__keptAlive) {
        // KeepAlive activation: don't mount again, return the hidden DOM instead.
        hostInsert(n2.component.subTree.el, container, anchor)
        n2.el = n2.component.subTree.el
      } else {
        // A regular component (implementation from layer 3).
        processComponent(n1, n2, container, anchor)
      }
    }
  }

  // --- Teleport -------------------------------------------------------------
  function processTeleport(n1, n2, container, anchor) {
    const target = resolveTeleportTarget(n2.props)
    if (n1 == null) {
      // Put an empty anchor at the original spot (so siblings don't shift),
      // and mount the children into the target container.
      n2.el = hostCreateText('')
      hostInsert(n2.el, container, anchor)
      n2.target = target
      if (target && Array.isArray(n2.children)) mountChildren(n2.children, target, null)
    } else {
      n2.el = n1.el
      n2.target = n1.target
      patchChildren(n1, n2, n1.target, null)
    }
  }

  function resolveTeleportTarget(props) {
    const to = props && props.to
    if (typeof to === 'string') {
      return options.querySelector ? options.querySelector(to) : null
    }
    return to || null // the element itself was passed
  }

  // A lazy "storage" — an off-DOM container where deactivated KeepAlive
  // components hide (their DOM lives there until they're shown again).
  let _storage = null
  function keepAliveStorage() {
    return _storage || (_storage = hostCreateElement('div'))
  }

  // --- Text nodes -----------------------------------------------------------
  function processText(n1, n2, container, anchor) {
    if (n1 == null) {
      // Mount a new text node. For Text, children is the string itself.
      n2.el = hostCreateText(n2.children)
      hostInsert(n2.el, container, anchor)
    } else {
      // Update: reuse the existing node, change only the text.
      n2.el = n1.el
      if (n2.children !== n1.children) {
        hostSetText(n2.el, n2.children)
      }
    }
  }

  // --- Fragments (a group of nodes without a parent tag) --------------------
  function processFragment(n1, n2, container, anchor) {
    if (n1 == null) {
      mountChildren(n2.children, container, anchor)
    } else {
      // Both are fragments: diff their children directly in the same container.
      patchChildren(n1, n2, container, anchor)
    }
  }

  // --- Elements (div, span, ul, ...) ---------------------------------------
  function processElement(n1, n2, container, anchor) {
    if (n1 == null) {
      mountElement(n2, container, anchor)
    } else {
      patchElement(n1, n2)
    }
  }

  function mountElement(vnode, container, anchor) {
    const { type, props, children } = vnode
    // 1. Create the element itself and remember a reference to it in vnode.el.
    const el = (vnode.el = hostCreateElement(type))

    // 2. Set attributes and handlers. oldValue = null (there aren't any yet).
    for (const key in props) {
      if (key === 'key') continue // key is internal, not written to the DOM
      hostPatchProp(el, key, null, props[key])
    }

    // 3. Insert the element into the parent FIRST — so that by the time children
    //    are mounted and directives' mounted hooks run, the node is already
    //    attached to the document. Otherwise el.focus() and the like in
    //    directives would run on a node detached from the page and wouldn't work.
    hostInsert(el, container, anchor)

    // 4. Mount the content: a string as text, an array child by child.
    if (typeof children === 'string' || typeof children === 'number') {
      hostSetElementText(el, String(children))
    } else if (Array.isArray(children)) {
      mountChildren(children, el, null)
    }

    // 5. Custom directives: the element is already in the DOM — call their mounted hook.
    invokeDirectives(vnode, 'mounted')
  }

  // Call the like-named hook of every directive attached to the vnode.
  function invokeDirectives(vnode, name) {
    const dirs = vnode.dirs
    if (!dirs) return
    for (const binding of dirs) {
      const hook = binding.dir && binding.dir[name]
      if (hook) hook(vnode.el, binding, vnode)
    }
  }

  function mountChildren(children, container, anchor) {
    for (let i = 0; i < children.length; i++) {
      // Normalize: strings/numbers become text VNodes.
      const child = (children[i] = normalizeVNode(children[i]))
      patch(null, child, container, anchor)
    }
  }

  function patchElement(n1, n2) {
    // Same-type element — reuse the real node.
    const el = (n2.el = n1.el)
    patchProps(el, n1.props, n2.props)
    patchChildren(n1, n2, el, null)

    // Directives: carry the previous values into oldValue and call the updated hook.
    if (n2.dirs) {
      n2.dirs.forEach((binding, i) => {
        binding.oldValue = n1.dirs ? n1.dirs[i].value : undefined
      })
      invokeDirectives(n2, 'updated')
    }
  }

  // Compare two sets of attributes: update/add new ones, remove disappeared ones.
  function patchProps(el, oldProps, newProps) {
    // Update and add.
    for (const key in newProps) {
      if (key === 'key') continue
      const prev = oldProps[key]
      const next = newProps[key]
      if (prev !== next) {
        hostPatchProp(el, key, prev, next)
      }
    }
    // Remove what's no longer present in the new props.
    for (const key in oldProps) {
      if (key === 'key') continue
      if (!(key in newProps)) {
        hostPatchProp(el, key, oldProps[key], null)
      }
    }
  }

  // -------------------------------------------------------------------------
  //  patchChildren — compare the content of a node. Children come in three
  //  kinds: text, an array of nodes, or empty. That gives nine "was → became"
  //  combinations, but they boil down to a few meaningful cases.
  // -------------------------------------------------------------------------
  function patchChildren(n1, n2, container, anchor) {
    const c1 = n1.children
    const c2 = n2.children

    if (typeof c2 === 'string' || typeof c2 === 'number') {
      // Became text. If it was an array, first remove the old children.
      if (Array.isArray(c1)) unmountChildren(c1)
      if (c1 !== c2) hostSetElementText(container, String(c2))
    } else if (Array.isArray(c2)) {
      if (Array.isArray(c1)) {
        // Array → array: the most interesting case, a full keyed diff.
        patchKeyedChildren(c1, c2, container, anchor)
      } else {
        // Was text/empty → became an array: clear the text and mount children.
        hostSetElementText(container, '')
        mountChildren(c2, container, anchor)
      }
    } else {
      // Became empty.
      if (Array.isArray(c1)) unmountChildren(c1)
      else if (typeof c1 === 'string') hostSetElementText(container, '')
    }
  }

  // -------------------------------------------------------------------------
  //  patchKeyedChildren — comparing two lists of children.
  //  Naively we could tear down the old ones and create new ones, but that's
  //  slow and loses state (input focus, video position). So we match nodes by
  //  key and reuse as many existing ones as possible, moving them when needed.
  //
  //  The algorithm (the same as in Vue 3):
  //   1) sync matching nodes from the START while keys match;
  //   2) sync matching nodes from the END;
  //   3) if only new ones remain — mount them;
  //   4) if only old ones remain — unmount them;
  //   5) the hard case (shuffled) — build a key map, patch the matched ones,
  //      remove the extra ones, and move minimally via the longest increasing
  //      subsequence (LIS).
  // -------------------------------------------------------------------------
  function patchKeyedChildren(c1, c2, container, parentAnchor) {
    // Normalize the new children up front (strings → text VNodes).
    for (let i = 0; i < c2.length; i++) c2[i] = normalizeVNode(c2[i])

    let i = 0
    let e1 = c1.length - 1 // last index in the old list
    let e2 = c2.length - 1 // last index in the new list

    // (1) Sync from the start: while keys match — update in place.
    while (i <= e1 && i <= e2 && isSameVNode(c1[i], c2[i])) {
      patch(c1[i], c2[i], container, parentAnchor)
      i++
    }

    // (2) Sync from the end.
    while (i <= e1 && i <= e2 && isSameVNode(c1[e1], c2[e2])) {
      patch(c1[e1], c2[e2], container, parentAnchor)
      e1--
      e2--
    }

    if (i > e1) {
      // (3) The old ones ran out but new ones remain (i..e2) — mount them.
      if (i <= e2) {
        // The anchor is the node standing right after the inserted range.
        const nextPos = e2 + 1
        const anchor = nextPos < c2.length ? c2[nextPos].el : parentAnchor
        while (i <= e2) {
          patch(null, c2[i], container, anchor)
          i++
        }
      }
    } else if (i > e2) {
      // (4) The new ones ran out but old ones remain (i..e1) — remove them.
      while (i <= e1) {
        unmount(c1[i])
        i++
      }
    } else {
      // (5) The general case: an overlapping, unordered range.
      const s1 = i // start in the old list
      const s2 = i // start in the new list

      // Map "new node key → its index", to quickly find matches.
      const keyToNewIndex = new Map()
      for (let k = s2; k <= e2; k++) {
        const child = c2[k]
        if (child.key != null) keyToNewIndex.set(child.key, k)
      }

      const toBePatched = e2 - s2 + 1 // how many new nodes are still left to process
      let patched = 0
      // newIndexToOldIndex[newRelativeIndex] = oldIndex + 1.
      // 0 means "no old node was found for this new one" → it must be mounted.
      const newIndexToOldIndex = new Array(toBePatched).fill(0)

      // Walk the remaining OLD nodes: patch the matched ones, remove the extra.
      for (let k = s1; k <= e1; k++) {
        const prevChild = c1[k]
        if (patched >= toBePatched) {
          // All new ones already found a pair — the rest of the old ones are extra.
          unmount(prevChild)
          continue
        }
        let newIndex
        if (prevChild.key != null) {
          newIndex = keyToNewIndex.get(prevChild.key)
        } else {
          // Keyless nodes are found by scanning the unpaired new ones.
          for (let j = s2; j <= e2; j++) {
            if (newIndexToOldIndex[j - s2] === 0 && isSameVNode(prevChild, c2[j])) {
              newIndex = j
              break
            }
          }
        }
        if (newIndex === undefined) {
          // The old node has no pair among the new ones — remove it.
          unmount(prevChild)
        } else {
          newIndexToOldIndex[newIndex - s2] = k + 1
          patch(prevChild, c2[newIndex], container, parentAnchor)
          patched++
        }
      }

      // Now move and mount. We go from the END so the anchor (the already-ready
      // right neighbor) always exists.
      const increasing = getSequence(newIndexToOldIndex) // indices that need not move
      let seqPointer = increasing.length - 1

      for (let k = toBePatched - 1; k >= 0; k--) {
        const newIndex = s2 + k
        const newChild = c2[newIndex]
        const anchor = newIndex + 1 < c2.length ? c2[newIndex + 1].el : parentAnchor

        if (newIndexToOldIndex[k] === 0) {
          // There was no pair — this is a new node, mount it.
          patch(null, newChild, container, anchor)
        } else if (seqPointer < 0 || k !== increasing[seqPointer]) {
          // The node exists but isn't in the "stable" subsequence — move it.
          hostInsert(newChild.el, container, anchor)
        } else {
          // The node is at its correct relative position — no move needed.
          seqPointer--
        }
      }
    }
  }

  function unmountChildren(children) {
    for (const child of children) unmount(child)
  }

  function unmount(vnode) {
    if (vnode.type === Fragment) {
      // A fragment has no node of its own — unmount its children.
      unmountChildren(vnode.children)
      return
    }
    if (vnode.type && vnode.type.__isTeleport) {
      // Teleport: remove the children from the target container and the anchor stub.
      unmountChildren(vnode.children)
      hostRemove(vnode.el)
      return
    }
    if (vnode.__shouldKeepAlive && vnode.component) {
      // KeepAlive deactivation: do NOT destroy the instance, hide its DOM in the
      // storage instead. The component's state is preserved until it's shown again.
      hostInsert(vnode.component.subTree.el, keepAliveStorage())
      return
    }
    // Give components a chance to unmount properly (layer 3 fills this in).
    if (vnode.component) {
      unmountComponent(vnode)
      return
    }
    // Directives: the hook before the element is removed from the DOM.
    invokeDirectives(vnode, 'beforeUnmount')
    hostRemove(vnode.el)
    invokeDirectives(vnode, 'unmounted')
  }

  // -------------------------------------------------------------------------
  //  render — the public entry point. It stores the previous VNode right on the
  //  container (container._vnode), so that the next call has something to
  //  compare against.
  // -------------------------------------------------------------------------
  function render(vnode, container) {
    if (vnode == null) {
      // render(null, ...) means "clear" — unmount the previous tree.
      if (container._vnode) unmount(container._vnode)
    } else {
      patch(container._vnode || null, vnode, container, null)
    }
    container._vnode = vnode
  }

  // -------------------------------------------------------------------------
  //  HYDRATION (layer 7). The server already sent ready-made HTML. On the client
  //  there's no need to create elements again — we need to "adopt" the existing
  //  ones: link our VNodes to the real nodes (vnode.el = node) and attach event
  //  handlers (which aren't in the HTML). After that the app lives as usual —
  //  changes go through patch over the already-adopted tree.
  // -------------------------------------------------------------------------
  function hydrate(vnode, container) {
    hydrateNode(container.firstChild, vnode)
    container._vnode = vnode
  }

  // Hydrate a single node: match the DOM node `node` with `vnode`. Returns the
  // next DOM node (the right sibling) — so we can walk the children in order.
  function hydrateNode(node, vnode) {
    vnode = normalizeVNode(vnode)
    const { type } = vnode

    if (type === Text) {
      vnode.el = node
      return node ? node.nextSibling : null
    }

    if (type === Fragment) {
      let cur = node
      for (const child of vnode.children) cur = hydrateNode(cur, child)
      return cur
    }

    if (typeof type === 'string') {
      // Element: link the node and attach props. Static attributes are already in
      // the HTML (setAttribute is idempotent), but events are added here.
      vnode.el = node
      for (const key in vnode.props) {
        if (key !== 'key') hostPatchProp(node, key, null, vnode.props[key])
      }
      // Hydrate the children via childNodes.
      if (Array.isArray(vnode.children)) {
        let cur = node.firstChild
        for (const child of vnode.children) cur = hydrateNode(cur, child)
      }
      return node.nextSibling
    }

    if (typeof type === 'object' || typeof type === 'function') {
      // Component: hand it to the component system, which mounts "over" the
      // existing node and sets up a reactive effect for future updates.
      hydrateComponentImpl(vnode, node)
      return node ? node.nextSibling : null
    }

    return node ? node.nextSibling : null
  }

  // -- Stubs for components. Their bodies are supplied by layer 3 via
  //    __installComponents, and component hydration by layer 7.
  let processComponent = () => {
    throw new Error('Components appear in layer 3 (runtime-core/component.js)')
  }
  let unmountComponent = (vnode) => hostRemove(vnode.el)
  let hydrateComponentImpl = () => {
    throw new Error('Component hydration is not wired up')
  }

  // Let the component layer "inject" its own implementation without rewriting the
  // whole renderer. We hand back the internal functions components need (including
  // hydrateNode — needed to hydrate a component's subtree).
  function __installComponents(install) {
    const api = install({ patch, unmount, render, options, mountChildren, hydrateNode })
    processComponent = api.processComponent
    unmountComponent = api.unmountComponent
    if (api.hydrateComponent) hydrateComponentImpl = api.hydrateComponent
  }

  return { render, hydrate, createRenderer, patch, __installComponents }
}

// Two VNodes are "the same" (one can be updated into the other) if both type and
// key match. A different key with the same tag means these are different logical
// nodes.
function isSameVNode(n1, n2) {
  return n1.type === n2.type && n1.key === n2.key
}

// ---------------------------------------------------------------------------
//  getSequence — the longest increasing subsequence (LIS).
//  Returns the indices of the array elements that form the longest increasing
//  chain. In the diff these are the nodes that are ALREADY in the correct
//  relative order — they can stay put while only the others are moved. This
//  keeps the number of DOM moves minimal. The implementation is the classic
//  O(n log n) algorithm with path reconstruction via a predecessor array.
// ---------------------------------------------------------------------------
function getSequence(arr) {
  const p = arr.slice() // predecessors: p[i] is the index of the previous item in i's chain
  const result = [0] // indices of the elements in the currently found chain
  let i, j, lo, hi, mid

  for (i = 0; i < arr.length; i++) {
    const arrI = arr[i]
    if (arrI === 0) continue // 0 = "new node", not taken into the chain

    j = result[result.length - 1]
    if (arr[j] < arrI) {
      // arrI is bigger than the last one — just extend the chain.
      p[i] = j
      result.push(i)
      continue
    }

    // Binary search for which chain element to replace with i.
    lo = 0
    hi = result.length - 1
    while (lo < hi) {
      mid = (lo + hi) >> 1
      if (arr[result[mid]] < arrI) lo = mid + 1
      else hi = mid
    }
    if (arrI < arr[result[lo]]) {
      if (lo > 0) p[i] = result[lo - 1]
      result[lo] = i
    }
  }

  // Reconstruct the chain via predecessors, walking from the end.
  let u = result.length
  let v = result[u - 1]
  while (u-- > 0) {
    result[u] = v
    v = p[v]
  }
  return result
}
