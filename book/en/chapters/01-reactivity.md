# Reactivity

Everything in Vue rests on one ability: data changes, and whatever depends on it
updates by itself. You change `count`, and the number on screen becomes different,
even though you never wrote "find the element and update its text." This chapter is
about how that works. We'll build reactivity in full, and from here on the whole
framework is just a layer on top of it.

The code for this chapter lives in `packages/reactivity/`. Tests are in
`test/reactivity.test.mjs`, and the live demo is `playground/01-reactivity.html`.

## The problem in one sentence

We want to be able to write this:

```js
const count = ref(0)

effect(() => {
  document.title = 'Clicks: ' + count.value
})

count.value = 5   // and the tab title becomes "Clicks: 5" on its own
```

The idea is simple. There's data (`count`) and there's a function that uses it
(`effect`). We want the function to re-run when the data changes — by itself,
without our involvement. So the system needs to somehow learn that this function
"depends" on `count`. And it can learn that at exactly one moment — when the function
reads `count.value`. Everything is built around this idea.

## Two verbs: track and trigger

Remember these two words; the rest of the book revolves around them.

- **track** — happens on a **read**. The meaning: "some function is running right
  now, and it read this value — let's remember the connection."
- **trigger** — happens on a **write**. The meaning: "the value changed — let's find
  every function that read it and re-run them."

Read — remember the dependency. Write — use the dependency. Everything else is
details of how those dependencies are stored.

## An effect is a function you can re-run

The function that has to re-run on changes is what we call an **effect**. So the
system can manage it, we wrap it in an object. That way we can attach bookkeeping
data to the function.

The key variable is `activeEffect`. While an effect's body is running, this variable
holds that effect. Any data read at that moment knows "whom" to assign the dependency
to. Outside effects it's `undefined`, and a read tracks nothing.

```js
// packages/reactivity/effect.js
export let activeEffect = undefined
const effectStack = []
```

Why a stack? Effects can be nested (a component, and inside it a computed value).
When the inner effect finishes, the outer one has to become "active" again. The stack
handles exactly that: push on entry, pop on exit.

The effect itself is the `ReactiveEffect` class:

```js
export class ReactiveEffect {
  constructor(fn, scheduler = null) {
    this.fn = fn
    this.scheduler = scheduler
    this.deps = []
    this.active = true
  }

  run() {
    if (!this.active) return this.fn()
    cleanup(this)                 // forget old dependencies
    try {
      effectStack.push(this)
      activeEffect = this         // "I'm listening now"
      return this.fn()            // run it — tracks happen inside
    } finally {
      effectStack.pop()
      activeEffect = effectStack[effectStack.length - 1]
    }
  }
}
```

The magic is in the `run` method. Before calling the function it declares itself
active (`activeEffect = this`). While the function runs and reads data, every read
sees this `activeEffect` and records the dependency. As soon as the function
finishes, we pop ourselves off the stack and restore whoever was active before us.
The `try/finally` wrapper guarantees the active effect is restored even if an error
happens inside.

We'll cover `scheduler` and `cleanup` shortly — first let's see how the dependencies
are stored.

## Where the dependencies live: targetMap

We need to store which effects depend on which property of which object. The
structure is three levels deep:

```
targetMap: WeakMap {
  reactiveObject → depsMap: Map {
    'property' → dep: Set(effect1, effect2, …)
  }
}
```

Read it as: "for this object, for this property of it — here is the set of effects
that read it." The top level is a `WeakMap`, so forgotten objects aren't held in
memory. The middle level is a `Map` keyed by property name. The bottom level is a
`Set` of effects (unique, no duplicates).

The `track` function fills this structure in:

```js
export function track(target, key) {
  if (!activeEffect) return          // no one is listening — bail out

  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))

  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))

  trackEffects(dep)                  // link the active effect to this dep
}

export function trackEffects(dep) {
  if (!activeEffect) return
  dep.add(activeEffect)              // dep knows about the effect
  activeEffect.deps.push(dep)        // the effect knows about the dep
}
```

Notice the two-way link in `trackEffects`. The `dep` remembers the effect — so it
can wake it up later. But the effect also remembers the `dep` (in its `deps` array) —
which we'll need for cleanup, covered below.

The reverse operation is `trigger`:

```js
export function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return               // no one read this object
  const dep = depsMap.get(key)
  if (!dep) return
  triggerEffects(dep)
}

export function triggerEffects(dep) {
  const effects = [...dep]           // a copy! (explained below)
  for (const effect of effects) {
    if (effect === activeEffect) continue   // don't wake ourselves
    if (effect.scheduler) effect.scheduler()
    else effect.run()
  }
}
```

