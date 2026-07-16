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
// ARCHITECTURE NOTE: these two imports point "down" into runtime-core — a layer
// inversion compared to real Vue, where the compiler emits code that only NAMES
// helpers (_createVNode, _resolveComponent...) and the RUNTIME binds them when
// it registers the compiler (registerRuntimeCompiler). We keep the inversion on
// purpose: binding the helpers right here (see createRenderFunction below)
// keeps the whole template→function story in one readable file, at the price of
// the compiler not being usable without runtime-core. Vue pays the opposite
// price — an indirection layer — to ship a runtime-only build without the
// compiler and a compiler that runs at build time without the runtime.
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
  // NOTE: the has-trap of the component's ctx proxy (component.js) knows this
  // helper list — with(ctx) must let these names fall through to this scope.
  const _s = (v) => (v == null ? '' : String(v))
  const _l = renderList
  const _c = resolveComponent // resolve components by name
  const _key = checkKey // check the key for @keyup.enter and similar modifiers
  const _cd = (is) => (typeof is === 'string' ? resolveComponent(is) : is) // <component :is>
  const _wd = withDirectives // attach custom directives
  const _dir = resolveDirective // look up a directive by name
  const _m = mergeRenderProps // merge v-bind="obj" objects into props
  const _th = toHandlers // v-on="handlers": { click: fn } → { onClick: fn }

  // The factory function creates `render` with all the helpers in scope.
  // with(ctx) inside lets the template write `count` instead of `ctx.count`.
  let factory
  try {
    // eslint-disable-next-line no-new-func
    factory = new Function(
      'h',
      'Fragment',
      '_s',
      '_l',
      '_c',
      '_key',
      '_cd',
      '_wd',
      '_dir',
      '_m',
      '_th',
      `return function render(ctx){ with(ctx){ return ${code} } }`,
    )
  } catch (e) {
    // A syntax error here means an expression FROM THE TEMPLATE is broken
    // (e.g. @click="count +"). Point at the generated code so the author can
    // see which expression the engine choked on.
    throw new SyntaxError(
      `[minivue compiler] a template expression is not valid JavaScript (${e.message}).\nGenerated code: ${code}`,
    )
  }
  return factory(h, Fragment, _s, _l, _c, _key, _cd, _wd, _dir, _m, _th)
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

// Modifiers that are addEventListener OPTIONS rather than runtime guards.
// They are encoded into the prop NAME (onClickOnce) — see genProps.
const OPTION_MODS = ['capture', 'once', 'passive']

// _key($event, ['enter']) — true if the pressed key matches the modifier.
function checkKey(event, mods) {
  return mods.some((m) => {
    const expected = KEY_MAP[m]
    return Array.isArray(expected) ? expected.includes(event.key) : event.key === expected
  })
}

// _l: render a list for v-for. Supports arrays, numbers (1..n) and objects.
// Note the callback arity: arrays get (item, index), objects get
// (value, key, index) — which is why v-for supports up to three aliases.
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

// _m: merge the props literal with v-bind="obj" objects at render time.
// class/style from several sources are COMBINED (into an array the runtime
// normalizes); for everything else the later source wins, like Object.assign.
function mergeRenderProps(...sources) {
  const out = {}
  for (const src of sources) {
    if (!src) continue
    for (const key in src) {
      if ((key === 'class' || key === 'style') && out[key] != null) {
        out[key] = [out[key], src[key]]
      } else {
        out[key] = src[key]
      }
    }
  }
  return out
}

// _th: v-on="handlers" passes an object of PLAIN event names. Our props
// convention wants onClick, so prefix and capitalize each key.
function toHandlers(obj) {
  const out = {}
  for (const key in obj || {}) {
    out['on' + key[0].toUpperCase() + key.slice(1)] = obj[key]
  }
  return out
}

