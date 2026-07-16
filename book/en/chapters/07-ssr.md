# SSR and Hydration

Until now the app was born in the browser: JavaScript loaded, it built the DOM,
and only then did the user see any content. That has two problems. First, a blank
screen while the code loads and runs. Second, search crawlers often see an empty
page. The fix is to draw the app ahead of time, on the server, and ship ready-made
HTML. That is server-side rendering (SSR). And to make the shipped HTML come alive
and become interactive, the client "wakes it up" — that is hydration. Both
mechanisms are the topic of this final layer.

Code for this chapter: `packages/server-renderer/` (the server) and the `hydrate`
function in `packages/runtime-core/renderer.js` (the client). Tests are in
`test/ssr.test.mjs`; the live example is `playground/07-ssr/` (a Node server).

## Rendering to a string

The key observation: a VNode tree doesn't have to turn into DOM specifically. It's
just as easy to turn it into text — an HTML string. No browser is needed for that,
only a walk over the tree and some string concatenation. That's the job of
`renderToString`:

```js
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
    // component: create an instance, run setup, serialize the subtree
    const { instance, subTree } = createSSRComponent(vnode, parentComponent)
    // async setup() returns a Promise — a synchronous renderer must fail loudly
    if (instance.setupState && typeof instance.setupState.then === 'function') {
      throw new Error('async setup() is not supported by this renderToString')
    }
    return renderVNode(subTree, instance)
  }
  return ''
}
```

A text node becomes escaped text, an element becomes the string
`<tag attributes>children</tag>` (void tags like `<img>` or `<input>` — the full
HTML set of fourteen — get no closing tag), a component becomes the result of its
`render`. For a component on the server we create an instance and run `setup`
(`createSSRComponent`), but we don't set up a reactive effect: the server has
nothing to re-render, it needs a single snapshot. And if `setup` returned a
Promise (async `setup`), our synchronous renderer can't await it — instead of
silently serializing `undefined` everywhere the state should be, it fails loudly
with an explicit error.

Three details matter for correct HTML. First, **event handlers aren't serialized**:
`onClick` makes no sense in HTML, the handler will be attached on the client.
Second, **escaping**: user data goes through `escapeHtml`, otherwise the string
`<script>` inside text would turn into executable code (XSS). The test
"escaping against XSS" checks exactly this. Third, **attribute names**: a value
can be escaped, a name cannot — HTML simply has no escape syntax there — so a
name containing spaces, quotes, `<`, `>`, `/` or `=` would break out of its
position and inject markup. Like Vue's `isSSRSafeAttrName`, we refuse to render
such names.

## createSSRApp

Just as the browser has `createApp`, the server has `createSSRApp`: the same
interface with `use`, `provide`, `component`, but instead of `mount` there's a
`renderToString` method that returns HTML. Plugins (router, store) are wired up
the same way through `use`, so server rendering of a full app looks almost like
the client version — that's the point of "isomorphism": one codebase for two
environments.

## The whole server

For every page request the server (`playground/07-ssr/server.js`) does three
things:

```js
const appHtml = renderToString(createVNode(App)) // 1. draw the app into a string
res.end(page(appHtml))                           // 2. embed it into the HTML shell
// 3. the shell contains the <script> for client hydration
```

The shell is a plain HTML page where `<div id="app">` already holds the finished
markup, followed by the client script. The user sees the content instantly, before
a single line of JavaScript runs. Open "View Source" and you'll see the counter
already drawn there — that's SSR.

Notice: `App` is the very same module for server and client. The server imports it
in Node, the client imports it in the browser. This is an isomorphic app.

## The problem: HTML without life

