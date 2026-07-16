// ============================================================================
//  component.js — the component system
// ----------------------------------------------------------------------------
//  A component is a reusable "state + markup" unit. In layer 2 we wired a ref to
//  a render function by hand via an effect. A component packages exactly that
//  pairing into an object you can reuse many times:
//
//    const Counter = {
//      props: ['start'],
//      setup(props) {
//        const count = ref(props.start)
//        return { count, inc: () => count.value++ }
//      },
//      render(ctx) {
//        return h('button', { onClick: ctx.inc }, 'Clicks: ' + ctx.count)
//      },
//    }
//
//  Below is how it comes to life: how props are read, how setup() works, and how
//  a reactive effect re-renders the component when things change.
// ============================================================================

import { reactive, proxyRefs, ReactiveEffect, effectScope } from '../reactivity/index.js'
import { normalizeVNode, isVNode } from './vnode.js'
import { queueJob, invalidateJob } from './scheduler.js'
// Circular import (apiLifecycle.js imports getCurrentInstance back from us) —
// harmless: both sides only export hoisted functions and call each other at
// runtime, never during module evaluation. See the note in apiLifecycle.js.
import { invokeHooks } from './apiLifecycle.js'
import { BUILTIN_COMPONENTS } from './builtins.js'
import { callWithErrorHandling, handleError } from './errorHandling.js'
import { normalizeClass } from '../shared.js'

/**
 * defineComponent — an identity function. In real Vue it exists purely for
 * tooling: TypeScript infers component-typed props/ctx from the options passed
 * through it. At runtime it returns its argument unchanged. We ship it so code
 * written for Vue ports over without edits.
 * @param {object} options Component options object.
 * @returns {object} The same options object.
 */
export function defineComponent(options) {
  return options
}

// ---- Current component -----------------------------------------------------
//  While a component's setup() runs, a reference to its instance lives here. That
//  way onMounted / inject / provide, called inside setup, know which component
//  they belong to without receiving it as an argument.
let currentInstance = null
export function getCurrentInstance() {
  return currentInstance
}
function setCurrentInstance(instance) {
  currentInstance = instance
}

// ---- Currently rendering component -----------------------------------------
//  While a component's update code runs (render + patch of its subtree), its
//  instance lives here. Child components mounted at that moment take it as their
//  parent — this is how the component tree is built without threading the parent
//  through every patch call.
let currentRenderingInstance = null

// ---- Pluggable template compiler -------------------------------------------
//  Layer 4 registers a compile(template) → render function here. Until it exists,
//  a component must supply its own render function or a setup that returns one.
let compile = null
export function registerRuntimeCompiler(fn) {
  compile = fn
}

let uid = 0

// resolveComponent — look up a component by name among the registered ones
// (app.component('RouterView', ...)). Needed by the compiler: a <RouterView> tag
// in a template becomes _c('RouterView'). We search in the context of the
// currently rendering component; if not found, we return the name as a string
// (a plain tag).
export function resolveComponent(name) {
  // Built-ins (Teleport, KeepAlive) are always available, no registration needed.
  if (BUILTIN_COMPONENTS[name]) return BUILTIN_COMPONENTS[name]
  const instance = currentRenderingInstance
  if (instance) {
    // Local first (the component's components option), then global.
    const local = instance.type.components
    if (local && local[name]) return local[name]
    const global = instance.appContext.components
    if (global[name]) return global[name]
  }
  return name
}

// resolveDirective — look up a directive by name (app.directive('focus', ...) or
// a component's local directives option). Needed by the compiler: v-focus → _dir('focus').
export function resolveDirective(name) {
  const instance = currentRenderingInstance
  if (instance) {
    const local = instance.type.directives
    if (local && local[name]) return local[name]
    const global = instance.appContext.directives
    if (global && global[name]) return global[name]
  }
  return null
}

