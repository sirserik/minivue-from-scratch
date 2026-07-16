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
    nextSibling: hostNextSibling,
    parentNode: hostParentNode,
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
    // The replacement must land where the OLD node stood — not at the caller's
    // anchor (which is often "end of container") — so ask the old vnode for
    // its right neighbor BEFORE unmounting it.
    if (n1 && n1.type !== n2.type) {
      anchor = getNextHostNode(n1)
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
      // A component (implementation from layer 3). KeepAlive activation and
      // deactivation are decided there too — the component layer knows about
      // instances and lifecycle hooks, the renderer doesn't have to.
      processComponent(n1, n2, container, anchor)
    }
  }

  // ---------------------------------------------------------------------------
  //  Where does a vnode "end" in the real tree? For an element or text node the
  //  answer is simply el.nextSibling. But a component's DOM is its subtree, and
  //  a fragment spans a RANGE of nodes ending at its end anchor. This helper
  //  answers uniformly — the diff uses it to find insertion positions.
  // ---------------------------------------------------------------------------
  function getNextHostNode(vnode) {
    if (vnode.component) {
      const sub = vnode.component.subTree
      return sub ? getNextHostNode(sub) : null
    }
    const edge = vnode.anchor || vnode.el // fragments end at their anchor
    return edge ? hostNextSibling(edge) : null
  }

  // ---------------------------------------------------------------------------
  //  move — relocate an already-mounted vnode without unmounting it. A plain
  //  node is one hostInsert; a component is its whole subtree; a fragment is
  //  its full node range: start anchor, every child, end anchor.
  // ---------------------------------------------------------------------------
  function move(vnode, container, anchor) {
    if (vnode.component) {
      move(vnode.component.subTree, container, anchor)
      return
    }
    if (vnode.type === Fragment) {
      hostInsert(vnode.el, container, anchor)
      for (const child of vnode.children) move(child, container, anchor)
      hostInsert(vnode.anchor, container, anchor)
      return
    }
    // Element, text, or a Teleport's placeholder (its children live in the
    // target container and don't move with the host position).
    hostInsert(vnode.el, container, anchor)
  }

  // --- Teleport -------------------------------------------------------------
  function processTeleport(n1, n2, container, anchor) {
    if (n1 == null) {
      // Put an empty anchor at the original spot (so siblings don't shift),
      // and mount the children into the target container.
      n2.el = hostCreateText('')
      hostInsert(n2.el, container, anchor)
      const target = (n2.target = resolveTeleportTarget(n2.props))
      if (target && Array.isArray(n2.children)) mountChildren(n2.children, target, null)
    } else {
      n2.el = n1.el
      const prevTarget = n1.target
      const nextTarget = resolveTeleportTarget(n2.props)
      if (prevTarget) {
        // Diff the children in the OLD target first (its anchors are stable),
        // and only then, if `to` changed, carry every child over to the new
        // container. Ignoring the new target here was a real bug: the computed
        // value used to be thrown away and children stayed put forever.
        n2.target = prevTarget
        patchChildren(n1, n2, prevTarget, null)
        if (nextTarget && nextTarget !== prevTarget) {
          n2.target = nextTarget
          for (const child of n2.children) move(child, nextTarget, null)
        }
      } else if (nextTarget) {
        // The target could not be resolved at mount time but exists now —
        // the children were never mounted, so mount them fresh.
        n2.target = nextTarget
        if (Array.isArray(n2.children)) mountChildren(n2.children, nextTarget, null)
      } else {
        n2.target = null
      }
    }
  }

  function resolveTeleportTarget(props) {
    const to = props && props.to
    if (typeof to === 'string') {
      return options.querySelector ? options.querySelector(to) : null
    }
    return to || null // the element itself was passed
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
  //  A fragment has no element of its own, yet the diff still needs SOMETHING
  //  to point at: "insert before the fragment", "where does the fragment end".
  //  So we bracket its children with two invisible empty text nodes — a start
  //  anchor (stored in vnode.el) and an end anchor (vnode.anchor), exactly like
  //  Vue. Siblings insert before the start anchor; the fragment's own children
  //  mount and shuffle strictly between the two.
  function processFragment(n1, n2, container, anchor) {
    if (n1 == null) {
      const start = (n2.el = hostCreateText(''))
      const end = (n2.anchor = hostCreateText(''))
      hostInsert(start, container, anchor)
      hostInsert(end, container, anchor)
      // Children go BETWEEN the anchors — i.e. before `end`.
      mountChildren(n2.children, container, end)
    } else {
      // Both are fragments: reuse the anchors and diff the children in place.
      n2.el = n1.el
      n2.anchor = n1.anchor
      // New or moved children must land before OUR end anchor, not at the end
      // of the shared container (other siblings may live after the fragment).
      patchChildren(n1, n2, container, n2.anchor)
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
          // move() (not a bare hostInsert) because the child may be a fragment
          // or a component whose DOM is a whole range of nodes.
          move(newChild, container, anchor)
        } else {
          // The node is at its correct relative position — no move needed.
          seqPointer--
        }
      }
    }
  }

  function unmountChildren(children, doRemove = true) {
    for (const child of children) unmount(child, doRemove)
  }

  // ---------------------------------------------------------------------------
  //  unmount — tear a vnode down. `doRemove` says whether this vnode's own DOM
  //  must be detached: when an ANCESTOR element is being removed wholesale, the
  //  descendants' DOM leaves with it, so we recurse with doRemove: false — the
  //  walk still has to happen (components must fire their unmount hooks and stop
  //  their effects, Teleports must clean their remote targets, directives must
  //  run), we just skip the redundant per-node hostRemove calls.
  // ---------------------------------------------------------------------------
  function unmount(vnode, doRemove = true) {
    if (vnode.type === Fragment) {
      // A fragment's children sit directly in the parent container, so each one
      // is removed individually; the two anchors go away with them.
      unmountChildren(vnode.children, doRemove)
      if (doRemove) {
        hostRemove(vnode.el)
        hostRemove(vnode.anchor)
      }
      return
    }
    if (vnode.type && vnode.type.__isTeleport) {
      // Teleport children live in ANOTHER container — they never disappear with
      // an ancestor's element, so they are always removed explicitly. If the
      // target never resolved, the children were never mounted: nothing to do.
      if (vnode.target) unmountChildren(vnode.children, true)
      if (doRemove) hostRemove(vnode.el)
      return
    }
    // Give components a chance to unmount properly (layer 3 fills this in;
    // KeepAlive deactivation is decided there too).
    if (vnode.component) {
      unmountComponent(vnode, doRemove)
      return
    }
    // Plain element or text node.
    invokeDirectives(vnode, 'beforeUnmount')
    if (Array.isArray(vnode.children)) {
      // Recurse even though the children's DOM will be removed together with
      // this element (doRemove: false) — see the note above the function.
      unmountChildren(vnode.children, false)
    }
    if (doRemove) hostRemove(vnode.el)
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
    hydrateNode(container.firstChild, vnode, container)
    container._vnode = vnode
  }

  // Server DOM and client vnodes disagree (a tag changed between the server
  // render and now, markup was tampered with, ...). We can't adopt the node —
  // warn and fall back to a CLIENT-side render of this subtree: mount the vnode
  // fresh in place of the stale node and drop the stale node.
  function handleHydrationMismatch(node, vnode, container) {
    console.warn(
      '[minivue] Hydration mismatch: server-rendered DOM does not match the client vnode tree.',
      node,
      vnode.type,
    )
    const next = node ? hostNextSibling(node) : null
    patch(null, vnode, container, node)
    if (node) hostRemove(node)
    return next
  }

  // Hydrate a single node: match the DOM node `node` with `vnode`. Returns the
  // next DOM node (the right sibling) — so we can walk the children in order.
  // `container` is the parent host node — needed when `node` is null (nothing
  // left to adopt) or when anchors must be inserted.
  function hydrateNode(node, vnode, container) {
    vnode = normalizeVNode(vnode)
    const { type } = vnode
    const parent = (node && hostParentNode(node)) || container

    if (type === Text) {
      const text = vnode.children
      if (text === '') {
        // An empty text vnode (a v-if that rendered nothing) produces NO output
        // on the server — there is no DOM node to claim. Create the empty node
        // so later patches have an el to work with, and leave `node` for the
        // next sibling vnode.
        const el = (vnode.el = hostCreateText(''))
        hostInsert(el, parent, node)
        return node
      }
      if (!node || node.nodeType !== 3) {
        return handleHydrationMismatch(node, vnode, parent)
      }
      if (node.nodeValue !== text) {
        // The HTML parser merges adjacent text: <button>Clicks: {{ n }}</button>
        // arrives as ONE DOM text node, while the client vdom has TWO text
        // vnodes. If the DOM text starts with ours, split the DOM node and
        // adopt the first half; the remainder stays for the next vnode.
        if (node.nodeValue.startsWith(text) && typeof node.splitText === 'function') {
          const rest = node.splitText(text.length)
          vnode.el = node
          return rest
        }
        // Genuinely different text: warn, but trust the client (it has the
        // live state) and overwrite.
        console.warn(
          `[minivue] Hydration text mismatch: server "${node.nodeValue}" vs client "${text}"`,
        )
        hostSetText(node, text)
      }
      vnode.el = node
      return hostNextSibling(node)
    }

    if (type === Fragment) {
      // Fragments need their start/end anchors even when hydrating (the server
      // HTML carries no markers), so create the invisible anchors in place.
      const start = (vnode.el = hostCreateText(''))
      hostInsert(start, parent, node)
      let cur = node
      for (let i = 0; i < vnode.children.length; i++) {
        const child = (vnode.children[i] = normalizeVNode(vnode.children[i]))
        cur = hydrateNode(cur, child, parent)
      }
      const end = (vnode.anchor = hostCreateText(''))
      hostInsert(end, parent, cur)
      return cur
    }

    if (typeof type === 'string') {
      // Mismatch check: the node must be an element with the same tag. The
      // browser DOM exposes tagName (uppercase); the test shim exposes tag.
      const domTag =
        node && node.nodeType === 1 ? String(node.tagName || node.tag || '').toLowerCase() : null
      if (domTag !== type.toLowerCase()) {
        return handleHydrationMismatch(node, vnode, parent)
      }
      // Element: link the node and attach props. Static attributes are already in
      // the HTML (setAttribute is idempotent), but events are added here.
      vnode.el = node
      for (const key in vnode.props) {
        if (key !== 'key') hostPatchProp(node, key, null, vnode.props[key])
      }
      // Hydrate the children via childNodes. Normalize them IN PLACE (like
      // mountChildren does) — later patches diff against these very arrays.
      if (Array.isArray(vnode.children)) {
        let cur = node.firstChild
        for (let i = 0; i < vnode.children.length; i++) {
          const child = (vnode.children[i] = normalizeVNode(vnode.children[i]))
          cur = hydrateNode(cur, child, node)
        }
      }
      return hostNextSibling(node)
    }

    if (typeof type === 'object' || typeof type === 'function') {
      // Component: hand it to the component system, which mounts "over" the
      // existing node and sets up a reactive effect for future updates. The
      // subtree may span several DOM nodes (fragment root), so ask the vnode
      // where it ends instead of trusting node.nextSibling.
      hydrateComponentImpl(vnode, node, parent)
      return getNextHostNode(vnode)
    }

    return node ? hostNextSibling(node) : null
  }

  // -- Stubs for components. Their bodies are supplied by layer 3 via
  //    __installComponents, and component hydration by layer 7.
  let processComponent = () => {
    throw new Error('Components appear in layer 3 (runtime-core/component.js)')
  }
  let unmountComponent = (vnode, doRemove = true) => {
    if (doRemove) hostRemove(vnode.el)
  }
  let hydrateComponentImpl = () => {
    throw new Error('Component hydration is not wired up')
  }

  // Let the component layer "inject" its own implementation without rewriting the
  // whole renderer. We hand back the internal functions components need (including
  // hydrateNode — needed to hydrate a component's subtree — and move/
  // getNextHostNode, which KeepAlive uses to stash and restore live DOM).
  function __installComponents(install) {
    const api = install({
      patch,
      unmount,
      render,
      options,
      mountChildren,
      hydrateNode,
      move,
      getNextHostNode,
    })
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
