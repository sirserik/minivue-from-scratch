// ============================================================================
//  apiLifecycle.js — хуки жизненного цикла компонента
// ----------------------------------------------------------------------------
//  Компонент проходит стадии: создаётся → монтируется в DOM → обновляется при
//  изменениях → размонтируется. На каждую стадию можно повесить свой код —
//  например, «когда смонтировался, запроси данные с сервера». Эти функции и есть
//  хуки. Внутри setup() пишут:  onMounted(() => { ... }).
//
//  Хук просто добавляет вашу функцию в список на нужной стадии у ТЕКУЩЕГО
//  компонента (currentInstance). Позже, дойдя до этой стадии, рендерер вызовет
//  все функции из списка.
// ============================================================================

import { getCurrentInstance } from './component.js'

// Каждой стадии — короткий ключ, под которым в инстансе хранится массив хуков.
// bm = beforeMount, m = mounted, bu = beforeUpdate, u = updated,
// bum = beforeUnmount, um = unmounted.
function createHook(lifecycle) {
  return (hook) => {
    const instance = getCurrentInstance()
    if (!instance) {
      // Хук вызвали вне setup() — вешать не на кого.
      console.warn(`Хук ${lifecycle} можно вызывать только внутри setup()`)
      return
    }
    const list = instance[lifecycle] || (instance[lifecycle] = [])
    list.push(hook)
  }
}

export const onBeforeMount = createHook('bm')
export const onMounted = createHook('m')
export const onBeforeUpdate = createHook('bu')
export const onUpdated = createHook('u')
export const onBeforeUnmount = createHook('bum')
export const onUnmounted = createHook('um')

// Вызвать все хуки из списка (список может быть undefined — тогда ничего).
export function invokeHooks(hooks) {
  if (!hooks) return
  for (const hook of hooks) hook()
}