Two subtleties, each of which would otherwise cost hours of debugging:

1. **A copy of the set** (`[...dep]`) before iterating. When an effect re-runs, its
   `cleanup` removes it from `dep` and `track` immediately adds it back. Mutating a
   `Set` you're currently looping over is a sure way to get an infinite loop or a
   skipped element. We iterate over the copy — let the original change freely.

2. **`if (effect === activeEffect) continue`** — protection against self-re-running.
   If you write `count.value++` inside an effect, it reads and writes `count` at the
   same time. Without this line it would wake itself up forever.

## reactive: intercepting an object with Proxy

Now let's make a plain object call `track` and `trigger` automatically. The tool is
`Proxy`. In the `get` trap we call `track`, in the `set` trap we call `trigger`.

```js
// packages/reactivity/reactive.js
export function reactive(target) {
  if (!isObject(target)) return target
  // ... guard against double-wrapping ...

  return new Proxy(target, {
    get(obj, key, receiver) {
      const result = Reflect.get(obj, key, receiver)
      track(obj, key)                      // "I was read"
      if (isObject(result)) return reactive(result)  // depth on demand
      return result
    },
    set(obj, key, value, receiver) {
      const oldValue = obj[key]
      const result = Reflect.set(obj, key, value, receiver)
      if (hasChanged(oldValue, value)) trigger(obj, key)  // "I was changed"
      return result
    },
  })
}
```

Three decisions worth spelling out.