// ---------------------------------------------------------------------------
//  createComponentSystem — the factory the renderer calls via
//  __installComponents. It receives the renderer's internals (patch, unmount)
//  and returns the functions the renderer plugs into its own patch: how to
//  process and how to unmount a component.
// ---------------------------------------------------------------------------
export function createComponentSystem(internals) {
  const { patch, unmount, hydrateNode, move, options } = internals

  // A lazy off-DOM "storage" where deactivated KeepAlive components hide:
  // their DOM lives there, untouched, until they're shown again.
  let _storage = null
  function keepAliveStorage() {
    return _storage || (_storage = options.createElement('div'))
  }

  function processComponent(n1, n2, container, anchor) {
    if (n1 == null) {
      if (n2.__keptAlive) {
        // KeepAlive activation: the instance is alive with its DOM stashed in
        // the storage — bring it back instead of mounting from scratch.
        activateComponent(n2, container, anchor)
      } else {
        mountComponent(n2, container, anchor)
      }
    } else {
      updateComponent(n1, n2)
    }
  }

  // KeepAlive activation: move the stashed DOM back into place, then run a
  // NORMAL update against the new vnode — its props and slots may have changed
  // while the component slept (and emit must see the new parent handlers).
  function activateComponent(vnode, container, anchor) {
    const instance = vnode.component // set by KeepAlive's render from its cache
    move(instance.subTree, container, anchor)
    updateComponent(instance.vnode, vnode)
    vnode.el = instance.subTree.el
    instance.isDeactivated = false
    invokeHooks(instance.a, instance, 'activated hook') // onActivated
  }

  function mountComponent(vnode, container, anchor) {
    // 1. Create the instance. The parent is whatever is rendering right now.
    const instance = (vnode.component = createComponentInstance(
      vnode,
      currentRenderingInstance,
    ))

    // 2. Prepare props, slots and run setup().
    setupComponent(instance)

    // 3. Set up the reactive effect that renders and re-renders the component.
    setupRenderEffect(instance, container, anchor)
  }

  // Component hydration (layer 7): mount "on top of" an existing DOM node.
  function hydrateComponent(vnode, domNode, container) {
    const instance = (vnode.component = createComponentInstance(
      vnode,
      currentRenderingInstance,
    ))
    setupComponent(instance)
    // The container for future patches is the existing node's parent; the fourth
    // argument passes the node itself as the "hydration point" for the first
    // render. No node to adopt (server/client mismatch) → normal client mount.
    setupRenderEffect(instance, container || (domNode && domNode.parentNode), null, domNode)
  }

  function updateComponent(n1, n2) {
    // The parent re-rendered and handed the component a new vnode (possibly with
    // new props). Reuse the existing instance.
    const instance = (n2.component = n1.component)
    // Carry the current DOM node over synchronously. The real re-render is queued
    // (below), but a keyed-list diff may need n2.el *right now* to move the node —
    // without this, moving a keyed component throws "insertBefore ... not a Node".
    n2.el = n1.el
    instance.next = n2 // the "next" vnode is processed before re-rendering
    // Queue the update (deduplicated: even if props also reactively trigger the
    // effect, the component re-renders only once).
    queueJob(instance.update)
  }

  function setupRenderEffect(instance, container, anchor, hydrationNode = null) {
    // The function for a single component render "pass". On the first run it
    // mounts (or hydrates, if hydrationNode is given), on later runs it updates.
    const componentUpdateFn = () => {
      // A stale job may still fire after unmount (it was queued in the same
      // tick the parent removed us). The queue entry is also invalidated on
      // unmount, but this guard is the last line of defense: a dead component
      // must never touch the DOM again.
      if (instance.isUnmounted) return
      // For the duration of rendering and patching the subtree, declare ourselves
      // current — so child components take us as their parent.
      const prevRendering = currentRenderingInstance
      currentRenderingInstance = instance
      try {
        if (!instance.isMounted) {
          invokeHooks(instance.bm, instance, 'beforeMount hook') // onBeforeMount
          const subTree = (instance.subTree = renderComponentRoot(instance))
          if (hydrationNode) {
            // Hydration: "adopt" existing DOM instead of creating new nodes.
            hydrateNode(hydrationNode, subTree)
          } else {
            patch(null, subTree, container, anchor)
          }
          // The component's root node. For a fragment root, subTree.el is the
          // fragment's start anchor — exactly what siblings need as an
          // insertion reference point.
          instance.vnode.el = subTree.el
          instance.isMounted = true
          // onMounted hooks don't run here — see the update runner below.
          pendingPostHooks = instance.m
        } else {
          // If a new vnode came from the parent, update props/slots first.
          if (instance.next) {
            updateComponentPreRender(instance, instance.next)
            instance.next = null
          }
          invokeHooks(instance.bu, instance, 'beforeUpdate hook') // onBeforeUpdate
          const nextTree = renderComponentRoot(instance)
          const prevTree = instance.subTree
          instance.subTree = nextTree
          patch(prevTree, nextTree, container, anchor)
          instance.vnode.el = nextTree.el
          pendingPostHooks = instance.u // onUpdated — see the update runner below
        }
      } finally {
        currentRenderingInstance = prevRendering
      }
    }

    // Wrap it in a reactive effect. The scheduler is a queue: when reactive data
    // read during render changes, the component is queued for an update rather
    // than re-rendered immediately. Created inside the instance's scope, so
    // unmount stops it together with the component's watchers.
    const effect = instance.scope.run(
      () => new ReactiveEffect(componentUpdateFn, () => queueJob(instance.update)),
    )

    // instance.update is the effect's "runner". Note that onMounted/onUpdated
    // hooks fire AFTER effect.run() returns, not inside it: while the effect is
    // running, reactivity's self-trigger guard silently ignores any change it
    // makes to its own dependencies. A hook mutating state (a one-shot
    // correction in onUpdated, say) must schedule a follow-up render — so the
    // hooks run once we're outside the effect. Still synchronous, and children's
    // hooks still fire before the parent's (they ran inside our patch).
    const update = (instance.update = () => {
      effect.run()
      const hooks = pendingPostHooks
      pendingPostHooks = null
      if (hooks) {
        invokeHooks(hooks, instance, hooks === instance.m ? 'mounted hook' : 'updated hook')
      }
    })
    let pendingPostHooks = null
    // The id lets the scheduler sort (parent before child); .i tells the
    // scheduler whose job this is, so a throwing update is routed to the right
    // onErrorCaptured chain.
    update.id = instance.uid
    update.i = instance
    update() // first run = mount
  }

  // Update props and slots before re-rendering (data came from the parent).
  function updateComponentPreRender(instance, nextVNode) {
    instance.vnode = nextVNode
    nextVNode.el = instance.subTree ? instance.subTree.el : null
    updateProps(instance, nextVNode)
    updateSlots(instance, nextVNode.children)
  }

  function unmountComponent(vnode, doRemove = true) {
    const instance = vnode.component
    const owner = vnode.__keepAliveOwner // the KeepAlive instance caching us, if any

    if (vnode.__shouldKeepAlive && owner && !owner.__keepAliveTearingDown) {
      // KeepAlive is merely SWITCHING children: don't destroy the instance —
      // stash its DOM in the off-screen storage. State (refs, watchers, DOM)
      // survives until the component is shown again.
      move(instance.subTree, keepAliveStorage(), null)
      instance.isDeactivated = true
      invokeHooks(instance.da, instance, 'deactivated hook') // onDeactivated
      return
    }

    invokeHooks(instance.bum, instance, 'beforeUnmount hook') // onBeforeUnmount
    // If this is a KeepAlive going away FOR REAL, its cached children must be
    // destroyed too, not stashed again — flag it before touching the subtree.
    if (instance.type.__isKeepAlive) instance.__keepAliveTearingDown = true
    // Disconnect the component from reactivity: stop the render effect and every
    // watcher/computed created in setup(). Without this the "dead" component
    // would keep re-rendering on state changes and could never be GC'd.
    instance.scope.stop()
    // A re-render may already sit in the scheduler queue — pull it out, and mark
    // the instance so a job that can't be pulled bails out (componentUpdateFn).
    if (instance.update) invalidateJob(instance.update)
    instance.isUnmounted = true
    if (instance.subTree) unmount(instance.subTree, doRemove)
    invokeHooks(instance.um, instance, 'unmounted hook') // onUnmounted

    // KeepAlive teardown: everything still hiding in the cache gets a real
    // unmount (hooks fire, effects stop, storage DOM is freed). The instance
    // that was active is already unmounted above via the subTree — skip it.
    if (instance.__keepAliveCache) {
      for (const cached of instance.__keepAliveCache.values()) {
        if (cached.component && !cached.component.isUnmounted) {
          unmountComponent(cached, true)
        }
      }
      instance.__keepAliveCache.clear()
    }
  }

  return { processComponent, unmountComponent, hydrateComponent }
}

