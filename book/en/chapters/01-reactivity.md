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
    this.onStop = null       // optional hook run once when the effect is stopped
    recordEffectScope(this)  // register in the current scope (see below)
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

The two extra lines in the constructor belong to `EffectScope` — a "basket" in the
same file that collects every effect created while it's active (`recordEffectScope`),
so a whole group can be stopped with one `scope.stop()`. The component layer will use
it later: a component gathers its render effect and watchers into a scope and
disconnects them all at once on unmount.

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
  if (!activeEffect || !shouldTrack) return  // no one listening (or tracking paused)

  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))

  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))

  trackEffects(dep)                  // link the active effect to this dep
}

export function trackEffects(dep) {
  if (!activeEffect || !shouldTrack) return
  if (dep.has(activeEffect)) return  // already linked during this run
  dep.add(activeEffect)              // dep knows about the effect
  activeEffect.deps.push(dep)        // the effect knows about the dep
}
```

Notice the two-way link in `trackEffects`. The `dep` remembers the effect — so it
can wake it up later. But the effect also remembers the `dep` (in its `deps` array) —
which we'll need for cleanup, covered below. The `shouldTrack` flag is a global pause
switch (`pauseTracking`/`resetTracking` in the same file): array mutators like
`push()` read the array as a side effect of writing, and without the pause an effect
that pushes would subscribe to its own reads.

The reverse operation is `trigger`:

```js
export function trigger(target, key, type = 'set', newValue) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return               // no one read this object

  // Collect every dep set the change affects, then fire them all at once.
  const deps = []

  if (type === 'clear') {
    deps.push(...depsMap.values())   // collection.clear(): every key is gone
  } else if (key === 'length' && Array.isArray(target)) {
    // … arr.length shrank: wake 'length' readers and removed indices …
  } else {
    deps.push(depsMap.get(key))
    // … 'add'/'delete' (and map.set) also wake iteration effects:
    //   depsMap.get(ITERATE_KEY) or the array's 'length' …
  }

  // Merge into one set so an effect subscribed to several deps runs once.
  const effects = new Set()
  for (const dep of deps) {
    if (dep) dep.forEach((effect) => effects.add(effect))
  }
  triggerEffects(effects)
}

export function triggerEffects(dep) {
  const effects = [...dep]           // a copy! (explained below)

  // Pass 1: computed effects go FIRST — their caches must be invalidated
  // before plain effects read them.
  for (const effect of effects) {
    if (effect.computed) triggerEffect(effect)
  }
  // Pass 2: plain effects.
  // … the full file also skips effects that pass 1 already re-ran …
  for (const effect of effects) {
    if (!effect.computed) triggerEffect(effect)
  }
}

function triggerEffect(effect) {
  if (effect === activeEffect) return     // don't wake ourselves
  if (effect.scheduler) effect.scheduler()
  else effect.run()
}
```

Two subtleties, each of which would otherwise cost hours of debugging:

1. **A copy of the set** (`[...dep]`) before iterating. When an effect re-runs, its
   `cleanup` removes it from `dep` and `track` immediately adds it back. Mutating a
   `Set` you're currently looping over is a sure way to get an infinite loop or a
   skipped element. We iterate over the copy — let the original change freely.

2. **`if (effect === activeEffect) return`** in `triggerEffect` — protection against
   self-re-running. If you write `count.value++` inside an effect, it reads and
   writes `count` at the same time. Without this line it would wake itself up
   forever.

Two more decisions live in this code. The `type` argument distinguishes changing a
value from adding or removing a key — the latter also wakes iteration effects
(`for…in`, array `length`, Map/Set `size`), which subscribe under the special
`ITERATE_KEY`, since an iteration has no single property to depend on. And
`triggerEffects` makes two passes: computed effects run first, so a plain effect
that reads both a value and a computed built on it never sees a stale cache (the
classic "glitch").

## reactive: intercepting an object with Proxy

Now let's make a plain object call `track` and `trigger` automatically. The tool is
`Proxy`. In the `get` trap we call `track`, in the `set` trap we call `trigger`. The
real file builds these traps with a factory — the same `createGetter`/`createSetter`
serve `reactive`, `shallowReactive` and `readonly` (chapter 9), differing only in two
flags:

```js
// packages/reactivity/reactive.js  (the get and set traps, abridged)
function createGetter(isReadonly = false, isShallow = false) {
  return function get(obj, key, receiver) {
    // … internal markers, instrumented array methods, engine symbols …

    const result = Reflect.get(obj, key, receiver)

    if (!isReadonly) track(obj, key)   // "I was read"

    if (isShallow) return result

    // A ref inside a reactive object unwraps automatically: state.count,
    // not state.count.value (arrays are the exception).
    if (isRef(result)) {
      return Array.isArray(obj) && isIntegerKey(key) ? result : result.value
    }

    if (isObject(result)) {
      return isReadonly ? readonly(result) : reactive(result) // depth on demand
    }

    return result
  }
}

