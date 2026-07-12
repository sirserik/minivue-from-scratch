# The JavaScript You'll Need

This chapter isn't a full language course — it's a glossary. It covers exactly the
constructs that show up in our code, and nothing extra. If you already know
JavaScript, skim it and move on to reactivity. If you don't, read it once and then
come back to it as a reference whenever an unfamiliar symbol turns up in the code.

## Values and variables

A value is a piece of data: the number `42`, the string `"hello"`, the boolean
`true` or `false`, or "nothing" — `null` and `undefined`. A variable is a name for
a value.

```js
const name = 'Anya'  // const — a name you can't reassign
let count = 0        // let — a name you can change
count = count + 1    // now count is 1
```

`const` doesn't mean "the value is immutable" — it means "you can't reassign this
name." You can still change the object a `const` name points to; you just can't say
`name = another object`. Default to `const`, and reach for `let` only when you
genuinely need to reassign.

## Functions

A function is a reusable block of actions that you can run many times, feeding it
different inputs (arguments).

```js
function double(x) {
  return x * 2
}
double(21) // 42
```

There's a shorter form — the arrow function. We'll see it constantly.

```js
const double = (x) => x * 2       // single expression — return is implied
const log = (msg) => {            // body in braces — you write return yourself
  console.log(msg)
}
const now = () => Date.now()      // no arguments — empty parentheses
```

You can pass a function to another function as an argument — that's a "callback," a
handler function. All of reactivity is built on taking someone else's function and
deciding when to call it:

```js
effect(() => {
  console.log('rerun me when the data changes')
})
```

## Objects

An object is a set of "key: value" pairs. Keys (properties) are read and written
with a dot.

```js
const user = { name: 'Anya', age: 30 }
user.name       // 'Anya'  — reading
user.age = 31   // writing
user.city = 'Almaty' // adding a new property
```

Remember the phrases **property read** and **property write** — the whole first
chapter revolves around them. Reactivity is intercepting exactly these two
operations.

## Arrays

An array is an ordered list of values. Indexing starts at zero.

```js
const items = [10, 20, 30]
items[0]        // 10
items.length    // 3
items.push(40)  // add to the end → [10, 20, 30, 40]
items.reduce((sum, x) => sum + x, 0) // 100 — "fold" into a single number
```

`reduce` walks the elements and accumulates a result: start at `0`, add each
element's value. That's how we'll compute a cart total.

## Destructuring and spread

You can "unpack" an object or array into separate variables:

```js
const { name, age } = user       // name = 'Anya', age = 31
const [first, second] = items    // first = 10, second = 20
```

Three dots `...` mean "spread the rest." In our code you'll see it as "make a
copy":

```js
const copy = [...items]          // a new array with the same elements
```

This line will save us in reactivity: before iterating over a set of effects, we
copy it so that changes made during iteration don't break the loop.

## Classes, getters, and setters

A class is a template for creating objects with shared behavior. `new` creates an
instance, `constructor` sets up the initial state, and `this` inside means "this
particular instance."

```js
class Counter {
  constructor(start) {
    this.value = start   // instance field
  }
  increment() {
    this.value++
  }
}
const c = new Counter(5)
c.increment()
c.value // 6
```

A special pair is the **getter** and **setter**. These are methods that look like
an ordinary property from the outside, but run code on read/write. That's exactly
how `ref` works: reaching for `.value` looks like a field, but actually runs a
function.

```js
class Box {
  constructor(v) { this._v = v }
  get value() {           // runs on a READ of box.value
    console.log('read')
    return this._v
  }
  set value(newV) {       // runs on a WRITE of box.value = ...
    console.log('wrote')
    this._v = newV
  }
}
const box = new Box(1)
box.value        // prints "read", returns 1
box.value = 2    // prints "wrote"
```

The underscore in `_v` is just a convention meaning "this is an internal field,
don't touch it from outside." The language doesn't enforce it, but that's the
custom.

## Set, Map, and WeakMap

Besides arrays and objects, we need three special collections.

**Set** — a collection of unique values. Add the same thing twice, and it's stored
once. Perfect for "the list of effects subscribed to a property": one effect
shouldn't land there twice.

```js
const s = new Set()
s.add('a'); s.add('a'); s.add('b')
s.size          // 2
s.has('a')      // true
s.delete('b')
```

**Map** — like an object, but the key can be anything, including another object.
That's critical for us: we'll be linking a reactive object to its dependencies.

```js
const m = new Map()
m.set('key', 123)
m.get('key')    // 123
```

**WeakMap** — the same as Map, but with "weak" object keys: if nothing else
references a key object anymore, the garbage collector is free to remove it along
with its entry. This way the dependency store doesn't keep objects alive that are
no longer needed.

## Symbol

`Symbol('name')` creates a unique marker value that's guaranteed not to collide
with any string key. We use symbols as internal "hidden" properties — for example,
a marker meaning "this object is already reactive," which can't be confused with
the user's real data.

```js
const IS_REACTIVE = Symbol('isReactive')
obj[IS_REACTIVE] // no ordinary property will ever land here by accident
```

## Proxy and Reflect

Here's the main tool of reactivity. **Proxy** wraps an object and lets you
intercept operations on it — first and foremost reads (`get`) and writes (`set`).

```js
const raw = { count: 0 }
const proxy = new Proxy(raw, {
  get(target, key) {
    console.log('reading', key)
    return target[key]
  },
  set(target, key, value) {
    console.log('writing', key, '=', value)
    target[key] = value
    return true   // set must return true on success
  },
})
proxy.count       // prints "reading count", returns 0
proxy.count = 5   // prints "writing count = 5"
```

`reactive` grows out of this tiny bit of interception: in `get` we'll call
"remember who read this," and in `set` we'll call "wake up whoever read it."

**Reflect** — a set of functions that mirror the standard operations.
`Reflect.get(target, key, receiver)` is the same as `target[key]`, but it correctly
passes `this` to getters and works with inheritance. Inside a Proxy the right thing
is to use `Reflect`, not `target[key]` directly — otherwise tricky objects will
break.

## Object.is

Comparing "did the value change?" A plain `===` works almost everywhere, but it has
some historical quirks: `NaN === NaN` gives `false`, even though it's "the same
thing." `Object.is` fixes those. We'll ask "is the value really different?" via
`!Object.is(old, new)` so we don't wake up the interface when assigning the same
value.

## Modules: import and export

Code is split into module files. A file shares things by `export`-ing them and
grabs other files' things via `import`.

```js
// effect.js
export function track() { /* ... */ }
export let activeEffect = undefined

// reactive.js
import { track, activeEffect } from './effect.js'
```

The path is written with the `.js` extension and with `./` for neighboring files —
that's what the browser ES modules standard requires, and we use it without a
bundler.

## optional chaining and `!!`

`a?.b` reads `a.b`, but if `a` is `null` or `undefined`, it calmly returns
`undefined` instead of throwing. `!!x` turns any value into an honest `true`/`false`
(two "nots": the first inverts, the second flips it back). When you see `return
!!(value && value.__isRef)`, it just means "return true if value has the `__isRef`
flag."

This glossary is enough to read any line of our framework. Don't memorize it all —
keep this chapter handy and come back as needed. Now, on to the heart of Vue.
