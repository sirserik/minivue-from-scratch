// ============================================================================
//  ref.js — реактивная обёртка для одного значения
// ----------------------------------------------------------------------------
//  Proxy умеет отслеживать только СВОЙСТВА объекта. А как сделать реактивным
//  простое число или строку? Никак — у примитива нет свойств, которые можно
//  перехватить. Решение: положить значение внутрь объекта в свойство .value и
//  отслеживать чтение/запись именно этого .value.
//
//  Поэтому у ref всегда обращаются через .value:
//    const count = ref(0)
//    count.value++        // запись → trigger
//    console.log(count.value)  // чтение → track
// ============================================================================

import { trackEffects, triggerEffects, activeEffect } from './effect.js'
import { reactive, isObject, hasChanged, toRaw } from './reactive.js'

class RefImpl {
  constructor(value) {
    // Если внутрь ref положили объект — оборачиваем его в reactive, чтобы
    // вложенные свойства тоже были реактивными. Примитивы храним как есть.
    this._value = convert(value)
    this._rawValue = value // исходное значение для сравнения при записи
    // Собственный набор эффектов этого ref (аналог dep из targetMap, но ref
    // хранит его прямо в себе — у него всего одно «свойство» value).
    this.dep = new Set()
    this.__isRef = true
  }

  get value() {
    // Чтение .value — момент, когда надо связать активный эффект с этим ref.
    if (activeEffect) trackEffects(this.dep)
    return this._value
  }

  set value(newValue) {
    // Сравниваем с «сырым» старым значением (без reactive-обёртки), иначе
    // сравнение объекта с его Proxy всегда давало бы «изменилось».
    if (hasChanged(toRaw(newValue), this._rawValue)) {
      this._rawValue = toRaw(newValue)
      this._value = convert(newValue)
      // Значение поменялось — будим все эффекты, читавшие этот ref.
      triggerEffects(this.dep)
    }
  }
}

function convert(value) {
  return isObject(value) ? reactive(value) : value
}

export function ref(value) {
  // Уже ref — не оборачиваем повторно.
  if (isRef(value)) return value
  return new RefImpl(value)
}

export function isRef(value) {
  return !!(value && value.__isRef === true)
}

// unref(x): если x — ref, вернуть x.value, иначе сам x. Удобно, когда значение
// может прийти и как ref, и как обычное.
export function unref(value) {
  return isRef(value) ? value.value : value
}

// ---------------------------------------------------------------------------
//  toRef / toRefs — «мостик» между reactive-объектом и ref.
//  Проблема: если из reactive-объекта достать свойство обычной деструктуризацией
//  (const { count } = state), связь с реактивностью теряется — count станет
//  просто числом. toRef создаёт ref, который читает/пишет прямо в исходный
//  объект, сохраняя реактивную связь.
// ---------------------------------------------------------------------------
class ObjectRefImpl {
  constructor(object, key) {
    this._object = object
    this._key = key
    this.__isRef = true
  }
  get value() {
    // Чтение идёт через reactive-объект, поэтому track произойдёт сам собой.
    return this._object[this._key]
  }
  set value(newValue) {
    this._object[this._key] = newValue
  }
}

export function toRef(object, key) {
  return new ObjectRefImpl(object, key)
}

export function toRefs(object) {
  const result = Array.isArray(object) ? new Array(object.length) : {}
  for (const key in object) {
    result[key] = toRef(object, key)
  }
  return result
}

// ---------------------------------------------------------------------------
//  proxyRefs — «автоматическая распаковка .value».
//  Внутри шаблонов Vue пишут {{ count }}, а не {{ count.value }}. Этого удобства
//  добивается proxyRefs: он оборачивает объект так, что при чтении свойства-ref
//  автоматически возвращается .value, а при записи — присваивается в .value.
//  Именно это позже применит слой компонентов к результату setup().
// ---------------------------------------------------------------------------
export function proxyRefs(objectWithRefs) {
  return new Proxy(objectWithRefs, {
    get(target, key, receiver) {
      // Читаем свойство и, если это ref, сразу разворачиваем в значение.
      return unref(Reflect.get(target, key, receiver))
    },
    set(target, key, value, receiver) {
      const oldValue = target[key]
      // Если на месте лежит ref, а присваивают не-ref — пишем в его .value,
      // сохраняя реактивность. Иначе — обычная запись.
      if (isRef(oldValue) && !isRef(value)) {
        oldValue.value = value
        return true
      }
      return Reflect.set(target, key, value, receiver)
    },
  })
}
