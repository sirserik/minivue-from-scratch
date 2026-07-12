// ============================================================================
//  runtime-dom — the browser "build" of the renderer.
//  Combines the platform-agnostic renderer from runtime-core with the browser
//  operations nodeOps and patchProp, wires in the component system, and
//  exposes ready-to-use render(), createApp() and the whole public API.
// ============================================================================

import { createRenderer } from '../runtime-core/renderer.js'
import { createComponentSystem } from '../runtime-core/component.js'
import { createAppAPI } from '../runtime-core/apiCreateApp.js'
import { nodeOps } from './nodeOps.js'
import { patchProp } from './patchProp.js'

// Operation set: node ops + patchProp.
const rendererOptions = { ...nodeOps, patchProp }

// Renderer instance for the browser.
const renderer = createRenderer(rendererOptions)

// Wire in component support: the renderer exposes its internals, and the
// component system returns handlers that the renderer plugs into patch.
renderer.__installComponents((internals) => createComponentSystem(internals))

// Public entry points.
export const render = renderer.render
export const hydrate = renderer.hydrate // hydrate server-rendered HTML (layer 7)
/**
 * Create an application instance bound to the browser renderer.
 * @param {object} rootComponent - Root component definition.
 * @param {object} [rootProps] - Props passed to the root component.
 * @returns {object} App instance with mount()/unmount()/use()/etc.
 */
export const createApp = createAppAPI(renderer.render)

// Re-export the entire user-facing API from the core — one import for all of it.
export {
  h,
  createVNode,
  Text,
  Fragment,
  nextTick,
  getCurrentInstance,
  onBeforeMount,
  onMounted,
  onBeforeUpdate,
  onUpdated,
  onBeforeUnmount,
  onUnmounted,
  provide,
  inject,
  Teleport,
  KeepAlive,
  defineAsyncComponent,
  withDirectives,
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
  markRaw,
} from '../runtime-core/index.js'
