// ============================================================================
//  runtime-dom — «сборка» рендерера под браузер.
//  Соединяем платформо-независимый renderer из runtime-core с браузерными
//  операциями nodeOps и patchProp, подключаем систему компонентов и отдаём
//  наружу готовые render(), createApp() и весь публичный API.
// ============================================================================

import { createRenderer } from '../runtime-core/renderer.js'
import { createComponentSystem } from '../runtime-core/component.js'
import { createAppAPI } from '../runtime-core/apiCreateApp.js'
import { nodeOps } from './nodeOps.js'
import { patchProp } from './patchProp.js'

// Набор операций: узлы + patchProp.
const rendererOptions = { ...nodeOps, patchProp }

// Экземпляр рендерера для браузера.
const renderer = createRenderer(rendererOptions)

// Подключаем поддержку компонентов: рендерер отдаёт свои внутренности, система
// компонентов возвращает обработчики, которые рендерер вставляет в patch.
renderer.__installComponents((internals) => createComponentSystem(internals))

// Публичные точки входа.
export const render = renderer.render
export const hydrate = renderer.hydrate // «оживление» серверного HTML (слой 7)
export const createApp = createAppAPI(renderer.render)

// Реэкспорт всего пользовательского API из ядра — один импорт на всё.
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
  ref,
  reactive,
  computed,
  watch,
  effect,
  isRef,
  unref,
  toRef,
  toRefs,
} from '../runtime-core/index.js'