// ---------------------------------------------------------------------------
//  createSSRComponent — render a component on the server (layer 7), without DOM.
//  Creates an instance, runs setup and returns the VNode subtree. No reactive
//  effect is needed: nothing "lives" on the server, we just want a one-off snapshot.
// ---------------------------------------------------------------------------
export function createSSRComponent(vnode, parent) {
  const instance = createComponentInstance(vnode, parent)
  setupComponent(instance)
  const prev = currentRenderingInstance
  currentRenderingInstance = instance // so resolveComponent sees the context
  try {
    const subTree = renderComponentRoot(instance)
    return { instance, subTree }
  } finally {
    currentRenderingInstance = prev
  }
}

// ---------------------------------------------------------------------------
//  createComponentInstance — a component's "personal record": all of its state.
// ---------------------------------------------------------------------------
function createComponentInstance(vnode, parent) {
  const appContext = parent ? parent.appContext : vnode.appContext || defaultAppContext
  const instance = {
    uid: uid++,
    vnode,
    type: vnode.type, // the component definition object
    parent,
    appContext,
    // provides inherits from the parent (or app-level) — see apiInject.
    provides: parent ? parent.provides : appContext.provides,
    propsOptions: normalizePropsOptions(vnode.type.props),
    props: {},
    attrs: {},
    slots: {},
    setupState: {},
    // The component's effect scope: the render effect plus every watch/computed
    // created inside setup() are collected here, so unmount can stop them all
    // with one call. Without this a removed component would stay subscribed to
    // reactive data — re-rendering into nowhere and never being GC'd.
    scope: effectScope(),
    ctx: null, // public proxy for render
    subTree: null, // last rendered tree
    isMounted: false,
    isUnmounted: false, // set on unmount; stale scheduler jobs check it and bail
    isDeactivated: false, // KeepAlive: currently stashed off-screen
    next: null, // next vnode on an update from above
    update: null, // reactive effect runner
    render: null,
    emit: null,
  }
  instance.emit = emit.bind(null, instance)
  return instance
}

