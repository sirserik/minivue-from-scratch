// ============================================================================
//  compile.js — from AST to render function
// ----------------------------------------------------------------------------
//  The parser (parse.js) gave us a tree of nodes. Now we need to generate the
//  code of the render function — the one that returns h(...). We do it in two
//  passes:
//
//    1) transform — classify the "raw" attributes into directives (v-if, v-for,
//       :bind, @on) and spread them across convenient fields on the node;
//    2) generate — walk the tree and build up a STRING of code like
//       "h('div', {...}, [...])", then turn that string into a real function
//       via new Function.
//
//  The resulting function receives ctx and, through with(ctx), accesses the
//  component state directly: {{ count }} becomes h(...) with the expression
//  count, which `with` pulls out of ctx.
// ============================================================================

import { parse, NodeTypes } from './parse.js'
import { h, Fragment, withDirectives } from '../runtime-core/vnode.js'
import { resolveComponent, resolveDirective } from '../runtime-core/component.js'

/**
 * Compile a template string into a ready-to-use render function.
 * @param {string} template - The component's template markup.
 * @returns {(ctx: object) => import('../runtime-core/vnode.js')} render function that returns a vnode.
 */
export function compile(template) {
  const ast = parse(template)
  const code = generate(ast)
  return createRenderFunction(code)
}

/**
 * Compile a template into the generated render-function source string, without
 * turning it into an actual function. Handy for tests and for showing the
 * generated code in the book.
 * @param {string} template - The component's template markup.
 * @returns {string} The generated render-function body (an h(...) expression).
 */
export function compileToString(template) {
  return generate(parse(template))
}

// --- turning the generated string into a function --------------------------
function createRenderFunction(code) {
  // Helper functions available inside the generated code:
  //   _s — coerce a value to a string (for interpolation),
  //   _l — render a list (v-for),
  //   h, Fragment — from the runtime.
  const _s = (v) => (v == null ? '' : String(v))
  const _l = renderList
  const _c = resolveComponent // resolve components by name
  const _key = checkKey // check the key for @keyup.enter and similar modifiers
  const _cd = (is) => (typeof is === 'string' ? resolveComponent(is) : is) // <component :is>
  const _wd = withDirectives // attach custom directives
  const _dir = resolveDirective // look up a directive by name

  // The factory function creates `render` with all the helpers in scope.
  // with(ctx) inside lets the template write `count` instead of `ctx.count`.
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'h',
    'Fragment',
    '_s',
    '_l',
    '_c',
    '_key',
    '_cd',
    '_wd',
    '_dir',
    `return function render(ctx){ with(ctx){ return ${code} } }`,
  )
  return factory(h, Fragment, _s, _l, _c, _key, _cd, _wd, _dir)
}

// Mapping from a key modifier to the corresponding event.key value.
const KEY_MAP = {
  enter: 'Enter',
  tab: 'Tab',
  esc: 'Escape',
  escape: 'Escape',
  space: ' ',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  delete: ['Delete', 'Backspace'],
}
const KEY_MODS = Object.keys(KEY_MAP)

// _key($event, ['enter']) — true if the pressed key matches the modifier.
function checkKey(event, mods) {
  return mods.some((m) => {
    const expected = KEY_MAP[m]
    return Array.isArray(expected) ? expected.includes(event.key) : event.key === expected
  })
}

// _l: render a list for v-for. Supports arrays, numbers (1..n) and objects.
function renderList(source, fn) {
  const result = []
  if (Array.isArray(source) || typeof source === 'string') {
    for (let i = 0; i < source.length; i++) result.push(fn(source[i], i))
  } else if (typeof source === 'number') {
    for (let i = 0; i < source; i++) result.push(fn(i + 1, i))
  } else if (source && typeof source === 'object') {
    const keys = Object.keys(source)
    keys.forEach((key, i) => result.push(fn(source[key], key, i)))
  }
  return result
}

// ===========================================================================
//  CODE GENERATION
// ===========================================================================
/**
 * Generate the render-function body from an AST.
 * @param {Array} ast - Array of top-level AST nodes returned by parse().
 * @returns {string} A source-code expression: an h(...) call (or Fragment).
 */
