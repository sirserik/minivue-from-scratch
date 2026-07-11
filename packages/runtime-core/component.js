// ============================================================================
//  component.js — система компонентов
// ----------------------------------------------------------------------------
//  Компонент — это переиспользуемая единица «состояние + разметка». В слое 2 мы
//  вручную связывали ref и render через effect. Компонент оформляет ровно эту
//  связку как объект, которым можно пользоваться много раз:
//
//    const Counter = {
//      props: ['start'],
//      setup(props) {
//        const count = ref(props.start)
//        return { count, inc: () => count.value++ }
//      },
//      render(ctx) {
//        return h('button', { onClick: ctx.inc }, 'Кликов: ' + ctx.count)
//      },
//    }
//
//  Ниже — как это оживает: как считываются props, как работает setup(), и как
//  реактивный эффект перерисовывает компонент при изменениях.
// ============================================================================

import { reactive, proxyRefs, ReactiveEffect } from '../reactivity/index.js'
import { normalizeVNode, isVNode } from './vnode.js'
import { queueJob } from './scheduler.js'
import { invokeHooks } from './apiLifecycle.js'

// ---- Текущий компонент ----------------------------------------------------
//  Пока выполняется setup() компонента, ссылка на его инстанс лежит здесь. Так
//  onMounted / inject / provide, вызванные внутри setup, узнают, к какому
//  компоненту относятся, не получая его аргументом.
let currentInstance = null
export function getCurrentInstance() {
  return currentInstance
}
function setCurrentInstance(instance) {
  currentInstance = instance
}

// ---- Текущий рендерящийся компонент ---------------------------------------
//  Пока выполняется код обновления компонента (render + patch его поддерева),
//  здесь лежит его инстанс. Дочерние компоненты, смонтированные в этот момент,
//  берут его как родителя — так выстраивается дерево компонентов без передачи
//  родителя через все вызовы patch.
let currentRenderingInstance = null

// ---- Подключаемый компилятор шаблонов -------------------------------------
//  Слой 4 зарегистрирует сюда функцию compile(template) → render. Пока её нет,
//  компонент обязан иметь свою render-функцию или setup, возвращающий render.
let compile = null
export function registerRuntimeCompiler(fn) {
  compile = fn
}

let uid = 0