function createSetter(isShallow = false) {
  return function set(obj, key, value, receiver) {
    let oldValue = obj[key]
    // … a ref at this key absorbs the write into its .value;
    //   oldValue and value are compared "raw", via toRaw …

    const hadKey =
      Array.isArray(obj) && isIntegerKey(key)
        ? Number(key) < obj.length
        : Object.prototype.hasOwnProperty.call(obj, key)

    const result = Reflect.set(obj, key, value, receiver)
    // … prototype-chain guard: only the object actually written to triggers …

    if (!hadKey) {
      trigger(obj, key, 'add')         // a new key appeared
    } else if (hasChanged(oldValue, value)) {
      trigger(obj, key, 'set', value)  // an existing key got a new value
    }

    return result
  }
}

export function reactive(target) {
  return createReactiveObject(target, mutableHandlers, reactiveMap)
}
```

Four decisions worth spelling out.

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

**Refs unwrap automatically.** A ref stored inside a reactive object is read as
`state.count`, not `state.count.value` — the getter returns its `.value`, and the
setter writes an assigned non-ref into it. Arrays are the exception: `arr[0]` may
legitimately hold a ref (Vue semantics).

`createReactiveObject` at the bottom of the file holds the plumbing: it caches the
proxy per target (so `reactive(obj)` twice returns the same proxy), returns
primitives, `markRaw`'d objects and non-proxyable ones (Date, RegExp, class instances
with internal slots) unchanged, and picks a different handler set for Map/Set — their
methods work on hidden internal slots a Proxy doesn't have, so the file replaces them
with "instrumented" versions that call `track`/`trigger` by hand. Arrays get the same
treatment for a handful of methods: `includes`/`indexOf`/`lastIndexOf` also search
the raw array (elements come out wrapped, so an identity search would miss), and
`push`/`pop`/`shift`/`unshift`/`splice` pause tracking while they run, so a writer
doesn't subscribe to its own incidental reads. Iteration — `for…in`, `Object.keys`, a
collection's `size` and `forEach` — is tracked under `ITERATE_KEY`, the key we saw in
`trigger`.

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
  constructor(getter, setter) {
    this._value = undefined
    this._setter = setter
    this._dirty = true             // whether a recompute is needed
    this.dep = new Set()
    this.__isRef = true
    this.effect = new ReactiveEffect(getter, () => {
      if (!this._dirty) {          // a dependency changed →
        this._dirty = true         // mark as dirty
        triggerEffects(this.dep)   // and wake whoever read the computed
      }
    })
    this.effect.computed = true    // "invalidate me before plain effects"
  }
  get value() {
    if (activeEffect) trackEffects(this.dep)
    if (this._dirty) {             // recompute only if dirty
      this._value = this.effect.run()
      this._dirty = false
    }
    return this._value
  }
  // … set value(v) hands the write to the setter — a writable computed …
}
```

Here the **scheduler** (the second argument to `ReactiveEffect`) comes into play for
the first time. An ordinary effect re-runs immediately when a dependency changes. But
`computed` shouldn't evaluate immediately — it should evaluate lazily. So instead of
recomputing, its scheduler only raises the `_dirty` flag and wakes the readers. The
actual recompute happens in `get value`, and only if someone actually asks for the
result. Read it twice without changes, and the second read comes from the cache — the
`getter` doesn't run.

The `this.effect.computed = true` mark is the flag `triggerEffects` uses to
invalidate computeds before plain effects run. The setter makes a writable computed
possible: `computed({ get, set })` forwards assignments to your `set`, while a
getter-only computed just warns.

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
function, an entire `reactive` object, or an array of such sources.

The idea: reduce any source to a getter function, wrap it in an effect, and put the
whole "reaction" in the scheduler — it computes the new value and calls the callback.

```js
// packages/reactivity/watch.js  (abridged)
let oldValue
const job = () => {
  const newValue = effect.run()
  // … skip if nothing actually changed …
  callback(newValue, oldValue, onCleanup)
  oldValue = newValue
}
// 'sync' fires right inside the mutation; the default ('pre') batches the job
// into a microtask queue — three synchronous writes mean one callback call.
const scheduler = flush === 'sync' ? job : () => queueWatchJob(job)
const effect = new ReactiveEffect(getter, scheduler)
oldValue = effect.run()          // first run: collect dependencies, remember the start
```

For a `reactive` object, to watch it "deeply," a `traverse` walk is used — it
recursively reads every nested property, thereby subscribing the effect to each level
(`deep: true` does the same for any source, and an array of sources is reduced to a
getter over all of them). `immediate: true` makes the callback fire right away,
`once: true` stops the watcher after the first call. The callback's third argument,
`onCleanup`, registers a function that runs before the next invocation and on stop —
the standard way to cancel a request that a newer value has made stale.

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

Fourteen checks in `test/reactivity.test.mjs` confirm every property: `ref` and
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
