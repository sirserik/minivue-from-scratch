// Публичный вход ядра рантайма (без привязки к платформе).
// Браузерную «сборку» см. в packages/runtime-dom/index.js.

// Virtual DOM
export { h, createVNode, isVNode, normalizeVNode, Text, Fragment } from './vnode.js'

// Рендерер
export { createRenderer } from './renderer.js'

// Компоненты
export {
  createComponentSystem,
  getCurrentInstance,
  registerRuntimeCompiler,
  createAppContext,
} from './component.js'
export { createAppAPI } from './apiCreateApp.js'

// Планировщик
export { nextTick, queueJob } from './scheduler.js'

// Хуки жизненного цикла
export {
  onBeforeMount,
  onMounted,
  onBeforeUpdate,
  onUpdated,
  onBeforeUnmount,
  onUnmounted,
} from './apiLifecycle.js'

// provide / inject
export { provide, inject } from './apiInject.js'

// Реэкспорт реактивности — чтобы приложению хватало одного пакета.
export {
  ref,
  reactive,
  computed,
  watch,
  effect,
  isRef,
  unref,
  toRef,
  toRefs,
} from '../reactivity/index.js'