The HTML the server ships is static. Buttons are drawn but don't react to clicks —
they have no handlers (we didn't serialize them). The naive fix is to just run a
normal `mount` on the client. But that would tear down all the server HTML and
create an identical copy from scratch: wasted work, flicker, lost state (cursor
position in an input, scroll offset). The right approach is not to create but to
"adopt" the nodes that are already there. That's hydration.

## hydrate: adopting the existing DOM

`hydrate` walks the VNode tree in parallel with the existing DOM. For each node it
doesn't create a new one — it links the VNode to the real node it finds
(`vnode.el = node`) and adds whatever the HTML lacks, above all event handlers:

```js
function hydrateNode(node, vnode, container) {
  vnode = normalizeVNode(vnode)
  const { type } = vnode
  const parent = (node && hostParentNode(node)) || container

  if (type === Text) {
    // … mismatch checks; split a browser-merged text node if needed (see below)
    vnode.el = node
    return hostNextSibling(node)
  }
  // … (Fragment: insert the invisible anchors and hydrate the children in place)
  if (typeof type === 'string') {
    // … tag mismatch check → warn and fall back to a client render of this subtree
    vnode.el = node                              // adopt the existing element
    for (const key in vnode.props) {
      if (key !== 'key') hostPatchProp(node, key, null, vnode.props[key]) // attach events
    }
    if (Array.isArray(vnode.children)) {
      let cur = node.firstChild
      for (let i = 0; i < vnode.children.length; i++) {
        const child = (vnode.children[i] = normalizeVNode(vnode.children[i]))
        cur = hydrateNode(cur, child, node)      // recurse into children
      }
    }
    return hostNextSibling(node)
  }
  // component — adopted "on top of" the node, with a reactive effect set up
  hydrateComponentImpl(vnode, node, parent)
  return getNextHostNode(vnode)
}
```

For a component, hydration does the same thing as mounting, except the first render
pass doesn't create the subtree through `patch(null, ...)` — it adopts the existing
DOM through `hydrateNode`. A normal reactive effect is set up in the process — so
from then on the component lives as usual: state changes, `patch` runs, but now
over the adopted nodes.

And when the server DOM and the client vnode genuinely disagree — a different tag,
different text — hydration doesn't crash: `handleHydrationMismatch` warns and falls
back to a client-side render of that subtree, mounting the vnode fresh in place of
the stale node (for text, it trusts the client and overwrites).

The test "hydrate adopts the DOM, attaches events, and updates" checks all of this
strictly: the server-side button node and the client-side one after hydration are
the same object (`Object.is`), meaning the node wasn't recreated; a handler appeared
on it; and a click changes state and patches that same button. That's exactly how,
after hydration, the static server HTML becomes a full-fledged SPA without a single
needless recreation.

## A gotcha: the browser merges adjacent text nodes

The server writes `<button>Clicks: 0</button>` as two text chunks — the static
`Clicks: ` and the dynamic `0` — but the HTML parser glues them into ONE DOM text
node, while the client vdom still holds two text vnodes. Naive hydration adopted
the merged node for the first vnode, asked for `nextSibling`, and walked off the
real DOM — everything after that point was mismatched. The fix in `hydrateNode`:
if the DOM text *starts with* the vnode's text, `splitText` cuts off the adopted
half and leaves the remainder for the next vnode.

## What we simplified

Real SSR in Vue is more involved in the details: it inserts comment nodes as anchors
for fragments and portals, serializes and transfers store state to the client
(`window.__INITIAL_STATE__`), supports streaming rendering, async `setup` and
`Suspense` (ours throws an explicit error instead of silently serializing a
Promise), and fragment caching; its mismatch handling is also far subtler than our
warn-and-rerender fallback. We built the skeleton — rendering a tree to a string
with escaping, an isomorphic server, and hydration that adopts nodes, attaches
events, survives browser-merged text nodes, and recovers from mismatches — which is
enough to understand how SSR works and to build a working example.

## Check yourself

```bash
npm test                          # among others — 7 tests for SSR and hydration
node playground/07-ssr/server.js  # then open http://localhost:5174/
```

The tests cover `renderToString` (attributes, absence of events, escaping, nested
components, void tags, `createSSRApp`) and the full hydration cycle. In the Node
example the server ships ready-made HTML and the client wakes it up — open the page
source to see the server markup, and click the buttons to confirm it came alive.

## Wrap-up

We've gone through all seven layers and built a working analog of Vue from scratch:
reactivity, a virtual DOM with fine-grained diffing, components, a template
compiler, a router, a store, and SSR. None of these mechanisms should be a black box
to you anymore — you wrote each one yourself. Now, when you open the real Vue, you'll
see not magic but familiar ideas, just polished to production quality. And that was
the goal all along: to understand how it works, from the inside.
