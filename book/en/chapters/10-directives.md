# Directives and Dynamic Components

Three features that real apps rarely do without: your own directives
(`v-focus`, `v-tooltip`), swapping a component based on data (`<component :is>`), and
`v-model` on your own components. All three build on the component and compiler
machinery we already have.

Chapter code: changes in `packages/compiler/compile.js`, `runtime-core/renderer.js`,
`runtime-core/vnode.js`, `runtime-core/component.js`. Tests —
`test/directives.test.mjs`, demo — `playground/10-directives.html`.

## Custom directives

A directive is a way to attach low-level behavior to a plain element: set focus,
wire up a third-party library, watch when the element appears on screen. A directive
is an object with hooks tied to the element's lifecycle:

```js
app.directive('focus', {
  mounted(el) { el.focus() }, // element entered the DOM — focus it
})
```

Hooks receive the real element `el` and a `binding` object with usage data:
`value` (the current value of the expression), `oldValue` (the previous one, in `updated`), `arg`
(the argument after the colon), and `modifiers`. So `v-color:bg.important="c"` gives the hook
`binding.value = c`, `binding.arg = 'bg'`, `binding.modifiers = { important: true }`.

### How it works

When the compiler meets an unknown `v-*`, it puts it in a separate list (`parseDirective`)
and wraps the element in a `_wd` (withDirectives) call, passing a tuple of
"directive, value, argument, modifiers" for each directive:

```js
// <div v-focus> compiles to:
_wd(h("div", null, [...]), [[_dir("focus"), void 0, void 0, {}]])
```

`_dir` (`resolveDirective`) finds the directive by name — first in the component's local
`directives` option, then among the global `app.directive` registrations. `withDirectives`
just attaches the parsed bindings to `vnode.dirs`.

The renderer takes over from there. After inserting the element it calls the `mounted` hook,
after an update — `updated` (having first stashed the old value into `oldValue`),
and before removal — `beforeUnmount` and `unmounted`:

```js
function invokeDirectives(vnode, name) {
  for (const binding of vnode.dirs || []) {
    const hook = binding.dir[name]
    if (hook) hook(vnode.el, binding, vnode)
  }
}
```

Directives are just extra calls at the same points in the element's lifecycle
where the renderer was already doing work. The "mounted/updated/unmounted" test
checks all three moments and that `binding` is correct.

## Dynamic components

Sometimes the data decides which component to show: tabs, wizard steps, a list
of heterogeneous blocks. For this there's a special tag `<component :is="...">`, where `:is`
is an expression holding a component (an object) or its name (a string):

```html
<component :is="currentTab" />
```

The compiler recognizes the `component` tag, takes its `:is`, and generates the node type
through the `_cd` helper instead of a string tag:

```js
const _cd = (is) => (typeof is === 'string' ? resolveComponent(is) : is)
// <component :is="cur"> → h(_cd(cur), null, [...])
```

If `is` is a string, `_cd` finds the component by name; if it's an object, it uses it
directly. From there it's the same as any component: change `is` and `patch` sees a different
`type`, unmounts the old component, and mounts the new one.

A practical subtlety shows up in the demo and the test: the component goes into a `shallowRef`,
not a plain `ref`. Otherwise `ref` would try to make the component definition reactive
(wrap it in a Proxy), which is pointless and harmful. The `shallowRef` from layer 9 stores
the value as-is — exactly what these cases need.

## v-model on components

We already covered `v-model` for input fields. On a component it works on the same
"value down, event up" principle, only through the `modelValue` prop and the
`update:modelValue` event:

```html
<MoneyInput v-model="amount" />
<!-- compiles to: -->
<MoneyInput :modelValue="amount" @update:modelValue="amount = $event" />
```

In `applyVModel` the compiler sees that the tag is a component and expands `v-model` into
that pair (not `:value`/`@input`, as for `<input>`). The component itself takes
`modelValue` as a prop and reports changes through `emit`:

```js
const MoneyInput = {
  props: ['modelValue'],
  setup(props, { emit }) {
    return { onIn: (e) => emit('update:modelValue', Number(e.target.value)) }
  },
  template: `<input :value="modelValue" @input="onIn" />`,
}
```

The parent and the component bind two-way while staying honest: data flows
down through the prop, changes bubble up through the event. The "v-model on a
component" test checks the full loop: typing into the child field updates the parent's state.

## What we simplified

Real Vue supports more nuance: the directive hooks `created`/`beforeMount`/
`beforeUpdate`, directives on components, the shorthand form (a function = mounted +
updated), multiple `v-model` with an argument (`v-model:title`), `keep-alive` for
dynamic components (the next chapter). We took the essentials — full-featured hooks
for element directives, `<component :is>` for objects and names, `v-model` on a component
— which is enough for the vast majority of tasks.

## Check yourself

```bash
npm test        # among others — 5 tests for directives and dynamic components
npm run serve   # http://localhost:5173/playground/10-directives.html
```

In the demo: `v-focus` sets focus on the field when it appears, the tabs switch the component
through `<component :is>`, and `MoneyInput` is a custom component with `v-model`. Next up —
Vue's built-in components: `Teleport`, `KeepAlive`, and async components.
