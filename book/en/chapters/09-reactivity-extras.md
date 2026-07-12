# Reactivity, Deeper

The reactivity core from layer 1 covers 90% of what you need, but real code brings up
a few more tools. They're small and built entirely on the `effect`, `track`, and
`trigger` we already have. This chapter is short — we're just picking up some
convenient primitives.

Chapter code: `packages/reactivity/` (additions in `reactive.js`, `ref.js`,
`watch.js`). Tests — `test/reactivity-extras.test.mjs`.

## watchEffect

`watch` requires an explicit source and hands you the old and new value. Often that's
overkill — you just want "run this and re-run it whenever something changes." That's
what `watchEffect` is for:

```js
const stop = watchEffect(() => {
  console.log('count =', count.value) // reads count → subscribes to it
})
```

It runs the function immediately (collecting dependencies from whatever it read along
the way), then re-runs it when those change. The implementation is literally an effect
whose scheduler re-runs it:

```js
export function watchEffect(fn) {
  const effect = new ReactiveEffect(fn, () => effect.run())
  effect.run()
  return () => effect.stop()
}
```

It returns a stop function — call it and the watching stops (`effect.stop` runs
`cleanup` and marks the effect inactive, see layer 1).

## readonly

Sometimes you want to hand out data "view only" — for example, a `provide` value that
descendants shouldn't mutate. `readonly(obj)` returns a Proxy where reads work
(including nested ones — those become `readonly` too), while writes are silently
rejected with a warning:

```js
export function readonly(target) {
  return new Proxy(target, {
    get(obj, key, receiver) {
      if (key === RAW) return obj
      const result = Reflect.get(obj, key, receiver)
      return isObject(result) ? readonly(result) : result // nested is readonly too
    },
    set(obj, key) {
      console.warn(`readonly: cannot modify "${String(key)}"`)
      return true // the write is "swallowed" but not performed
    },
  })
}
```

There's nothing to track here — the value never changes, so `track` in `get` isn't
needed.

## shallowReactive and shallowRef

Deep reactivity is handy, but sometimes excessive. If you only ever change a large
object by replacing it wholesale (rather than mutating its inner fields), there's no
point wrapping every level. The "shallow" versions react only to the top level:

- `shallowReactive(obj)` — `state.count` is reactive, but `state.nested.x` isn't. In
  `get` we simply don't wrap nested objects.
- `shallowRef(v)` — reacts to replacing `.value` wholesale, but not to changing a
  field inside. If you did change a field and want to notify subscribers manually —
  there's `triggerRef(ref)`.

The test "shallowRef reacts to replacement but not to mutation" shows the difference:
`s.value.count = 5` doesn't wake the effect, while `s.value = { count: 10 }` does.

## markRaw

The opposite problem: mark an object so it **never** becomes reactive. You do this
with heavy third-party objects (a map instance, a class from a library) that don't
need reactivity and are even hurt by it performance-wise:

```js
const map = markRaw(new ExpensiveThing())
const state = reactive({ map }) // state.map stays a plain object
```

The implementation is an invisible `Symbol` marker on the object that `reactive`
checks before wrapping anything nested: see the marker, return it as is.

## Wrap-up

All five additions are thin layers over the layer-1 machinery, with no new "engine."
That's a good test of how clean the reactivity turned out: if new tools take just a few
lines each to write, the foundation is right. Next up — directives and dynamic
components, where we'll get real new mechanics again.