// Get a component ready to run: props, slots, setup.
function setupComponent(instance) {
  initProps(instance)
  updateSlots(instance, instance.vnode.children)
  setupStatefulComponent(instance)
}

// Update slots while KEEPING the same instance.slots object reference. This
// matters: setup may have captured slots in a closure (e.g. KeepAlive returns
// () => slots.default()). Reassigning instance.slots to a new object would leave
// the closure looking at the old one. So we move the contents into the same object.
function updateSlots(instance, children) {
  const normalized = normalizeSlots(children)
  for (const key in instance.slots) delete instance.slots[key]
  Object.assign(instance.slots, normalized)
}

function setupStatefulComponent(instance) {
  const Component = instance.type

  // Public context: what render sees as ctx / this. We proxy access so that
  // ctx.count reaches into setupState, and ctx.someProp into props.
  instance.ctx = new Proxy(instance, PublicInstanceHandlers)

  const { setup } = Component
  if (setup) {
    // For the duration of setup, declare the instance current (for onMounted/inject/provide).
    setCurrentInstance(instance)
    const setupContext = {
      emit: instance.emit,
      slots: instance.slots,
      attrs: instance.attrs,
    }
    // Run setup inside the instance's effect scope: watchers and computeds it
    // creates are recorded there and stopped together on unmount.
    let setupResult
    try {
      setupResult = instance.scope.run(() => setup(instance.props, setupContext))
    } catch (err) {
      // setup() is user code: report through the error chain (onErrorCaptured →
      // app.config.errorHandler → console) and continue with an empty state —
      // one broken component must not take the whole mount down.
      handleError(err, instance, 'setup function')
    } finally {
      // ALWAYS clear the current instance, even when setup throws. Otherwise
      // the next hook called anywhere would silently attach to this dead
      // component instead of warning that it ran outside setup().
      setCurrentInstance(null)
    }

    if (typeof setupResult === 'function') {
      // setup returned a render function — use it.
      instance.render = setupResult
    } else if (setupResult && typeof setupResult === 'object') {
      // setup returned a state object. proxyRefs unwraps .value so the template
      // can write count instead of count.value.
      instance.setupState = proxyRefs(setupResult)
    }
  }

  finishComponentSetup(instance)
}

// Compiled render functions, cached per component DEFINITION (the options
// object). A list of a thousand identical components must compile its template
// once, not a thousand times. WeakMap: when the definition is GC'd, so is the
// cached function.
const compileCache = new WeakMap()