// Shared error helper — same recognizable shape as the parser's errors.
function compileError(message) {
  throw new SyntaxError(`[minivue compiler] ${message}`)
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
  // The root goes through the SAME per-child logic as any children list —
  // otherwise a v-if or v-for on the root element would be silently ignored
  // (they are handled while walking a list of siblings).
  const pieces = genPieces(ast)
  if (pieces.length === 1 && !pieces[0].isList) {
    // A single root node — return it directly. (A v-if root compiles to a
    // ternary that may yield null; the runtime normalizes null to "nothing".)
    return pieces[0].code
  }
  // Multiple roots — or a root v-for, whose _l(...) yields an ARRAY, not a
  // vnode. Either way render() must return ONE vnode, so wrap in a Fragment
  // (the invisible tag from layer 2).
  return `h(Fragment, null, ${joinPieces(pieces)})`
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
    const { source, args } = parseForExpression(directives.for)
    const inner = genElementWithoutStructural(node, directives)
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
// checkbox → checked/change, radio → checked/change (comparing against the
// input's own value), select → value/change.
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

  // Field type: only a STATIC type="..." can be resolved at compile time.
  // A dynamic :type="t" cannot (real Vue ships a runtime vModelDynamic
  // directive for it) — we fall back to the text codegen below, which at
  // least leaves the element's own value attribute untouched.
  const typeAttr = directives.attrs.find((a) => a.name === 'type')
  const type = typeAttr ? typeAttr.value : null

  // Radio buttons are special: several inputs share one model, and each is
  // checked only while the model equals ITS OWN value. Writing :value here
  // (like the text codegen does) would clobber that identifying value.
  if (node.tag === 'input' && type === 'radio') {
    const valueBind = directives.binds.find((b) => b.arg === 'value')
    const valueAttr = directives.attrs.find((a) => a.name === 'value')
    const ownValue = valueBind
      ? `(${valueBind.exp})`
      : valueAttr
        ? JSON.stringify(valueAttr.value)
        : 'null'
    directives.binds.push({ arg: 'checked', exp: `${exp} === ${ownValue}` })
    directives.ons.push({ event: 'change', exp: `${exp} = ${ownValue}`, modifiers: [] })
    return
  }

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
  // .lazy — sync after the change event (blur/Enter) instead of on every keystroke.
  if (mods.includes('lazy')) event = 'change'

  // The value from the event, honoring the .trim / .number modifiers.
  // Both may be present at once: trim first, then convert (like Vue).
  let valueExpr = `$event.target.${field}`
  if (mods.includes('trim')) valueExpr = `${valueExpr}.trim()`
  if (mods.includes('number')) valueExpr = `Number(${valueExpr})`

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
    else if (bind.arg.startsWith('[') && bind.arg.endsWith(']')) {
      // Dynamic argument :[key]="val" — the prop NAME itself is an expression.
      // JavaScript has the exact tool for this: a computed property name.
      entries.push(`[${bind.arg.slice(1, -1)}]: (${bind.exp})`)
    } else entries.push(`${JSON.stringify(bind.arg)}: (${bind.exp})`)
  }
  // A single part — as-is; several — as an array (normalizeClass unfolds it).
  if (classParts.length === 1) entries.push(`"class": ${classParts[0]}`)
  else if (classParts.length > 1) entries.push(`"class": [${classParts.join(', ')}]`)
  if (styleParts.length === 1) entries.push(`"style": ${styleParts[0]}`)
  else if (styleParts.length > 1) entries.push(`"style": [${styleParts.join(', ')}]`)

  for (const on of directives.ons) {
    // @click="handler" → onClick. Event name with a capitalized first letter.
    let key = 'on' + on.event[0].toUpperCase() + on.event.slice(1)
    // .capture/.once/.passive are not guards inside the handler — they are
    // options of addEventListener itself. We encode them as suffixes on the
    // prop name (onClickOnce); runtime-dom's patchProp peels them back off.
    const mods = on.modifiers || []
    if (mods.includes('capture')) key += 'Capture'
    if (mods.includes('once')) key += 'Once'
    if (mods.includes('passive')) key += 'Passive'
    entries.push(`${JSON.stringify(key)}: ${genHandler(on)}`)
  }

  let code = entries.length ? `{ ${entries.join(', ')} }` : 'null'

  // Object forms: v-bind="obj" spreads a whole object of props, v-on="handlers"
  // a whole object of events. Both are merged at RENDER time — the keys are
  // only known then.
  const spreads = []
  for (const exp of directives.bindObjs) spreads.push(`(${exp})`)
  for (const exp of directives.onObjs) spreads.push(`_th(${exp})`)
  if (spreads.length) code = `_m(${code}, ${spreads.join(', ')})`

  return code
}

