# The Virtual DOM and the Renderer

In the last chapter, reactivity updated `document.title` — a single line. A real
interface is a tree of hundreds of elements, and rebuilding it whole on every
change is too expensive: the browser stutters, input fields lose focus, scroll
position jumps. We need a way to touch only what actually changed. That's the
renderer's job, and the **virtual DOM** is what makes it possible.

The code for this chapter lives in `packages/runtime-core/` (the
platform-independent core) and `packages/runtime-dom/` (the browser binding).
Tests are in `test/renderer.test.mjs`, and the demo is `playground/02-vdom.html`.

## The idea: describe first, compare second

Touching the page directly (`document.createElement`, `el.appendChild`) is slow
and verbose. So we take a smarter route. First we describe what the interface
should look like, using plain objects. Such a description object is called a
**VNode** (virtual node). Then we hand that description to the renderer, and it
figures out which real operations on the page are needed.

The payoff: when the data changes, we build a new description and place it next
to the old one. The renderer compares the two descriptions (this is called a
**diff**) and applies only the difference to the real page. No "tear it all down
and repaint."

## VNode: a node as an object

A single VNode looks like this:

```js
{
  type,     // 'div' (tag), or Text, Fragment, or a component
  props,    // { id, class, onClick, ... }
  children, // a string, an array of child VNodes, or null
  key,      // key for matching items in lists (more on this below)
  el,       // reference to the real node — the renderer sets it on mount
}
```

`Text` and `Fragment` are special marker types (`Symbol`) with no tag. `Text` is
just text. `Fragment` is a group of nodes without a shared wrapper (for when you
need to return several elements without wrapping them in an extra `<div>`).

Writing these objects by hand is awkward, so there's a function `h` (from
"hyperscript"):

```js
h('div', { id: 'app' }, 'hello')
h('ul', [ h('li', 'one'), h('li', 'two') ])
```

`h` can tell whether you passed `props` or went straight to children, and either
way it assembles a correct VNode. `h` is exactly what our template compiler will
call in layer 4 — so `<div>{{ x }}</div>` ends up becoming a call to `h`.

## The renderer doesn't know about the browser

The key architectural decision is that the renderer isn't tied to the DOM. It
receives every operation on real nodes from the outside, through an `options`
object (we call it `nodeOps`): "create an element," "insert," "remove," "change
text." The diff algorithm itself is independent of them.

```js
export function createRenderer(options) {
  const {
    createElement: hostCreateElement,
    insert: hostInsert,
    remove: hostRemove,
    patchProp: hostPatchProp,
    // ...
  } = options
  // ... all of the diff lives inside ...
  return { render }
}
```

Why this abstraction? Because the same renderer then works anywhere. For the
browser, the operations come from `runtime-dom` (files `nodeOps.js` and
`patchProp.js`). For tests, an invented in-memory tree
(`test/helpers/testHost.mjs`), where we exercise the diff without any browser. For
the server in layer 7, there will be its own implementation. One algorithm,
three environments. Real Vue is built exactly this way.

## patch: compare old and new

The central function is `patch(n1, n2, container, anchor)`. It compares the old
node `n1` and the new node `n2`:

- `n1 === null` — the node appeared for the first time, so we **mount** it;
- `n1.type !== n2.type` — the nodes are incompatible (you can't turn a `div` into
  a `span`), so we remove the old one and mount the new one from scratch;
- otherwise — the types match, so we **update in place**: the most common and
  cheapest path.

`anchor` is the node to insert before. It's what lets us land in the right spot
among siblings; `null` means "at the end."

From there `patch` branches by the new node's type: text, fragment, element, or
component. For an element appearing for the first time, `mountElement` runs:

```js
function mountElement(vnode, container, anchor) {
  const { type, props, children } = vnode
  const el = (vnode.el = hostCreateElement(type)) // create and remember the node
  for (const key in props) {
    hostPatchProp(el, key, null, props[key])       // set attributes
  }
  if (typeof children === 'string') {
    hostSetElementText(el, children)               // text content
  } else if (Array.isArray(children)) {
    mountChildren(children, el, null)              // or children recursively
  }
  hostInsert(el, container, anchor)                // insert into the parent
}
```

Notice `vnode.el = ...`. We store the reference to the real node right on the
VNode. On the next update, the new VNode inherits this `el` — that's how we reuse
the existing element instead of creating a new one.

## Updating in place

When the types match, `patchElement` is called: it takes `el` from the old
VNode, compares attributes (`patchProps`) and children (`patchChildren`).

`patchProps` walks the new props (updating changed ones, adding new ones) and the
old props (removing ones that disappeared). The detail that's easy to forget is
removal: if a node had a `class` and the new description doesn't, the attribute
has to come off.

`patchChildren` handles the "was → became" cases. Children can be text, an array,
or empty. Most combinations are simple (became text — set the text; was text,
became an array — clear it and mount). One case is hard and deserves its own
discussion — an array turning into an array.

## Comparing lists by key

Picture a list of a thousand rows, and one gets added at the front. The naive
approach would compare pairwise: first with first, second with second — and
conclude that all thousand changed. A thousand needless edits instead of one
insertion.

The rescue is **keys**. We ask you to tag list items with a unique `key` (usually
an id from the data). Then the renderer matches nodes by key rather than by
position: "the node with key 42 was third, now it's first — don't recreate it,
just move it."

The `patchKeyedChildren` algorithm (the same one Vue 3 uses) works in several
passes:

1. **From the start**: while keys match, update nodes in place and move forward.
2. **From the end**: the same from the tail of the list. These two passes
   instantly dispatch the most common cases — items added or removed at the start
   or the end.
3. If only new nodes remain after that — mount them.
4. If only old nodes remain — unmount them.
5. If the middle is shuffled — build a "key → new index" map, update the matched
   nodes, remove the extras, and move the rest.

The fifth step hides one more optimization. Not every node needs moving — some
are already in the correct relative order. To find the largest such group, we
compute the **longest increasing subsequence** (LIS, the `getSequence` function).
Nodes in it we leave untouched, moving only the others. That keeps the number of
DOM rearrangements minimal.

You can verify this in the test "reversing a list keeps the nodes": we record the
real node objects before the rearrangement and confirm that after
`[a,b,c] → [c,b,a]` they're the same objects, just reordered. Not one is
recreated — which means focus, selection, and any other live state would have
survived.

## How this ties into reactivity

The renderer on its own knows nothing about reactivity — it's simply told "draw
this." One `effect` connects the two layers. Look at the demo `02-vdom.html`:

```js
effect(() => {
  render(view(), app) // view() builds a VNode tree from reactive state
})
```

`view()` reads reactive data (`people.value`), so the `effect` subscribed to it.
Change `people` — the `effect` reruns, builds a new tree, and `render` diffs it
and applies a targeted edit. Reactivity decides "when to repaint," the renderer
decides "how to repaint with minimal work."

This is essentially Vue in miniature already. Only one thing is missing — being
able to declare such a "state + view + effect" block as a reusable unit. That
unit is called a **component**, and it's the subject of the next layer.

## Check yourself

```bash
npm test          # reactivity and renderer tests
npm run serve     # http://localhost:5173/playground/02-vdom.html
```

The twelve checks in `renderer.test.mjs` cover mounting, attribute updates, all
children transitions, and — most importantly — keyed diff in every mode:
insertion, removal, reversal, complex rearrangement. In the demo, hit "Shuffle"
with the inspector open — you'll see the `<li>` elements move rather than blink
back into existence.