function finishComponentSetup(instance) {
  const Component = instance.type
  if (!instance.render) {
    if (Component.render) {
      instance.render = Component.render
    } else if (Component.template && compile) {
      // The compiler from layer 4 turns a template string into a render function.
      let compiled = compileCache.get(Component)
      if (!compiled) {
        compiled = compile(Component.template)
        compileCache.set(Component, compiled)
      }
      instance.render = compiled
    } else {
      instance.render = () => {
        console.warn('Component has neither render nor template (or the compiler is not installed)')
        return null
      }
    }
  }
}

// Call render in the component's context and normalize the result to a VNode.
function renderComponentRoot(instance) {
  const { render, ctx, attrs, type } = instance
  let result
  // this = ctx (for render(){ return h(..., this.count) }) and the first argument
  // is also ctx (for the arrow-style render(ctx){ ... }). Both styles work.
  // Render is user code: a throw is routed to onErrorCaptured/errorHandler and
  // the component renders nothing this pass instead of crashing the patch.
  try {
    result = render.call(ctx, ctx)
  } catch (err) {
    handleError(err, instance, 'render function')
    result = null
  }
  const root = normalizeVNode(result)

  // Fall-through attrs: everything passed to the component but NOT declared in
  // its props (class, id, onClick...) lands on the root element — that's what
  // makes h(Button, { class: 'primary' }) work without Button declaring class.
  // Vue rules: only for a single ELEMENT root (a fragment has nowhere to put
  // them), and the component can opt out with `inheritAttrs: false`.
  if (type.inheritAttrs !== false && typeof root.type === 'string' && attrs) {
    const keys = Object.keys(attrs)
    if (keys.length) {
      root.props = mergeFallthroughAttrs(root.props, attrs)
    }
  }
  return root
}

// Merge fall-through attrs onto the root element's own props. class and style
// COMBINE (both apply), event handlers BOTH fire, everything else the outer
// attr wins (the parent knows better).
function mergeFallthroughAttrs(props, attrs) {
  const merged = { ...props }
  for (const key in attrs) {
    const incoming = attrs[key]
    const existing = merged[key]
    if (key === 'class') {
      // normalizeClass understands strings/arrays/objects and joins them.
      merged.class = normalizeClass([existing, incoming])
    } else if (key === 'style') {
      // Style stays an array — normalizeStyle (used by patchProp/SSR) merges it.
      merged.style = existing != null ? [existing, incoming] : incoming
    } else if (
      /^on[A-Z]/.test(key) &&
      typeof existing === 'function' &&
      typeof incoming === 'function'
    ) {
      merged[key] = (...args) => {
        existing(...args)
        incoming(...args)
      }
    } else {
      merged[key] = incoming
    }
  }
  return merged
}

// ---- props ----------------------------------------------------------------
// A component declares which props it accepts, in one of two forms:
//   props: ['start']                                   // just the names
//   props: { start: Number,                            // shorthand: the type
//            step: { type: Number, default: 1, required: false } }
// Both normalize into a Map: name → { type?, default?, required? }. Anything
// that arrives in the vnode's props but is not declared is treated as a
// fall-through attribute (attrs) — e.g. a class set on the component from outside.
function normalizePropsOptions(raw) {
  const map = new Map()
  if (!raw) return map
  if (Array.isArray(raw)) {
    for (const key of raw) map.set(key, {})
  } else {
    for (const key in raw) {
      const opt = raw[key]
      // `count: Number` and `id: [String, Number]` are shorthands for { type }.
      map.set(key, opt && typeof opt === 'object' && !Array.isArray(opt) ? opt : { type: opt })
    }
  }
  return map
}

// The default may be a factory: object/array defaults MUST be functions, or
// every instance would share one mutable object. A function default is called —
// unless the prop's declared type IS Function (then the function is the value).
function resolvePropDefault(opt) {
  const def = opt.default
  return typeof def === 'function' && opt.type !== Function ? def() : def
}

// Dev-time type check: warn (never throw) when the passed value doesn't match
// the declared type(s). null/undefined values are skipped — absence is the
// `required` flag's business.
function validatePropType(key, value, opt) {
  const type = opt && opt.type
  if (type == null || value == null) return
  const types = Array.isArray(type) ? type : [type]
  if (!types.some((t) => matchesPropType(value, t))) {
    const expected = types.map((t) => (t && t.name) || String(t)).join(' | ')
    console.warn(
      `[minivue] Invalid prop: type check failed for prop "${key}". Expected ${expected}, got ${typeof value}.`,
    )
  }
}

