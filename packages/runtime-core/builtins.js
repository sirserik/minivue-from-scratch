// ============================================================================
//  builtins.js — встроенные компоненты (Teleport, KeepAlive, async)
// ----------------------------------------------------------------------------
//  Это не обычные компоненты: у них есть особые метки (__isTeleport, __isKeepAlive),
//  по которым рендерер понимает, что обрабатывать их надо иначе. Компилятор
//  находит их по имени через resolveComponent (см. список BUILTINS в component.js).
// ============================================================================

import { h } from './vnode.js'
import { ref } from '../reactivity/index.js'

// ---------------------------------------------------------------------------
//  Teleport — «портал»: рисует своих детей не на месте, а в указанном контейнере.
//  Нужен для оверлеев, модалок, тултипов: логически элемент внутри компонента, а
//  физически — в конце <body>, чтобы не резался overflow'ом и z-index'ом родителя.
//
//    <Teleport to="#modals"><div class="modal">...</div></Teleport>
//
//  Сам компонент — просто метка; вся логика в рендерере (processTeleport).
// ---------------------------------------------------------------------------
export const Teleport = {
  name: 'Teleport',
  __isTeleport: true,
}

// ---------------------------------------------------------------------------
//  KeepAlive — кэширует неактивные компоненты вместо их уничтожения. Переключили
//  вкладку и вернулись — состояние (введённый текст, позиция) на месте. Оборачивает
//  динамический компонент:
//
//    <KeepAlive><component :is="tab" /></KeepAlive>
//
//  Логика активации/деактивации — в рендерере (по меткам на vnode). Здесь мы лишь
//  ведём кэш «ключ → vnode с живым инстансом» и расставляем метки.
// ---------------------------------------------------------------------------
export const KeepAlive = {
  name: 'KeepAlive',
  __isKeepAlive: true,
  setup(props, { slots }) {
    const cache = new Map() // ключ компонента → его закэшированный vnode

    return () => {
      const children = slots.default ? slots.default() : []
      const vnode = children[0]
      // Кэшируем только компоненты (у тегов состояние хранить незачем).
      if (!vnode || typeof vnode.type !== 'object') return vnode || null

      const key = vnode.key != null ? vnode.key : vnode.type
      if (cache.has(key)) {
        // Уже видели: переиспользуем живой инстанс из кэша.
        vnode.component = cache.get(key).component
        vnode.__keptAlive = true // рендерер «оживит», а не смонтирует заново
      } else {
        cache.set(key, vnode)
      }
      // При уходе рендерер спрячет этот vnode в хранилище, а не разрушит.
      vnode.__shouldKeepAlive = true
      return vnode
    }
  },
}

// ---------------------------------------------------------------------------
//  defineAsyncComponent — компонент, который грузится по требованию (код придёт
//  позже, например по сети). Пока грузится — показываем «загрузку», после —
//  настоящий компонент. Реактивность делает всё сама: ref переключает вид.
//
//    const Chart = defineAsyncComponent(() => import('./Chart.js'))
// ---------------------------------------------------------------------------
export function defineAsyncComponent(source) {
  const options = typeof source === 'function' ? { loader: source } : source
  let resolvedComponent = null

  return {
    name: 'AsyncComponentWrapper',
    setup() {
      const loaded = ref(false)
      const error = ref(null)

      options
        .loader()
        .then((mod) => {
          // Поддерживаем и `export default`, и прямой возврат компонента.
          resolvedComponent = mod && mod.default ? mod.default : mod
          loaded.value = true
        })
        .catch((err) => {
          error.value = err
        })

      return () => {
        if (loaded.value && resolvedComponent) return h(resolvedComponent)
        if (error.value) {
          return options.errorComponent ? h(options.errorComponent) : h('span', 'Ошибка загрузки')
        }
        return options.loadingComponent ? h(options.loadingComponent) : h('span', 'Загрузка…')
      }
    },
  }
}

// Карта встроенных компонентов — по ней resolveComponent находит их по имени.
export const BUILTIN_COMPONENTS = { Teleport, KeepAlive }
