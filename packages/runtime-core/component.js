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

import { reactive, proxyRefs, ReactiveEffect } from '../reactivity/index.js'
import { normalizeVNode, isVNode } from './vnode.js'
import { queueJob } from './scheduler.js'
import { invokeHooks } from './apiLifecycle.js'
import { BUILTIN_COMPONENTS } from './builtins.js'

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
  const { patch, unmount, hydrateNode } = internals

  function processComponent(n1, n2, container, anchor) {
    if (n1 == null) {
      mountComponent(n2, container, anchor)
    } else {
      updateComponent(n1, n2)
    }
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
  function hydrateComponent(vnode, domNode) {
    const instance = (vnode.component = createComponentInstance(
      vnode,
      currentRenderingInstance,
    ))
    setupComponent(instance)
    // The container for future patches is the existing node's parent; the fourth
    // argument passes the node itself as the "hydration point" for the first render.
    setupRenderEffect(instance, domNode.parentNode, null, domNode)
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
      // For the duration of rendering and patching the subtree, declare ourselves
      // current — so child components take us as their parent.
      const prevRendering = currentRenderingInstance
      currentRenderingInstance = instance
      try {
        if (!instance.isMounted) {
          invokeHooks(instance.bm) // onBeforeMount
          const subTree = (instance.subTree = renderComponentRoot(instance))
          if (hydrationNode) {
            // Hydration: "adopt" existing DOM instead of creating new nodes.
            hydrateNode(hydrationNode, subTree)
          } else {
            patch(null, subTree, container, anchor)
          }
          instance.vnode.el = subTree.el // the component's root node
          instance.isMounted = true
          invokeHooks(instance.m) // onMounted
        } else {
          // If a new vnode came from the parent, update props/slots first.
          if (instance.next) {
            updateComponentPreRender(instance, instance.next)
            instance.next = null
          }
          invokeHooks(instance.bu) // onBeforeUpdate
          const nextTree = renderComponentRoot(instance)
          const prevTree = instance.subTree
          instance.subTree = nextTree
          patch(prevTree, nextTree, container, anchor)
          instance.vnode.el = nextTree.el
          invokeHooks(instance.u) // onUpdated
        }
      } finally {
        currentRenderingInstance = prevRendering
      }
    }

    // Wrap it in a reactive effect. The scheduler is a queue: when reactive data
    // read during render changes, the component is queued for an update rather
    // than re-rendered immediately.
    const effect = new ReactiveEffect(componentUpdateFn, () => queueJob(instance.update))

    // instance.update is the effect's "runner". The id lets the scheduler sort
    // (parent before child).
    const update = (instance.update = effect.run.bind(effect))
    update.id = instance.uid
    update() // first run = mount
  }

  // Update props and slots before re-rendering (data came from the parent).
  function updateComponentPreRender(instance, nextVNode) {
    instance.vnode = nextVNode
    nextVNode.el = instance.subTree ? instance.subTree.el : null
    updateProps(instance, nextVNode)
    updateSlots(instance, nextVNode.children)
  }

  function unmountComponent(vnode) {
    const instance = vnode.component
    invokeHooks(instance.bum) // onBeforeUnmount
    if (instance.subTree) unmount(instance.subTree)
    invokeHooks(instance.um) // onUnmounted
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
    ctx: null, // public proxy for render
    subTree: null, // last rendered tree
    isMounted: false,
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
    const setupResult = setup(instance.props, setupContext)
    setCurrentInstance(null)

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

function finishComponentSetup(instance) {
  const Component = instance.type
  if (!instance.render) {
    if (Component.render) {
      instance.render = Component.render
    } else if (Component.template && compile) {
      // The compiler from layer 4 turns a template string into a render function.
      instance.render = compile(Component.template)
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
  const { render, ctx } = instance
  // this = ctx (for render(){ return h(..., this.count) }) and the first argument
  // is also ctx (for the arrow-style render(ctx){ ... }). Both styles work.
  return normalizeVNode(render.call(ctx, ctx))
}

// ---- props ----------------------------------------------------------------
// A component declares which props it accepts (props: ['start'] or an object).
// Anything that arrives in its props but is not declared is treated as a
// fall-through attribute (attrs) — e.g. a class set on the component from outside.
function normalizePropsOptions(raw) {
  if (!raw) return new Set()
  if (Array.isArray(raw)) return new Set(raw)
  return new Set(Object.keys(raw))
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
  // Make props reactive: if the parent passes a new value, a component that read
  // props in render/computed/watch will react.
  instance.props = reactive(props)
  instance.attrs = attrs
}

function updateProps(instance, nextVNode) {
  const raw = nextVNode.props || {}
  const options = instance.propsOptions
  const props = instance.props
  // Update and add.
  for (const key in raw) {
    if (key === 'key') continue
    if (options.has(key)) props[key] = raw[key]
    else instance.attrs[key] = raw[key]
  }
  // Remove declared props that are no longer passed.
  for (const key in props) {
    if (!(key in raw)) delete props[key]
  }
}

// ---- emit -----------------------------------------------------------------
// A component "shouts up" about an event: emit('increment'). The parent listens
// to it as onIncrement. So emit looks for an onXxx handler in the component's props.
function emit(instance, event, ...args) {
  const handlerName = 'on' + event[0].toUpperCase() + event.slice(1)
  const handler = instance.vnode.props && instance.vnode.props[handlerName]
  if (handler) handler(...args)
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
    const { setupState } = instance
    if (setupState && Object.prototype.hasOwnProperty.call(setupState, key)) {
      setupState[key] = value // proxyRefs writes into ref.value
      return true
    }
    return true
  },
  // has is needed for with(ctx) in compiled templates (layer 4). with asks "does
  // ctx have this identifier?": for state/props we answer "yes" (take it from ctx),
  // for h/_s/Fragment "no" (they come from the generator's outer scope).
  has(instance, key) {
    const { setupState, props } = instance
    return (
      (setupState && key in setupState) ||
      (props && key in props) ||
      (typeof key === 'string' && key[0] === '$')
    )
  },
}

// The default app context — for a vnode not tied to a createApp (e.g. when
// rendering a component directly in tests).
export const defaultAppContext = {
  provides: Object.create(null),
  components: Object.create(null),
  directives: Object.create(null),
  config: { globalProperties: {} },
}

export function createAppContext() {
  return {
    provides: Object.create(null),
    components: Object.create(null),
    directives: Object.create(null),
    config: { globalProperties: {} },
  }
}