function matchesPropType(value, type) {
  switch (type) {
    case String:
      return typeof value === 'string'
    case Number:
      return typeof value === 'number'
    case Boolean:
      return typeof value === 'boolean'
    case Function:
      return typeof value === 'function'
    case Array:
      return Array.isArray(value)
    case Object:
      return typeof value === 'object' && value !== null
    default:
      // A custom class: check with instanceof. Anything unrecognized passes.
      return typeof type === 'function' ? value instanceof type : true
  }
}

function initProps(instance) {
  const raw = instance.vnode.props || {}
  const options = instance.propsOptions
  const props = {}
  const attrs = {}
  for (const key in raw) {
    if (key === 'key') continue
    if (options.has(key)) props[key] = raw[key]
    else attrs[key] = raw[key]
  }
  // Object-syntax extras: defaults for absent props, required/type warnings.
  for (const [key, opt] of options) {
    if (key in props) {
      validatePropType(key, props[key], opt)
    } else {
      if (opt.required) console.warn(`[minivue] Missing required prop: "${key}"`)
      if ('default' in opt) props[key] = resolvePropDefault(opt)
    }
  }
  // Make props reactive: if the parent passes a new value, a component that read
  // props in render/computed/watch will react.
  instance.props = reactive(props)
  instance.attrs = attrs
}

function updateProps(instance, nextVNode) {
  const raw = nextVNode.props || {}
  const options = instance.propsOptions
  const { props, attrs } = instance
  // Update and add.
  for (const key in raw) {
    if (key === 'key') continue
    if (options.has(key)) {
      props[key] = raw[key]
      validatePropType(key, raw[key], options.get(key))
    } else {
      attrs[key] = raw[key]
    }
  }
  // Remove declared props that are no longer passed (fall back to the default).
  for (const key in props) {
    if (!(key in raw)) {
      const opt = options.get(key)
      if (opt && 'default' in opt) props[key] = resolvePropDefault(opt)
      else delete props[key]
    }
  }
  // Remove stale fall-through attrs too — otherwise a class or id the parent
  // stopped passing would stick to the root element forever.
  for (const key in attrs) {
    if (!(key in raw)) delete attrs[key]
  }
}

// ---- emit -----------------------------------------------------------------
// A component "shouts up" about an event: emit('increment'). The parent listens
// to it as onIncrement. So emit looks for an onXxx handler in the component's props.
const camelize = (str) => str.replace(/-(\w)/g, (_, c) => (c ? c.toUpperCase() : ''))
const toHandlerKey = (event) => 'on' + event[0].toUpperCase() + event.slice(1)

function emit(instance, event, ...args) {
  const props = instance.vnode.props || {}
  // Exact name first (emit('valueChange') → onValueChange), then the camelized
  // form: templates emit kebab-case ('value-change') while parents listen in
  // camelCase — 'onValue-change' would never match anything.
  const handler = props[toHandlerKey(event)] || props[toHandlerKey(camelize(event))]
  // The handler is user code — route a throw to the error chain, don't let it
  // unwind through the child's render that called emit.
  if (handler) callWithErrorHandling(handler, instance, `"${event}" event handler`, args)
}

// ---- slots ----------------------------------------------------------------
// A slot is a "hole" where the parent drops its own markup. A component's children
// are its slots. Array/string → the default slot. Object → named slots
// { header: () => ..., footer: () => ... }.
function normalizeSlots(children) {
  if (children == null) return {}
  if (Array.isArray(children)) {
    return { default: () => children }
  }
  if (typeof children === 'object' && !isVNode(children)) {
    const slots = {}
    for (const name in children) {
      const value = children[name]
      slots[name] = typeof value === 'function' ? value : () => value
    }
    return slots
  }
  return { default: () => [normalizeVNode(children)] }
}

