# The Template Compiler

So far we've written markup with a `render` function and calls to `h`. That works,
but it's clunky: compare `h('li', { key: t.id }, t.text)` with the familiar `<li
:key="t.id">{{ t.text }}</li>`. Templates read like HTML, which makes them clearer.
The compiler is a translator: it turns a template string into exactly that render
function full of `h` calls. No new runtime magic appears — just convenient syntax on
top.

Chapter code: `packages/compiler/`. Tests — `test/compiler.test.mjs`, demo —
`playground/04-compiler.html`.

## Three translation steps

The compiler works in three passes, and this is the classic scheme of any compiler:

1. **Parsing** (`parse.js`): string → tree of objects (AST). The text «`<p>{{ msg
   }}</p>`» turns into the structure «element p, containing interpolation msg».
2. **Transformation**: turn raw attributes into meaningful directives (`v-if`,
   `v-for`, `:bind`, `@on`). We fold this step into generation for simplicity.
3. **Generation** (`compile.js`): walk the tree and build a string of code
   `h('p', null, [_s(msg)])`, then turn that string into a real function.

The output is a function indistinguishable from one you'd write by hand. The runtime
from layers 1–3 knows nothing about the compiler: it doesn't care where the render
function came from.

## Parsing: from text to tree

A computer doesn't understand text structurally — to it, «`<div>`» is just five
characters. The parser walks the string left to right and, recognizing familiar
shapes (tag, text, `{{`), builds a tree of nodes. We write it as a «recursive
descent»: for nested tags the function calls itself.

```js
function parseChildren(context) {
  const nodes = []
  while (!isEnd(context)) {
    // Remember how much input is left: every loop iteration MUST consume at
    // least one character, otherwise we would spin forever on the same spot.
    const lengthBefore = context.source.length

    const s = context.source
    let node = null
    if (s.startsWith('<!--')) {
      parseComment(context) // comments produce no output — just skip them
    } else if (s.startsWith('{{')) {
      node = parseInterpolation(context)
    } else if (s[0] === '<' && /[a-zA-Z]/.test(s[1])) {
      node = parseElement(context)
    } else {
      // Everything else is text — including a lone '<' that does not start a
      // tag (e.g. "5 < 10" or "i <3 vue").
      node = parseText(context)
    }
    if (node) nodes.push(node)

    // The progress guarantee. If a branch above ever consumes nothing, we fail
    // loudly instead of hanging the whole program in an infinite loop.
    if (context.source.length === lengthBefore) {
      parseError(context, 'Parser made no progress — cannot understand this input')
    }
  }
  return condenseWhitespace(nodes)
}
```

`context.source` is the remaining, not-yet-parsed part of the string. Each function
«bites off» the recognized chunk from its start (`advanceBy`). `parseElement` reads
the tag and attributes, then recursively calls `parseChildren` for the contents
until it hits the closing `</tag>`. That's how a tree grows out of a flat string.

Two chores hide at the edges of the loop. Comments `<!-- -->` are recognized and
skipped — they produce no node at all. And `condenseWhitespace` cleans up at the
end: a whitespace-only text node with a newline in it is code formatting and gets
dropped, while a deliberate space between inline elements survives as a single
`' '`. Text and attribute values also decode HTML entities (`&amp;` → `&`) — our
templates never pass through the browser's parser, so nobody else would do it.

Nodes come in three types: `Element` (a tag with attributes and children), `Text`
(plain text), and `Interpolation` (an insertion `{{ expression }}`). The parser
collects attributes as raw `{ name, value }` pairs without probing their meaning —
figuring out that `v-if` is a condition and `@click` is a handler is the next step's
job.

## A gotcha: a parser must always move forward

The progress check in `parseChildren` is a scar from a real bug. The original loop
had no such guarantee, and a template with an innocent `<!-- -->` froze the page:
there was no comment branch, `parseText` stops at every `<`, so an iteration
consumed zero characters — and the `while` loop asked about the same spot forever.
The fixed parser makes it a rule: every branch must consume at least one character,
and an iteration that eats nothing is a loud compile error, not a silent hang.

## Generation: from tree to code

Now we build a string of code from the tree. Each node type gets its own rule:

```js
function genNode(node) {
  switch (node.type) {
    case 'Element':       return genElement(node)
    case 'Text':          return JSON.stringify(node.content)  // "hello"
    case 'Interpolation': return `_s(${node.content})`         // _s(msg)
  }
}
```

Text becomes a string literal (`JSON.stringify` escapes quotes along the way). The
insertion `{{ msg }}` becomes `_s(msg)` — a call to the helper `_s`, which coerces
the value to a string. An element becomes `h('tag', props, children)`, where `props`
and `children` are generated recursively from the attributes and nested nodes.

For `<div>hello</div>` you get exactly `h("div", null, ["hello"])` — what you'd write
yourself. You can confirm this in the test `codegen: element with text`, or right in
the demo, where the generated code for the app's template is shown under the app.

## Directives

The most interesting part is translating directives. When generating `props`, we
classify each attribute:

- a plain `class="btn"` → a static pair `"class": "btn"`;
- `:id="bid"` (shorthand for `v-bind`) → `"id": (bid)` — the value is computed as an
  expression;
- `@click="inc"` (shorthand for `v-on`) → `"onClick": (inc)` — the event name gets an
  `on` prefix and a capital letter, and the runtime from layer 2 already knows how to
  attach such handlers.

Handlers have a subtlety. `@click="inc"` is a reference to a method, and we leave it
as is: `(inc)`. But `@click="count++"` is an action expression, and it must be
wrapped, otherwise `count++` runs once at generation time rather than on click:

```js
function genHandler(on) {
  const exp = on.exp
  // ...
  const isMethodPath = /^[A-Za-z_$][\w$.]*$/.test(exp.trim())

  if (mods.length === 0) {
    return isMethodPath ? `(${exp})` : `$event => (${exp})`
  }
  // ... event modifiers (@click.stop) — that story comes in the forms chapter
}
```

`v-if` and `v-for` are «structural» directives: they control whether nodes appear at
all, not their attributes. `v-for="item in list"` wraps the node in the helper `_l`
(render list), which iterates over the list and returns an array of nodes:

```js
// <li v-for="item in items">{{ item }}</li>  turns into:
h(Fragment, null, [..._l(items, (item) => h("li", null, [_s(item)]))])
```

An array is not a vnode, and `render` must return exactly one — so when `v-for`
sits on the root element (perfectly legal, as here), the generator spreads the
array into an invisible `Fragment`. Inside a parent element the `_l(...)` call is
spread into that parent's children the same way.

`v-if` is generated at the level of the children list, because it needs access to a
neighboring `v-else`. The chain `v-if / v-else-if / v-else` is assembled into a
ternary operator:

```js
// <span v-if="ok">yes</span><span v-else>no</span>  →
(ok) ? h("span", null, ["yes"]) : h("span", null, ["no"])
```

With no `v-else`, the branch becomes `: null`, meaning «render nothing».

## From string to function: with(ctx)

The final trick is turning the generated string into a real function. Here a question
comes up: in the code `h("p", null, [_s(msg)])`, where does `msg` come from? It has to
come from the component's state, from `ctx`. Dragging `ctx.` in front of every name in
the generator is a chore. Instead, we wrap the body in `with(ctx)`:

```js
factory = new Function(
  'h',
  'Fragment',
  '_s',
  '_l',
  // ... plus the helpers of later chapters: _c, _key, _cd, _wd, _dir, _m, _th
  `return function render(ctx){ with(ctx){ return ${code} } }`,
)
```

`with(ctx)` forces every name inside to be looked up in `ctx` first. So `msg` resolves
as `ctx.msg`, and `count` as `ctx.count`, without a single `ctx.` in the code. The
helpers — `h`, `_s`, `_l` and, as the engine grows, seven more — come in as parameters
of the outer factory function, bypassing `ctx`. One more real-world touch: the
`new Function` call is wrapped in `try/catch` — a syntax error here means a broken
expression *from the template* (say, `@click="count +"`), so the rethrown error
quotes the generated code instead of pointing nowhere.

`with` is a rare and usually undesirable JavaScript operator, but here it fits, and
Vue's real runtime compiler uses the same trick (`with(this)`). For `with` to decide
correctly which name comes from `ctx` and which comes from the outer scope, we added a
`has` trap to the component context proxy (layer 3). It answers «yes» for state and
props, «no» for the compiler's helpers and a small whitelist of safe globals (`Math`,
`Date`, `JSON`…), and claims every *other* unknown name for itself: the template then
sees `undefined` and gets a one-time warning — instead of a typo falling through to
`window` or exploding as a raw `ReferenceError` mid-render.

## How the compiler hooks into the runtime

The runtime doesn't depend on the compiler directly — otherwise you couldn't build a
«lightweight» version without it. The link is established through registration:
importing `packages/compiler/index.js` calls `registerRuntimeCompiler(compile)`, and
from that point on a component with a `template` property is compiled automatically at
initialization (`finishComponentSetup` in layer 3). The full build
`packages/minivue.js` does this import for you — the way the main `vue` package
bundles both the runtime and the compiler. Compiling isn't free, so
`finishComponentSetup` caches the result per component definition in a `WeakMap`:
a list of a thousand identical components compiles its template once, not a
thousand times.

## What we simplified

Vue's real compiler does far more: static analysis and hoisting of unchanging nodes,
patch flags to speed up diffing, handler caching, slots, compilation in a separate
build step. (`v-model` and event modifiers like `@click.stop`, still missing here,
will be added in the forms chapter.) One shortcut is architectural: `compile.js`
imports `h` and `Fragment` straight from runtime-core — a layer inversion compared
to real Vue, where the compiler emits code that only *names* its helpers and the
runtime binds them when it registers the compiler. Binding the helpers on the spot
keeps the whole template→function story in one readable file, at the price of a
compiler that cannot live without runtime-core; Vue pays the opposite price — an
extra indirection layer — to ship a runtime-only build without the compiler and a
compiler that runs at build time without the runtime. We took the core idea —
parsing, generation, `with(ctx)` — and the most needed directives. That's enough to
understand how `<div>{{ x }}</div>` becomes a working interface, and to write real
applications with templates.

## Check yourself

```bash
npm test        # among others — 10 compiler tests
npm run serve   # http://localhost:5173/playground/04-compiler.html
```

The tests check both the generated code (`compileToString`) and the full cycle
«template → DOM»: interpolation, reactive updates, `@click`, `v-if/v-else`, `v-for`.
In the demo the todo list is now written as a template, and at the bottom of the page
you can see the code the compiler turned it into. Next up — the router: we'll teach
the app to show different pages based on the browser's address.
