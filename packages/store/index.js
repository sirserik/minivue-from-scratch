// ============================================================================
//  store — аналог Pinia
// ----------------------------------------------------------------------------
//  Состояние компонента живёт внутри него. Но часто нужно состояние, общее для
//  всего приложения: корзина, текущий пользователь, тема. Тащить его через props
//  и события по всему дереву мучительно. Стор — это отдельное реактивное
//  хранилище, к которому любой компонент обращается напрямую.
//
//  Как и всё в MiniVue, стор — надстройка над реактивностью слоя 1. State — это
//  reactive/ref, getters — computed, actions — обычные функции, меняющие state.
//  Никакой отдельной «магии стора» нет.
// ============================================================================

import { reactive, computed, inject, getCurrentInstance, watch } from '../runtime-core/index.js'
import { proxyRefs, toRef } from '../reactivity/index.js'

// Ключ для inject и «активный» стор-контейнер (на случай вызова вне setup).
const PINIA_KEY = Symbol('pinia')
let activePinia = null
export function setActivePinia(pinia) {
  activePinia = pinia
}

// ---------------------------------------------------------------------------
//  createPinia() — контейнер всех сторов приложения. Подключается как плагин:
//  app.use(createPinia()).
// ---------------------------------------------------------------------------
export function createPinia() {
  const pinia = {
    _stores: new Map(), // id → готовый стор (создаётся один раз, лениво)
    _plugins: [], // расширения (см. use ниже)
    state: reactive({}), // общее состояние: state[id] = состояние стора id

    // Регистрация плагина стора. Плагин получает { store, pinia, id } и может
    // что-то к стору добавить (логирование, персист и т.п.).
    use(plugin) {
      pinia._plugins.push(plugin)
      return pinia
    },

    // Подключение к приложению.
    install(app) {
      setActivePinia(pinia)
      app.provide(PINIA_KEY, pinia)
      app.config.globalProperties.$pinia = pinia
    },
  }
  return pinia
}

// Достать активный контейнер: в setup — через inject, иначе — глобальный.
function getActivePinia() {
  const fromInject = getCurrentInstance() ? inject(PINIA_KEY, null) : null
  return fromInject || activePinia
}

// ---------------------------------------------------------------------------
//  defineStore — объявить стор. Два стиля:
//
//   1) Options — как во Vue Options API:
//      defineStore('counter', {
//        state: () => ({ count: 0 }),
//        getters: { double: (s) => s.count * 2 },
//        actions: { inc() { this.count++ } },
//      })
//
//   2) Setup — как Composition API:
//      defineStore('counter', () => {
//        const count = ref(0)
//        const double = computed(() => count.value * 2)
//        const inc = () => count.value++
//        return { count, double, inc }
//      })
//
//  Возвращает функцию useStore(), которая при первом вызове создаёт стор, а
//  дальше отдаёт тот же самый экземпляр (стор — одиночка на приложение).
// ---------------------------------------------------------------------------
export function defineStore(id, setupOrOptions) {
  function useStore() {
    const pinia = getActivePinia()
    if (!pinia) {
      throw new Error('Pinia не установлена: вызовите app.use(createPinia())')
    }
    if (!pinia._stores.has(id)) {
      createStore(id, setupOrOptions, pinia)
    }
    return pinia._stores.get(id)
  }
  useStore.$id = id
  return useStore
}

// Создать и зарегистрировать стор.
function createStore(id, setupOrOptions, pinia) {
  let store // ссылка на итоговый стор — нужна getters/actions как this

  const isSetupStyle = typeof setupOrOptions === 'function'
  const setup = isSetupStyle
    ? setupOrOptions
    : optionsToSetup(id, setupOrOptions, pinia, () => store)

  // parts — объект из ref/computed/функций. proxyRefs разворачивает .value,
  // поэтому снаружи пишут store.count, а не store.count.value.
  const parts = setup()
  store = proxyRefs(parts)
  store.$id = id
  store._parts = parts // пригодится для storeToRefs

  // $state — прямой доступ к реактивному состоянию (для options-сторов).
  if (pinia.state[id]) {
    Object.defineProperty(store, '$state', { get: () => pinia.state[id] })
  }

  // Служебные методы стора: $patch / $subscribe / $reset.
  addStoreApi(store, id, pinia, isSetupStyle ? null : setupOrOptions)

  pinia._stores.set(id, store)

  // Прогоняем плагины стора: то, что они вернут, домешиваем в стор.
  for (const plugin of pinia._plugins) {
    const extension = plugin({ store, pinia, id })
    if (extension) Object.assign(store, extension)
  }

  return store
}