// ---------------------------------------------------------------------------
//  createComponentSystem — фабрика, которую вызывает рендерер через
//  __installComponents. Получает «внутренности» рендерера (patch, unmount) и
//  возвращает две функции, которые рендерер вставит в свой patch: как
//  обрабатывать и как размонтировать компонент.
// ---------------------------------------------------------------------------
export function createComponentSystem(internals) {
  const { patch, unmount } = internals

  function processComponent(n1, n2, container, anchor) {
    if (n1 == null) {
      mountComponent(n2, container, anchor)
    } else {
      updateComponent(n1, n2)
    }
  }

  function mountComponent(vnode, container, anchor) {
    // 1. Создаём инстанс. Родитель — тот, что сейчас рендерится.
    const instance = (vnode.component = createComponentInstance(
      vnode,
      currentRenderingInstance,
    ))

    // 2. Готовим props, slots и запускаем setup().
    setupComponent(instance)

    // 3. Заводим реактивный эффект, который рисует и перерисовывает компонент.
    setupRenderEffect(instance, container, anchor)
  }

  function updateComponent(n1, n2) {
    // Родитель перерисовался и передал компоненту новый vnode (возможно, с
    // новыми props). Переиспользуем существующий инстанс.
    const instance = (n2.component = n1.component)
    instance.next = n2 // «следующий» vnode обработается перед перерисовкой
    // Планируем обновление через очередь (дедупликация: даже если props тоже
    // реактивно дёрнут эффект, компонент перерисуется один раз).
    queueJob(instance.update)
  }

  function setupRenderEffect(instance, container, anchor) {
    // Функция одного «прохода» рендера компонента. При первом запуске монтирует,
    // при последующих — обновляет.
    const componentUpdateFn = () => {
      // На время рендера и патча поддерева объявляем себя текущим — чтобы
      // дочерние компоненты взяли нас родителем.
      const prevRendering = currentRenderingInstance
      currentRenderingInstance = instance
      try {
        if (!instance.isMounted) {
          invokeHooks(instance.bm) // onBeforeMount
          const subTree = (instance.subTree = renderComponentRoot(instance))
          patch(null, subTree, container, anchor)
          instance.vnode.el = subTree.el // корневой узел компонента
          instance.isMounted = true
          invokeHooks(instance.m) // onMounted
        } else {
          // Если пришёл новый vnode от родителя — сначала обновим props/slots.
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

    // Оборачиваем в реактивный эффект. Планировщик — очередь: при изменении
    // реактивных данных, прочитанных в render, компонент попадёт в очередь на
    // обновление, а не перерисуется мгновенно.
    const effect = new ReactiveEffect(componentUpdateFn, () => queueJob(instance.update))

    // instance.update — «раннер» эффекта. id нужен планировщику для сортировки
    // (родитель раньше ребёнка).
    const update = (instance.update = effect.run.bind(effect))
    update.id = instance.uid
    update() // первый запуск = монтирование
  }

  // Обновить props и slots перед перерисовкой (данные пришли от родителя).
  function updateComponentPreRender(instance, nextVNode) {
    instance.vnode = nextVNode
    nextVNode.el = instance.subTree ? instance.subTree.el : null
    updateProps(instance, nextVNode)
    instance.slots = normalizeSlots(nextVNode.children)
  }

  function unmountComponent(vnode) {
    const instance = vnode.component
    invokeHooks(instance.bum) // onBeforeUnmount
    if (instance.subTree) unmount(instance.subTree)
    invokeHooks(instance.um) // onUnmounted
  }

  return { processComponent, unmountComponent }
}

// ---------------------------------------------------------------------------
//  createComponentInstance — «личное дело» компонента: всё его состояние.
// ---------------------------------------------------------------------------
function createComponentInstance(vnode, parent) {
  const appContext = parent ? parent.appContext : vnode.appContext || defaultAppContext
  const instance = {
    uid: uid++,
    vnode,
    type: vnode.type, // объект-описание компонента
    parent,
    appContext,
    // provides наследует родительские (или общеприложенческие) — см. apiInject.
    provides: parent ? parent.provides : appContext.provides,
    propsOptions: normalizePropsOptions(vnode.type.props),
    props: {},
    attrs: {},
    slots: {},
    setupState: {},
    ctx: null, // публичный прокси для render
    subTree: null, // последнее отрисованное дерево
    isMounted: false,
    next: null, // следующий vnode при обновлении сверху
    update: null, // раннер реактивного эффекта
    render: null,
    emit: null,
  }
  instance.emit = emit.bind(null, instance)
  return instance
}

// Подготовить компонент к работе: props, slots, setup.
function setupComponent(instance) {
  initProps(instance)
  instance.slots = normalizeSlots(instance.vnode.children)
  setupStatefulComponent(instance)
}

function setupStatefulComponent(instance) {
  const Component = instance.type

  // Публичный контекст: то, что доступно в render как ctx / this. Проксируем
  // доступ так, чтобы ctx.count лез в setupState, а ctx.someProp — в props.
  instance.ctx = new Proxy(instance, PublicInstanceHandlers)

  const { setup } = Component
  if (setup) {
    // На время setup объявляем инстанс текущим (для onMounted/inject/provide).
    setCurrentInstance(instance)
    const setupContext = {
      emit: instance.emit,
      slots: instance.slots,
      attrs: instance.attrs,
    }
    const setupResult = setup(instance.props, setupContext)
    setCurrentInstance(null)

    if (typeof setupResult === 'function') {
      // setup вернул render-функцию — используем её.
      instance.render = setupResult
    } else if (setupResult && typeof setupResult === 'object') {
      // setup вернул объект состояния. proxyRefs разворачивает .value, чтобы в
      // шаблоне писать count, а не count.value.
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
      // Компилятор из слоя 4 превратит строку-шаблон в render-функцию.
      instance.render = compile(Component.template)
    } else {
      instance.render = () => {
        console.warn('У компонента нет ни render, ни template (или компилятор не подключён)')
        return null
      }
    }
  }
}

// Вызвать render в контексте компонента и нормализовать результат в VNode.
function renderComponentRoot(instance) {
  const { render, ctx } = instance
  // this = ctx (для render(){ return h(..., this.count) }) и первым аргументом
  // тоже ctx (для стрелочного render(ctx){ ... }). Оба стиля работают.
  return normalizeVNode(render.call(ctx, ctx))
}

// ---- props ----------------------------------------------------------------
// Компонент объявляет, какие props он принимает (props: ['start'] или объект).
// Всё, что пришло в его props, но не объявлено, считается «сквозным» атрибутом
// (attrs) — например, class, повешенный на компонент снаружи.
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
  // props делаем реактивными: если родитель передаст новое значение, компонент,
  // читавший props в render/computed/watch, отреагирует.
  instance.props = reactive(props)
  instance.attrs = attrs
}

function updateProps(instance, nextVNode) {
  const raw = nextVNode.props || {}
  const options = instance.propsOptions
  const props = instance.props
  // Обновляем и добавляем.
  for (const key in raw) {
    if (key === 'key') continue
    if (options.has(key)) props[key] = raw[key]
    else instance.attrs[key] = raw[key]
  }
  // Удаляем объявленные props, которых больше не передают.
  for (const key in props) {
    if (!(key in raw)) delete props[key]
  }
}

// ---- emit -----------------------------------------------------------------
// Компонент «кричит наверх» о событии: emit('increment'). Родитель слушает его
// как onIncrement. Поэтому emit ищет в props компонента обработчик onXxx.
function emit(instance, event, ...args) {
  const handlerName = 'on' + event[0].toUpperCase() + event.slice(1)
  const handler = instance.vnode.props && instance.vnode.props[handlerName]
  if (handler) handler(...args)
}

// ---- slots ----------------------------------------------------------------
// Слот — «дырка», куда родитель кладёт свою разметку. Дети компонента и есть
// его слоты. Массив/строка → слот по умолчанию (default). Объект → именованные
// слоты { header: () => ..., footer: () => ... }.
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

// ---- публичный прокси контекста -------------------------------------------
// Определяет, что видно в render как ctx.<что-то>. Порядок поиска: сначала
// состояние из setup, потом props, потом служебные $-свойства.
const PublicInstanceHandlers = {
  get(instance, key) {
    const { setupState, props } = instance
    if (setupState && Object.prototype.hasOwnProperty.call(setupState, key)) {
      return setupState[key]
    }
    if (props && key in props) {
      return props[key]
    }
    // Служебные свойства, как $emit во Vue.
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
    return undefined
  },
  set(instance, key, value) {
    const { setupState } = instance
    if (setupState && Object.prototype.hasOwnProperty.call(setupState, key)) {
      setupState[key] = value // proxyRefs запишет в ref.value
      return true
    }
    return true
  },
  // has нужен для with(ctx) в скомпилированных шаблонах (слой 4). with спрашивает
  // «есть ли идентификатор в ctx?»: для состояния/props отвечаем «да» (берём из
  // ctx), для h/_s/Fragment — «нет» (они придут из внешней области генератора).
  has(instance, key) {
    const { setupState, props } = instance
    return (
      (setupState && key in setupState) ||
      (props && key in props) ||
      (typeof key === 'string' && key[0] === '$')
    )
  },
}

// Контекст приложения по умолчанию — на случай vnode без привязки к createApp
// (например, при прямом рендере компонента в тестах).
export const defaultAppContext = {
  provides: Object.create(null),
  components: Object.create(null),
  config: { globalProperties: {} },
}

export function createAppContext() {
  return {
    provides: Object.create(null),
    components: Object.create(null),
    config: { globalProperties: {} },
  }
}