function generate(ast) {
  const children = ast // parseChildren returned an array of top-level nodes
  if (children.length === 1) {
    // A single root node — return it directly.
    return genNode(children[0])
  }
  // Multiple roots — wrap them in a Fragment (the invisible tag from layer 2).
  return `h(Fragment, null, ${genChildren(children)})`
}

function genNode(node) {
  switch (node.type) {
    case NodeTypes.ELEMENT:
      return genElement(node)
    case NodeTypes.TEXT:
      // Text — a string literal. JSON.stringify escapes quotes/newlines.
      return JSON.stringify(node.content)
    case NodeTypes.INTERPOLATION:
      // {{ expr }} → _s(expr): the expression's value coerced to a string.
      return `_s(${node.content})`
    default:
      return 'null'
  }
}

function genElement(node) {
  const directives = classify(node.props)

  // v-for wraps the node in _l(list, (item, index) => <the same node>).
  // We strip the v-for itself so we don't loop forever, then generate the body.
  if (directives.for) {
    const { source, valueAlias, indexAlias } = parseForExpression(directives.for)
    const inner = genElementWithoutStructural(node, directives)
    const args = indexAlias ? `${valueAlias}, ${indexAlias}` : valueAlias
    return `_l(${source}, (${args}) => ${inner})`
  }

  // v-if is generated at the children-list level (it needs access to the
  // sibling v-else branches), so here we handle the node without structural
  // directives.
  return genElementWithoutStructural(node, directives)
}

// Generate h('tag', props, children) ignoring v-for/v-if.
function genElementWithoutStructural(node, directives) {
  // v-model expands into a :value + @input pair (or modelValue on a component).
  if (directives.model) applyVModel(node, directives)

  const tag = genTag(node, directives)
  const props = genProps(directives)
  const children = genChildren(node.children)
  let code = `h(${tag}, ${props}, ${children})`

  // Custom directives (v-focus, v-color): wrap in _wd(vnode, [[...]]).
  if (directives.dirs.length) {
    const bindings = directives.dirs.map(genDirectiveBinding).join(', ')
    code = `_wd(${code}, [${bindings}])`
  }
  return code
}

// Choose the node's "type": dynamic component, component by name, or HTML tag.
function genTag(node, directives) {
  if (node.tag === 'component') {
    // <component :is="x"> — the type is computed from :is. Remove is from props.
    const isBind = directives.binds.find((b) => b.arg === 'is')
    const isAttr = directives.attrs.find((a) => a.name === 'is')
    directives.binds = directives.binds.filter((b) => b.arg !== 'is')
    directives.attrs = directives.attrs.filter((a) => a.name !== 'is')
    const expr = isBind ? isBind.exp : isAttr ? JSON.stringify(isAttr.value) : 'null'
    return `_cd(${expr})`
  }
  // A capitalized or hyphenated tag (RouterView) — a component by name.
  return isComponentTag(node.tag) ? `_c(${JSON.stringify(node.tag)})` : JSON.stringify(node.tag)
}

// One directive → [_dir('name'), value, argument, { modifiers }].
function genDirectiveBinding(dir) {
  const value = dir.exp ? `(${dir.exp})` : 'void 0'
  const arg = dir.arg ? JSON.stringify(dir.arg) : 'void 0'
  const mods = dir.modifiers.length
    ? `{ ${dir.modifiers.map((m) => `${JSON.stringify(m)}: true`).join(', ')} }`
    : '{}'
  return `[_dir(${JSON.stringify(dir.name)}), ${value}, ${arg}, ${mods}]`
}

