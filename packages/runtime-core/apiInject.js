// ============================================================================
//  apiInject.js — provide / inject
// ----------------------------------------------------------------------------
//  Обычно данные передают сверху вниз через props: родитель → ребёнок → внук.
//  Если внуку глубоко внизу нужно что-то от далёкого предка, тащить это через
//  все промежуточные компоненты («бурение пропсов») мучительно. provide/inject
//  решают это: предок provide('ключ', значение), любой потомок inject('ключ')
//  получает его напрямую, минуя промежуточные слои.
//
//  Хитрость реализации — в наследовании через прототип. У каждого компонента
//  объект provides наследует provides родителя (Object.create). Поэтому чтение
//  ключа само поднимается по цепочке предков, пока не найдёт значение.
// ============================================================================

import { getCurrentInstance } from './component.js'

export function provide(key, value) {
  const instance = getCurrentInstance()
  if (!instance) {
    console.warn('provide() можно вызывать только внутри setup()')
    return
  }

  let provides = instance.provides
  // Изначально instance.provides ССЫЛАЕТСЯ на provides родителя (тот же объект).
  // Когда компонент впервые сам что-то provide'ит, мы создаём ему собственный
  // объект, наследующий родительский. Так свои ключи не пачкают предка, но
  // унаследованные по-прежнему видны.
  const parentProvides = instance.parent
    ? instance.parent.provides
    : instance.appContext.provides
  if (provides === parentProvides) {
    provides = instance.provides = Object.create(parentProvides)
  }

  provides[key] = value
}

export function inject(key, defaultValue) {
  const instance = getCurrentInstance()
  if (!instance) {
    console.warn('inject() можно вызывать только внутри setup()')
    return defaultValue
  }

  // Ищем среди того, что дали предки (у родителя — вся цепочка через прототип),
  // либо на уровне приложения (app.provide).
  const provides = instance.parent
    ? instance.parent.provides
    : instance.appContext.provides

  if (key in provides) {
    return provides[key]
  }
  return defaultValue
}
