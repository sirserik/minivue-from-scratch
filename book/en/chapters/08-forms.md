# Forms and Bindings

The core of the framework is done, but the first real form runs into three
annoyances. An input field has to be both read and written by hand. Classes want
to be toggled by condition, not glued together as a string. And an event handler
constantly needs `preventDefault` and a check for which key was pressed. Vue
covers this with three conveniences: `v-model`, object bindings for
`class`/`style`, and event modifiers. All three are layers on top of what already
exists, and they cost little to add.

Chapter code: `packages/shared.js` (class/style normalization), changes in
`packages/compiler/compile.js` (`v-model`, modifiers) and
`packages/runtime-dom/patchProp.js`. Tests — `test/forms.test.mjs`, demo —
`playground/08-forms.html`.

## class and style bindings

In layer 2, `class` could only be a string. An object ("class → is it on?") or an
array is more convenient:

```html
<span :class="{ active: isActive, done: isDone }" />
<span :class="['btn', isPrimary && 'btn-primary']" />
<div :style="{ color: 'red', fontSize: size + 'px' }" />
```

So that both the browser and SSR read every form the same way, we reduce it to a
canonical shape in `shared.js`. `normalizeClass` turns an object/array into a
string, `normalizeStyle` into an object, and `styleToString` into a string with
kebab-case properties:

```js
normalizeClass({ active: true, off: false })  // 'active'
normalizeClass(['a', false, 'b'])              // 'a b'
styleToString({ color: 'red', fontSize: '14px' }) // 'color:red;font-size:14px'
```

These helpers are called in two places: in the browser `patchProp` (when setting
`class`/`style` on a real element) and in the server-side `renderAttrs`. One piece
of logic for both paths. `fontSize` becomes `font-size` automatically, so a style
object can use the familiar JS property names.

## v-model: two-way binding

An input field is a two-way street: state should show up in the field, and the
user's input should update state. By hand that's two things at once:

```html
<input :value="name" @input="name = $event.target.value" />
```

`v-model` is sugar over exactly this pair. The compiler expands
`<input v-model="name">` into a value binding plus a handler. Look at the
implementation in `applyVModel`: it picks the property and the event based on the
field type, because fields differ:

- text `input` and `textarea` → `:value` + `@input`;
- `checkbox` → `:checked` + `@change` (and we read `$event.target.checked`);
- `select` → `:value` + `@change`.

```js
directives.binds.push({ arg: prop, exp })                       // :value="name"
directives.ons.push({ event, exp: `${exp} = $event.target.${field}` }) // @input="name = ..."
```

From there it goes down the normal props-generation path — no special node. Models
support modifiers too: `.number` wraps the value in `Number(...)`, `.trim` in
`.trim()`. The "input updates state" test checks both sides: that state shows up in
the field, and that input changes it.

A subtlety on the runtime side: for `value` and `checked`, `patchProp` writes to
the element property (`el.value`, `el.checked`), not the attribute. The attribute
only sets the initial value; an already-rendered field can be updated only through
the property — without this, `v-model` would get "stuck".

## Event modifiers

Handlers almost always start with boilerplate: "don't reload the page", "don't
bubble up", "only react to Enter". Vue moves these into modifiers after the event
name:

```html
<form @submit.prevent="save" />        <!-- $event.preventDefault() -->
<div @click.stop="onClick" />           <!-- $event.stopPropagation() -->
<input @keyup.enter="submit" />         <!-- only when Enter is pressed -->
```

The compiler parses `@submit.prevent` into an event plus a list of modifiers
(`parseEvent`), and `genHandler` builds a wrapper with the needed guards:

```js
function genHandler(on) {
  if (on.modifiers.length === 0) {
    // no modifiers — same as before: method reference or inline expression
    return isMethodPath ? `(${exp})` : `$event => (${exp})`
  }
  const guards = []
  if (keyMods.length) guards.push(`if(!_key($event,${JSON.stringify(keyMods)}))return;`)
  if (mods.includes('stop')) guards.push('$event.stopPropagation();')
  if (mods.includes('prevent')) guards.push('$event.preventDefault();')
  if (mods.includes('self')) guards.push('if($event.target!==$event.currentTarget)return;')
  return `$event => { ${guards.join('')} ${isMethodPath ? `${exp}($event)` : `(${exp})`} }`
}
```

Key modifiers (`.enter`, `.esc`, `.up`, and others) are checked through the `_key`
helper, which maps a modifier name to an `event.key` value (`enter` → `'Enter'`).
The tests check both the generated code and the behavior: `@click.prevent` really
does call `preventDefault`, and `@keyup.enter` fires only on Enter.

The "no modifiers" path stays as it was — a short reference `(inc)` or
`$event => (count++)`. That way the old code and tests from layer 4 keep working
unchanged, and the wrapper appears only where there actually are modifiers.

## What we simplified

Real Vue supports more: `v-model` on components (with `modelValue` and
`update:modelValue`), multiple models on one component, `.lazy`, `v-model` on
`radio` and multiple `select`, system key modifiers (`.ctrl`, `.shift`), `.once`,
`.capture`, `.passive`. We took the most common cases — text fields, checkbox and
select, object/array `class`/`style`, `.stop`/`.prevent`/`.self`, and keys. That's
enough to build a full-fledged form, and the principle behind the rest is exactly
the same.

## Check yourself

```bash
npm test        # among others — 11 tests for forms and bindings
npm run serve   # http://localhost:5173/playground/08-forms.html
```

The demo has a form with a text field, a `select`, and a checkbox on `v-model`, a
badge whose class is toggled by a `:class` object, and submission via
`@submit.prevent` and `@keyup.enter`. The "live state" under the form always
matches the fields — that's two-way binding in action.