**Deep reactivity on demand.** If a read property turns out to be an object itself,
we wrap it in `reactive` right at that moment — not ahead of time, recursively across
the whole tree (that's expensive and sometimes harmful), but lazily, when something
actually reaches for it. So `state.user.name` is reactive at every level, but you
don't pay the price until `user` is touched.

**The `hasChanged` check.** We call `trigger` only if the value is actually
different. Assigning the same value shouldn't wake the interface.

**`Reflect` instead of `obj[key]`.** On objects with getters and inheritance, direct
access loses the correct `this`. `Reflect.get/set` with `receiver` preserves it. On
plain objects there's no difference, but it's worth getting used to the correct form.

## ref: reactivity for a single value

`Proxy` intercepts an object's properties. But how do you make a plain number
reactive? A number has no properties to intercept. The solution: put the value inside
an object, in a `.value` field, and watch reads and writes of that field through a
getter and a setter.

```js
// packages/reactivity/ref.js
class RefImpl {
  constructor(value) {
    this._value = convert(value)   // an object inside a ref is made reactive too
    this._rawValue = value
    this.dep = new Set()           // its own set of effects (a ref has one "property")
    this.__isRef = true
  }
  get value() {
    if (activeEffect) trackEffects(this.dep)  // read → track
    return this._value
  }
  set value(newValue) {
    if (hasChanged(toRaw(newValue), this._rawValue)) {
      this._rawValue = toRaw(newValue)
      this._value = convert(newValue)
      triggerEffects(this.dep)                // write → trigger
    }
  }
}
```

This is why you always write `.value` on a `ref`: it's not a whim, it's the only
hook through which the getter and setter can step in and call `track`/`trigger`. A
`ref` keeps its own `dep` right inside the object — it doesn't need `targetMap`,
since it has exactly one "property."

There's a handy helper, `proxyRefs` — it unwraps `.value` automatically so that in
templates you can write `count` instead of `count.value`. Later the component layer
applies it to the result of `setup`, and `.value` in markup disappears. Its code is
short; take a look in `ref.js`.

## computed: lazy and cached

A computed value is a formula on top of other reactive data, with two useful
properties: it's evaluated **lazily** (only when the result is asked for) and it's
**cached** (until the dependencies change, a repeat request returns the ready value).

It's assembled from parts we already have: an effect with lazy startup and a
scheduler, plus a "dirty" flag.

```js
// packages/reactivity/computed.js
class ComputedRefImpl {
  constructor(getter) {
    this._dirty = true             // whether a recompute is needed
    this.dep = new Set()
    this.__isRef = true
    this.effect = new ReactiveEffect(getter, () => {
      if (!this._dirty) {          // a dependency changed →
        this._dirty = true         // mark as dirty
        triggerEffects(this.dep)   // and wake whoever read the computed
      }
    })
  }
  get value() {
    if (activeEffect) trackEffects(this.dep)
    if (this._dirty) {             // recompute only if dirty
      this._value = this.effect.run()
      this._dirty = false
    }
    return this._value
  }
}
```

Here the **scheduler** (the second argument to `ReactiveEffect`) comes into play for
the first time. An ordinary effect re-runs immediately when a dependency changes. But
`computed` shouldn't evaluate immediately — it should evaluate lazily. So instead of
recomputing, its scheduler only raises the `_dirty` flag and wakes the readers. The
actual recompute happens in `get value`, and only if someone actually asks for the
result. Read it twice without changes, and the second read comes from the cache — the
`getter` doesn't run.

## Why cleanup is needed: the branching problem

Back to `cleanup`, which `run` calls before every run. Consider an effect with a
condition:

```js
effect(() => {
  out.value = show.value ? a.value : b.value
})
```

When `show` is true, the effect reads `show` and `a`, but **not** `b`. So it
shouldn't subscribe to `b` — otherwise a change to `b`, which currently affects
nothing, would re-run it for no reason. But on the next run `show` might become false,
and then it needs `b`, not `a`.

Conclusion: before every run the effect must forget all its previous dependencies and
collect them again — only the ones actually read this time. That's what `cleanup`
does:

```js
function cleanup(effect) {
  for (const dep of effect.deps) dep.delete(effect)
  effect.deps.length = 0
}
```

It walks every `dep` where the effect is recorded (this is why the effect kept back
references in `deps`), removes itself from them, and clears its own list. After
`cleanup` the effect is "subscribed to nothing" — and then `fn()` subscribes it
again, but this time based on what's actually read. In the tests this is covered by
the "branching — unsubscribe from an unused dependency" case: after switching
branches, a change to the old variable no longer wakes the effect.

## watch: observe and get old/new

`effect` just re-runs a function. `watch` is a layer on top that, on a change, calls a
callback and passes it the new and old values. The source can be a `ref`, a getter
function, or an entire `reactive` object.

The idea: reduce any source to a getter function, wrap it in an effect, and put the
whole "reaction" in the scheduler — it computes the new value and calls the callback.

```js
// packages/reactivity/watch.js  (abridged)
let oldValue
const job = () => {
  const newValue = effect.run()
  callback(newValue, oldValue)
  oldValue = newValue
}
const effect = new ReactiveEffect(getter, job)
oldValue = effect.run()          // first run: collect dependencies, remember the start
```

For a `reactive` object, to watch it "deeply," a `traverse` walk is used — it
recursively reads every nested property, thereby subscribing the effect to each level.
`immediate: true` makes the callback fire right away, without waiting for the first
change.

## How it all works together

Let's put the picture together with an example from the demo. There's `count = ref(0)`,
there's a `computed` `doubled = count.value * 2`, and there's an effect that writes
both numbers into the DOM.

1. The effect runs for the first time. `activeEffect` is it. It reads `count.value`
   (→ `track`: `count.dep` remembered the effect) and `doubled.value`.
2. Reading `doubled.value` while `_dirty = true` runs its inner effect, which reads
   `count.value` (→ `count.dep` also remembered the computed effect). The result is
   cached, `_dirty = false`.
3. The user clicks "+1": `count.value = 1`. The `ref` setter calls `triggerEffects`.
4. `count.dep` now has two "listeners": our DOM effect and the computed effect. The
   computed has a scheduler — it sets `_dirty = true` and wakes the readers of
   `doubled`. The DOM effect has no scheduler — it just re-runs.
5. The DOM effect reads `doubled.value`. It's `_dirty`, so it recomputes (`2`) and
   caches. The numbers on screen are updated.

We didn't write a single line of "find the element, set the text" on the click. We
only described the dependencies, and the system pulled the change through the chain by
itself. That's the whole essence of Vue — and we've just built it.

## Check yourself

Run the tests:

```bash
npm test
```

Thirteen checks in `test/reactivity.test.mjs` confirm every property: `ref` and
`reactive` react, `computed` is lazy and caches, `cleanup` unsubscribes from the
unneeded, `watch` hands back old and new. Then open the demo:

```bash
npm run serve
# http://localhost:5173/playground/01-reactivity.html
```

Click the buttons, watch the console to see the effect fire. Once reactivity has
"clicked" for you, move on to the next layer — the virtual DOM. There we'll learn to
turn data not into `document.title`, but into whole trees of elements, and to update
them surgically.
