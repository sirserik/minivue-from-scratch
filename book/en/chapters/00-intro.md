# Why Rebuild Vue from Scratch

There are two ways to understand a tool. The first is to read the manual and start
using it. The second is to take it apart and rebuild it yourself. This book is about
the second way. We won't learn to write applications with Vue — we'll write Vue itself.

That sounds intimidating, but there's nothing to fear. Inside, Vue isn't magic — it's
a handful of simple ideas stacked carefully on top of one another. Reactivity ("the
data changed, so the screen updated itself") is just intercepting reads and writes.
Components are functions that return a description of markup. The router is a
dictionary of "address → what to show." Each of these ideas fits in a hundred or two
hundred lines that read like plain prose. We'll go through all of them.

## What we'll build

By the end of the book we'll have a working mini-framework with the whole ecosystem
of real Vue 3:

- **Reactivity** — `ref`, `reactive`, `computed`, `watch`. The core that makes Vue
  exist in the first place.
- **Virtual DOM and the renderer** — how a description of the interface turns into
  real elements on the page, and how to update them surgically instead of
  redrawing everything.
- **Components** — `setup`, props, events (emit), slots, lifecycle hooks, `createApp`.
- **Template compiler** — how `<div>{{ count }}</div>` turns into a function.
- **Router** — an equivalent of Vue Router: addresses, params, `RouterView`, `RouterLink`.
- **Store** — an equivalent of Pinia: shared application state.
- **SSR** — server-side rendering and "coming alive" (hydration) on the client.

We deliberately use the same names as real Vue. Our `ref` is called `ref`, our
`createApp` is called `createApp`. So everything you understand here maps one-to-one
onto the real framework — there's just more code there, because it handles edge cases
that we'll sometimes skip for the sake of clarity.

## The ground rules: no build step

Normally, to run a Vue project, you install Node, then a bundler (Vite or Webpack),
and it "magically" turns your files into something the browser understands. For a
beginner that's the worst possible start: half of what's happening is hidden inside a
tool you don't yet understand.

So we have a rule: **no build step**. We write in plain ES modules — the standard the
browser understands on its own. A code file is wired into the page with a single
`<script type="module">` line, and `import` works inside it. Open the page, and the
code runs. Everything that happens, happens right in front of you, with no
middlemen.

We'll need Node.js for exactly two things: running tests and spinning up a tiny local
server so the browser will allow modules to load (from the `file://` scheme it won't
load them, for security reasons). The framework itself doesn't depend on Node — until
the chapter on SSR, where the server is the whole point.

## How the book and the repository are organized

Each layer is, at the same time:

- a **chapter** here in the book, where the idea is explained in words and pictures;
- a **folder in `packages/`** with working code, heavily commented;
- **tests in `test/`** that prove the code does what it promises;
- a **demo in `playground/`** you can open in the browser and poke at by hand.

I recommend keeping the code and the chapter side by side: read the explanation, then
open the file and find those exact lines. The code in the book and the code in the
repository are literally the same lines.

## Who this is for

For anyone who wants to understand, not just use. If you've never written JavaScript,
don't worry: the next chapter gives you exactly the minimum of the language you need
to read our code. If you already write Vue but it's a "black box" to you, this book
opens the box.

One warning: don't try to memorize everything at once. Reactivity in the first
chapter feels like a puzzle at first — that's normal. Get to the demo, poke the
buttons, come back to the code. The idea will click into place. And once it does,
everything else in Vue becomes an obvious consequence.

Here we go.