// ---- public context proxy --------------------------------------------------
// Defines what render sees as ctx.<something>. Lookup order: state from setup
// first, then props, then the built-in $ properties.
const PublicInstanceHandlers = {
  get(instance, key) {
    const { setupState, props } = instance
    if (setupState && Object.prototype.hasOwnProperty.call(setupState, key)) {
      return setupState[key]
    }
    if (props && key in props) {
      return props[key]
    }
    // Built-in properties, like $emit in Vue.
    switch (key) {
      case '$emit':
        return instance.emit
      case '$slots':
        return instance.slots
      case '$attrs':
        return instance.attrs
      case '$props':
        return instance.props
      case '$el':
        return instance.vnode.el
    }
    // App-level global properties (e.g. $router/$route from plugins).
    const globalProps = instance.appContext.config.globalProperties
    if (globalProps && key in globalProps) {
      return globalProps[key]
    }
    return undefined
  },
  set(instance, key, value) {
    const { setupState, props } = instance
    if (setupState && Object.prototype.hasOwnProperty.call(setupState, key)) {
      setupState[key] = value // proxyRefs writes into ref.value
      return true
    }
    // Anything else must not be swallowed in silence: the developer thinks the
    // write worked, then wonders why the UI never changes.
    if (props && key in props) {
      // Props belong to the parent — the next parent render would overwrite the
      // write anyway. The child should emit an event instead.
      console.warn(`[minivue] Attempting to mutate prop "${key}". Props are readonly.`)
    } else {
      console.warn(
        `[minivue] Setting unknown property "${key}" on the component instance — it is not in setup() state, so nothing will react to it.`,
      )
    }
    return true // report success to the proxy; the warning is the real signal
  },
  // has is needed for with(ctx) in compiled templates (layer 4). with asks "does
  // ctx have this identifier?": for state/props we answer "yes" (take it from ctx),
  // for h/_s/Fragment "no" (they come from the generator's outer scope).
  //
  // The answer for everything ELSE is a safety decision. Saying "no" would let
  // the identifier fall through `with` to the real JavaScript globals — so a
  // template could reach window, document, alert()... and a simple typo would
  // explode with a raw ReferenceError mid-render. Instead we do what Vue does:
  //   - a small whitelist of harmless globals (Math, Date, JSON...) falls
  //     through, so {{ Math.max(a, b) }} keeps working;
  //   - any OTHER unknown identifier is claimed by ctx — the get trap returns
  //     undefined for it — and we warn once so the typo is still discoverable.
  has(instance, key) {
    if (typeof key !== 'string') return false // e.g. Symbol.unscopables from `with`
    const { setupState, props } = instance
    if (
      (setupState && key in setupState) ||
      (props && key in props) ||
      key[0] === '$'
    ) {
      return true
    }
    // App-level global properties are resolved by the get trap.
    const globalProps = instance.appContext.config.globalProperties
    if (globalProps && key in globalProps) return true
    // The compiler's own helpers must fall through to the render function's
    // outer scope (see createRenderFunction in packages/compiler/compile.js).
    if (RENDER_HELPERS.has(key)) return false
    if (TEMPLATE_GLOBALS_WHITELIST.has(key)) return false
    // Unknown identifier: claim it so it resolves to undefined instead of
    // throwing a ReferenceError — and tell the developer about it, once.
    if (!warnedMissingKeys.has(key)) {
      warnedMissingKeys.add(key)
      console.warn(
        `[minivue] Property "${key}" was accessed during render but is not defined on instance.`,
      )
    }
    return true
  },
}

// Globals a template may legitimately use — {{ Math.round(x) }} and the like.
// Everything not on this list (window, document, alert...) is unreachable from
// templates: expressions should stay simple, and state belongs on the component.
const TEMPLATE_GLOBALS_WHITELIST = new Set([
  'Math', 'Date', 'JSON', 'Number', 'String', 'Boolean', 'Array', 'Object',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'console',
  'Infinity', 'NaN', 'undefined',
])

// Helper names the compiler injects into the render function's scope — the
// has trap must NOT claim these. Kept in sync with createRenderFunction in
// packages/compiler/compile.js.
const RENDER_HELPERS = new Set([
  'h', 'Fragment', '_s', '_l', '_c', '_key', '_cd', '_wd', '_dir', '_m', '_th',
])

// Warn about each missing property only once per process — a render effect
// re-runs on every update, and repeating the warning would flood the console.
const warnedMissingKeys = new Set()

// The default app context — for a vnode not tied to a createApp (e.g. when
// rendering a component directly in tests).
export const defaultAppContext = {
  provides: Object.create(null),
  components: Object.create(null),
  directives: Object.create(null),
  // errorHandler — the app-wide error hook (app.config.errorHandler = fn);
  // see errorHandling.js for when it is called.
  config: { globalProperties: {}, errorHandler: null },
}

export function createAppContext() {
  return {
    provides: Object.create(null),
    components: Object.create(null),
    directives: Object.create(null),
    config: { globalProperties: {}, errorHandler: null },
  }
}