// v-model — "syntactic sugar" over a value binding plus an input handler.
// <input v-model="name">  ≡  <input :value="name" @input="name = $event.target.value">
// We pick the property and event by field type: text → value/input,
// checkbox → checked/change, select → value/change.
function applyVModel(node, directives) {
  const exp = directives.model.exp
  const mods = directives.model.modifiers || []

  // v-model on a COMPONENT: :modelValue + @update:modelValue (emit passes the
  // value as the first argument, which becomes $event).
  if (isComponentTag(node.tag)) {
    directives.binds.push({ arg: 'modelValue', exp })
    directives.ons.push({ event: 'update:modelValue', exp: `${exp} = $event`, modifiers: [] })
    return
  }

  // Field type: from a static type="..." or from :type.
  const typeAttr = directives.attrs.find((a) => a.name === 'type')
  const type = typeAttr ? typeAttr.value : null

  let prop = 'value'
  let event = 'input'
  let field = 'value'
  if (node.tag === 'input' && type === 'checkbox') {
    prop = 'checked'
    event = 'change'
    field = 'checked'
  } else if (node.tag === 'select') {
    event = 'change'
  }

  // The value from the event, honoring the .number / .trim modifiers.
  let valueExpr = `$event.target.${field}`
  if (mods.includes('number')) valueExpr = `Number(${valueExpr})`
  else if (mods.includes('trim')) valueExpr = `${valueExpr}.trim()`

  directives.binds.push({ arg: prop, exp })
  directives.ons.push({ event, exp: `${exp} = ${valueExpr}`, modifiers: [] })
}

function isComponentTag(tag) {
  return /^[A-Z]/.test(tag) || tag.includes('-')
}

// --- attributes and handlers → props object --------------------------------
function genProps(directives) {
  const entries = []
  // class and style are collected separately: a single element can have both a
  // static class="x" and a :class="{...}". They must be MERGED (into an array),
  // not overwrite one another — the runtime's normalizeClass/normalizeStyle
  // handles normalization.
  const classParts = []
  const styleParts = []

  for (const attr of directives.attrs) {
    if (attr.name === 'class') classParts.push(JSON.stringify(attr.value))
    else if (attr.name === 'style') styleParts.push(JSON.stringify(attr.value))
    else entries.push(`${JSON.stringify(attr.name)}: ${JSON.stringify(attr.value)}`)
  }
  for (const bind of directives.binds) {
    // :id="expr" — the value is computed. We emit exp as-is; with(ctx) resolves it.
    if (bind.arg === 'class') classParts.push(`(${bind.exp})`)
    else if (bind.arg === 'style') styleParts.push(`(${bind.exp})`)
    else entries.push(`${JSON.stringify(bind.arg)}: (${bind.exp})`)
  }
  // A single part — as-is; several — as an array (normalizeClass unfolds it).
  if (classParts.length === 1) entries.push(`"class": ${classParts[0]}`)
  else if (classParts.length > 1) entries.push(`"class": [${classParts.join(', ')}]`)
  if (styleParts.length === 1) entries.push(`"style": ${styleParts[0]}`)
  else if (styleParts.length > 1) entries.push(`"style": [${styleParts.join(', ')}]`)

  for (const on of directives.ons) {
    // @click="handler" → onClick. Event name with a capitalized first letter.
    const key = 'on' + on.event[0].toUpperCase() + on.event.slice(1)
    entries.push(`${JSON.stringify(key)}: ${genHandler(on)}`)
  }

  return entries.length ? `{ ${entries.join(', ')} }` : 'null'
}

// Generate an event handler, honoring modifiers.
//   @click="doThing"          — a method reference, used as-is;
//   @click="count++"          — an inline expression, wrapped in $event => (...);
//   @click.stop.prevent="fn"  — wrapped, with guards added;
//   @keyup.enter="fn"         — invoked only for the matching key.
function genHandler(on) {
  const exp = on.exp
  const mods = on.modifiers || []
  const isMethodPath = /^[A-Za-z_$][\w$.]*$/.test(exp.trim())

  // No modifiers — same as before (short code, backwards compatible).
  if (mods.length === 0) {
    return isMethodPath ? `(${exp})` : `$event => (${exp})`
  }

  // With modifiers — wrap in an arrow function with the checks.
  const guards = []
  const keyMods = mods.filter((m) => KEY_MODS.includes(m))
  if (keyMods.length) guards.push(`if(!_key($event,${JSON.stringify(keyMods)}))return;`)
  if (mods.includes('stop')) guards.push('$event.stopPropagation();')
  if (mods.includes('prevent')) guards.push('$event.preventDefault();')
  if (mods.includes('self')) guards.push('if($event.target!==$event.currentTarget)return;')

  const call = isMethodPath ? `${exp}($event)` : `(${exp})`
  return `$event => { ${guards.join('')} ${call} }`
}