// Навесить служебные методы, начинающиеся с $ (как в Pinia).
function addStoreApi(store, id, pinia, options) {
  const stateTarget = pinia.state[id] || store // options → реактивный state, setup → сам стор

  // $patch — групповое изменение: объектом (частичное слияние) или функцией.
  //   store.$patch({ count: 5 })
  //   store.$patch((s) => { s.count++; s.done = true })
  store.$patch = (partialOrFn) => {
    if (typeof partialOrFn === 'function') partialOrFn(stateTarget)
    else Object.assign(stateTarget, partialOrFn)
  }

  // $subscribe — вызвать колбэк при любом изменении состояния стора.
  store.$subscribe = (callback) => {
    if (pinia.state[id]) {
      // options-стор: следим за реактивным состоянием (watch по reactive глубок).
      return watch(pinia.state[id], () => callback(store))
    }
    // setup-стор: следим только за ref-полями СОСТОЯНИЯ. computed исключаем
    // (у него есть .effect) — иначе одно изменение состояния сработало бы дважды:
    // и от самого ref, и от зависящего от него computed.
    const stateKeys = Object.keys(store._parts).filter((k) => {
      const v = store._parts[k]
      return v && v.__isRef && !v.effect
    })
    return watch(
      () => stateKeys.map((k) => store[k]),
      () => callback(store),
    )
  }

  // $reset — вернуть состояние к начальному (только для options-сторов, где мы
  // знаем функцию state(), которой можно получить свежие значения).
  store.$reset = () => {
    if (!options || !options.state) {
      console.warn(`$reset доступен только для options-стора (id: ${id})`)
      return
    }
    Object.assign(pinia.state[id], options.state())
  }
}

// Превратить options-описание в setup-функцию — так у нас один путь создания.
function optionsToSetup(id, options, pinia, getStore) {
  return function setup() {
    // Состояние храним в общем контейнере pinia.state[id] — реактивное.
    const state = reactive(options.state ? options.state() : {})
    pinia.state[id] = state

    const parts = {}
    // Каждое поле состояния отдаём как ref, связанный с общим состоянием.
    for (const key in state) {
      parts[key] = toRef(state, key)
    }
    // getters → computed. this и первый аргумент — сам стор.
    for (const name in options.getters || {}) {
      const getterFn = options.getters[name]
      parts[name] = computed(() => getterFn.call(getStore(), getStore()))
    }
    // actions → функции с this = стор.
    for (const name in options.actions || {}) {
      const actionFn = options.actions[name]
      parts[name] = function (...args) {
        return actionFn.apply(getStore(), args)
      }
    }
    return parts
  }
}

// ---------------------------------------------------------------------------
//  storeToRefs(store) — превратить поля стора обратно в ref'ы.
//  Нужно, чтобы деструктуризация не рвала реактивность:
//    const { count, double } = storeToRefs(store)  // count.value реактивен
//  Actions при этом берут прямо из стора: const { inc } = store.
// ---------------------------------------------------------------------------
export function storeToRefs(store) {
  const refs = {}
  for (const key in store._parts) {
    const value = store._parts[key]
    // Пропускаем функции (actions) — их деструктурируют напрямую из стора.
    if (typeof value === 'function' && !value.__isRef) continue
    // toRef(store, key) читает/пишет store[key], сохраняя реактивную связь.
    refs[key] = toRef(store, key)
  }
  return refs
}
