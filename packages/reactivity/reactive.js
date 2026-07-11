// ============================================================================
//  reactive.js — превращаем обычный объект в реактивный
// ----------------------------------------------------------------------------
//  reactive(obj) возвращает Proxy — «обёртку» вокруг объекта. Proxy позволяет
//  перехватывать операции: чтение свойства (get) и запись (set). Мы вставляем
//  в эти перехватчики вызовы track() и trigger() из effect.js. Так объект сам,
//  без единой сторонней строчки в коде пользователя, начинает сообщать системе:
//  «меня прочитали» / «меня изменили».
// ============================================================================

import { track, trigger } from './effect.js'

// Запоминаем уже созданные Proxy, чтобы reactive(obj) дважды вернул ТОТ ЖЕ
// самый Proxy (иначе сравнения объектов ломались бы, и мы плодили бы обёртки).
const reactiveMap = new WeakMap()

// Служебные ключи-маркеры. Читая proxy[IS_REACTIVE], можно узнать, что перед
// нами уже реактивный объект, а через proxy[RAW] — достать исходный «сырой».
export const IS_REACTIVE = Symbol('isReactive')
export const RAW = Symbol('raw')

export function reactive(target) {
  // Оборачивать имеет смысл только объекты (в т.ч. массивы). Примитивы — нет:
  // для них есть ref (см. ref.js).
  if (!isObject(target)) return target

  // Если target уже наш Proxy — вернём как есть (чтение RAW у обычного объекта
  // даст undefined, у нашего Proxy — исходный объект).
  if (target[RAW]) return target

  // Уже оборачивали этот объект — отдаём существующий Proxy.
  const existing = reactiveMap.get(target)
  if (existing) return existing

  const proxy = new Proxy(target, {
    get(obj, key, receiver) {
      // Ответы на служебные маркеры (не отслеживаем их как данные).
      if (key === IS_REACTIVE) return true
      if (key === RAW) return obj

      // Reflect.get корректно работает с геттерами и наследованием, передавая
      // правильный this (receiver). Это надёжнее, чем obj[key].
      const result = Reflect.get(obj, key, receiver)

      // Сообщаем: «текущий эффект прочитал obj.key».
      track(obj, key)

      // Ленивая глубокая реактивность: если прочитали вложенный объект —
      // оборачиваем его в reactive прямо сейчас, при обращении. Не рекурсивно
      // заранее (это было бы дорого и сломало бы объекты, которые не должны
      // быть реактивными), а по мере необходимости.
      if (isObject(result)) {
        return reactive(result)
      }

      return result
    },

    set(obj, key, value, receiver) {
      const oldValue = obj[key]

      // Отслеживаем, было ли это свойство раньше — чтобы отличать добавление
      // нового ключа от изменения существующего (для массивов это важно).
      const hadKey = Array.isArray(obj)
        ? Number(key) < obj.length
        : Object.prototype.hasOwnProperty.call(obj, key)

      const result = Reflect.set(obj, key, value, receiver)

      // Запускаем эффекты только если значение действительно поменялось —
      // иначе присваивание того же самого зря будило бы весь UI.
      if (!hadKey) {
        // Новый ключ добавлен.
        trigger(obj, key)
      } else if (hasChanged(oldValue, value)) {
        // Существующий ключ получил новое значение.
        trigger(obj, key)
      }

      return result
    },

    deleteProperty(obj, key) {
      const had = Object.prototype.hasOwnProperty.call(obj, key)
      const result = Reflect.deleteProperty(obj, key)
      if (had && result) {
        trigger(obj, key)
      }
      return result
    },
  })

  reactiveMap.set(target, proxy)
  return proxy
}

// Проверка «это реактивный объект?» — через служебный маркер.
export function isReactive(value) {
  return !!(value && value[IS_REACTIVE])
}

// Достаём исходный, «сырой» объект из-под Proxy (например, чтобы отдать его
// куда-то, где реактивность не нужна).
export function toRaw(value) {
  return (value && value[RAW]) || value
}

// --- маленькие утилиты, которыми пользуется весь реактивный слой ------------

export function isObject(value) {
  return value !== null && typeof value === 'object'
}

// Корректное сравнение с учётом NaN: NaN !== NaN, но менять значение не нужно.
export function hasChanged(oldValue, newValue) {
  return !Object.is(oldValue, newValue)
}
