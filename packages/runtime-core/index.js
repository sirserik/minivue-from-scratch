// Public entry point of the runtime core (platform-agnostic).
// For the browser "build", see packages/runtime-dom/index.js.

// Virtual DOM
export { h, createVNode, isVNode, normalizeVNode, withDirectives, Text, Fragment } from './vnode.js'

// Renderer
export { createRenderer } from './renderer.js'

// Components
export {
  createComponentSystem,
  defineComponent,
  getCurrentInstance,
  registerRuntimeCompiler,
  createAppContext,
} from './component.js'
export { createAppAPI } from './apiCreateApp.js'

// Scheduler
export { nextTick, queueJob, invalidateJob } from './scheduler.js'

// Error handling (see errorHandling.js for the propagation order)
export { callWithErrorHandling, handleError } from './errorHandling.js'

// Lifecycle hooks
export {
  onBeforeMount,
  onMounted,
  onBeforeUpdate,
  onUpdated,
  onBeforeUnmount,
  onUnmounted,
  onActivated,
  onDeactivated,
  onErrorCaptured,
} from './apiLifecycle.js'

// provide / inject
export { provide, inject } from './apiInject.js'

// Built-in components
export { Teleport, KeepAlive, defineAsyncComponent } from './builtins.js'

// Re-export reactivity — so one package is enough for the app.
export {
  ref,
  reactive,
  computed,
  watch,
  watchEffect,
  effect,
  isRef,
  unref,
  toRef,
  toRefs,
  shallowRef,
  triggerRef,
  shallowReactive,
  readonly,
  isReadonly,
  isReactive,
  isProxy,
  toRaw,
  markRaw,
} from '../reactivity/index.js'