// --- children, honoring v-if / v-else --------------------------------------
function genChildren(children) {
  if (!children || children.length === 0) return 'null'

  const pieces = []
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    const dirs = child.type === NodeTypes.ELEMENT ? classify(child.props) : null

    if (dirs && dirs.if != null) {
      // Fold the v-if / v-else-if / v-else chain into a ternary expression.
      // genNode ignores the directives themselves (classify separates them from
      // attributes), so no extra "stripping" of the node is needed.
      let code = `(${dirs.if}) ? ${genNode(child)}`
      let j = i + 1
      let hasElse = false
      while (j < children.length && children[j].type === NodeTypes.ELEMENT) {
        const nextDirs = classify(children[j].props)
        if (nextDirs.elseif != null) {
          code += ` : (${nextDirs.elseif}) ? ${genNode(children[j])}`
          j++
        } else if (nextDirs.else) {
          code += ` : ${genNode(children[j])}`
          hasElse = true
          j++
          break
        } else break
      }
      if (!hasElse) code += ' : null' // no v-else — render "nothing"
      pieces.push(code)
      i = j - 1 // skip over the branches we already handled
    } else {
      pieces.push(genNode(child))
    }
  }

  // v-for returns an array — it must be "poured" into the overall list via spread.
  const joined = pieces
    .map((p) => (p.startsWith('_l(') ? `...${p}` : p))
    .join(', ')
  return `[${joined}]`
}

// --- classify "raw" attributes into directives -----------------------------
function classify(props = []) {
  const result = {
    attrs: [], // static: class="x"
    binds: [], // :id / v-bind:id
    ons: [], // @click / v-on:click (with modifiers)
    model: null, // v-model
    dirs: [], // custom directives v-focus, v-color:arg.mod
    if: null,
    elseif: null,
    else: false,
    for: null,
  }
  for (const { name, value } of props) {
    if (name === 'v-if') result.if = value
    else if (name === 'v-else-if') result.elseif = value
    else if (name === 'v-else') result.else = true
    else if (name === 'v-for') result.for = value
    else if (name === 'v-model' || name.startsWith('v-model.'))
      result.model = { exp: value, modifiers: name.split('.').slice(1) }
    else if (name.startsWith(':')) result.binds.push({ arg: name.slice(1), exp: value })
    else if (name.startsWith('v-bind:'))
      result.binds.push({ arg: name.slice(7), exp: value })
    else if (name.startsWith('@')) result.ons.push(parseEvent(name.slice(1), value))
    else if (name.startsWith('v-on:')) result.ons.push(parseEvent(name.slice(5), value))
    else if (name.startsWith('v-')) result.dirs.push(parseDirective(name, value))
    else result.attrs.push({ name, value })
  }
  return result
}

// 'v-color:bg.important' → { name: 'color', arg: 'bg', modifiers: ['important'], exp }
function parseDirective(name, value) {
  const [head, ...modifiers] = name.slice(2).split('.') // strip the 'v-'
  const [dirName, arg] = head.split(':')
  return { name: dirName, arg, modifiers, exp: value }
}

// '@click.stop.prevent' → { event: 'click', exp, modifiers: ['stop','prevent'] }
function parseEvent(raw, value) {
  const [event, ...modifiers] = raw.split('.')
  return { event, exp: value, modifiers }
}

// Parse a v-for expression: "item in list" or "(item, index) in list".
function parseForExpression(exp) {
  const inMatch = /^(.*?)\s+(?:in|of)\s+(.*)$/.exec(exp.trim())
  const source = inMatch[2].trim()
  let lhs = inMatch[1].trim()
  let valueAlias = lhs
  let indexAlias = null
  const parenMatch = /^\(\s*([^,]+)\s*,\s*([^,)]+)\s*\)$/.exec(lhs)
  if (parenMatch) {
    valueAlias = parenMatch[1].trim()
    indexAlias = parenMatch[2].trim()
  }
  return { source, valueAlias, indexAlias }
}