// Generate an event handler, honoring modifiers.
//   @click="doThing"          — a method reference, used as-is;
//   @click="count++"          — an inline expression, wrapped in $event => (...);
//   @click.stop.prevent="fn"  — wrapped, with guards added;
//   @keyup.enter="fn"         — invoked only for the matching key.
function genHandler(on) {
  const exp = on.exp
  // Listener options (.once/.capture/.passive) live in the prop name, not in
  // the handler body — ignore them here.
  const mods = (on.modifiers || []).filter((m) => !OPTION_MODS.includes(m))
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

// --- children, honoring v-if / v-else / v-for -------------------------------
// One generated "piece" per child (a v-if chain collapses into one piece).
// isList marks a bare _l(...) call: it evaluates to an ARRAY of vnodes, which
// must be spread (...) into the surrounding children array, not nested in it.
function genPieces(children) {
  const pieces = []
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    const dirs = child.type === NodeTypes.ELEMENT ? classify(child.props) : null

    // An else-branch reaching THIS loop was not consumed by the v-if scan
    // below — meaning there is no v-if before it. Rendering it anyway (the old
    // behavior) shows content that should be hidden, so it must be an error.
    if (dirs && (dirs.elseif != null || dirs.else)) {
      compileError(`v-else / v-else-if on <${child.tag}> has no adjacent v-if`)
    }

    if (dirs && dirs.if != null) {
      // Fold the v-if / v-else-if / v-else chain into a ternary expression.
      // genBranch ignores the directives themselves (classify separates them
      // from attributes), so no extra "stripping" of the node is needed.
      let code = `(${dirs.if}) ? ${genBranch(child, dirs)}`
      let j = i + 1
      let hasElse = false
      while (j < children.length) {
        // Whitespace between branches is formatting, not content — look past
        // it (and consume it if it does separate two branches).
        let k = j
        while (
          k < children.length &&
          children[k].type === NodeTypes.TEXT &&
          children[k].content.trim() === ''
        ) {
          k++
        }
        const sibling = children[k]
        if (!sibling || sibling.type !== NodeTypes.ELEMENT) break
        const nextDirs = classify(sibling.props)
        if (nextDirs.elseif != null) {
          code += ` : (${nextDirs.elseif}) ? ${genBranch(sibling, nextDirs)}`
          j = k + 1
        } else if (nextDirs.else) {
          code += ` : ${genBranch(sibling, nextDirs)}`
          hasElse = true
          j = k + 1
          break
        } else break
      }
      if (!hasElse) code += ' : null' // no v-else — render "nothing"
      pieces.push({ code, isList: false })
      i = j - 1 // skip over the branches we already handled
    } else {
      pieces.push({
        code: genNode(child),
        // A bare v-for (no v-if) generates _l(...) — an array to be spread.
        // (Truthiness matches genElement: an empty v-for="" is ignored there.)
        isList: Boolean(dirs && dirs.for),
      })
    }
  }
  return pieces
}

// One branch of a v-if chain. If the branch ALSO carries v-for, genNode gives
// an _l(...) ARRAY — but a ternary must yield a single vnode, so we wrap the
// array in a Fragment. (This is also why v-if takes priority over v-for when
// both sit on one node: the condition ends up OUTSIDE the loop, and — like in
// Vue 3 — it cannot see the loop variable.)
function genBranch(node, dirs) {
  const code = genNode(node)
  return dirs.for ? `h(Fragment, null, ${code})` : code
}

// Spread the _l(...) pieces into the array, keep everything else as-is.
function joinPieces(pieces) {
  return `[${pieces.map((p) => (p.isList ? `...${p.code}` : p.code)).join(', ')}]`
}

function genChildren(children) {
  if (!children || children.length === 0) return 'null'
  return joinPieces(genPieces(children))
}

// --- classify "raw" attributes into directives -----------------------------
function classify(props = []) {
  const result = {
    attrs: [], // static: class="x"
    binds: [], // :id / v-bind:id
    bindObjs: [], // v-bind="obj" — spread a whole object of props
    ons: [], // @click / v-on:click (with modifiers)
    onObjs: [], // v-on="handlers" — spread a whole object of events
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
    else if (name === 'v-bind') result.bindObjs.push(value) // object form, no arg
    else if (name === 'v-on') result.onObjs.push(value) // object form, no arg
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

// Parse a v-for expression: "item in list", "(item, i) in list" or, for
// objects, "(value, key, i) in obj". Whatever sits before `in` becomes the
// _l callback's parameter list verbatim — so destructuring like
// "{ id } in items" works too.
function parseForExpression(exp) {
  const inMatch = /^([\s\S]*?)\s+(?:in|of)\s+([\s\S]+)$/.exec(exp.trim())
  if (!inMatch) {
    compileError(
      `Invalid v-for expression: ${JSON.stringify(exp)}. Expected "item in list" or "(item, index) in list"`,
    )
  }
  const source = inMatch[2].trim()
  let args = inMatch[1].trim()
  if (args.startsWith('(') && args.endsWith(')')) args = args.slice(1, -1).trim()
  if (!args) {
    compileError(`v-for is missing an item alias: ${JSON.stringify(exp)}`)
  }
  return { source, args }
}
