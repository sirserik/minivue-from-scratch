// ============================================================================
//  watch.js — «следить за данными и на изменение вызывать функцию»
// ----------------------------------------------------------------------------
//  effect запускает функцию заново при изменениях. watch — надстройка над ним:
//  он даёт колбэк, куда приходят НОВОЕ и СТАРОЕ значения, и сам решает, когда
//  этот колбэк звать (через scheduler). Источником может быть:
//    - ref            → watch(count, (n, o) => ...)
//    - геттер-функция → watch(() => state.count, (n, o) => ...)
//    - reactive-объект→ watch(state, (n, o) => ...)  (следим глубоко)
// ============================================================================

import { ReactiveEffect } from './effect.js'
import { isRef } from './ref.js'
import { isReactive, isObject } from './reactive.js'

export function watch(source, callback, options = {}) {
  // 1. Приводим любой источник к единому виду — функции-геттеру, которая
  //    возвращает наблюдаемое значение И попутно «читает» все зависимости
  //    (чтобы эффект их отследил).
  let getter
  if (isRef(source)) {
    getter = () => source.value
  } else if (isReactive(source)) {
    // Для reactive-объекта следим глубоко: traverse обходит все вложенные
    // свойства, «трогая» их, чтобы эффект подписался на каждое.
    getter = () => traverse(source)
  } else if (typeof source === 'function') {
    getter = source
  } else {
    getter = () => source
  }

  let oldValue

  // 2. Планировщик — это и есть «реакция на изменение»: вычисляем новое
  //    значение (перезапуская эффект) и зовём пользовательский колбэк.
  const job = () => {
    const newValue = effect.run()
    callback(newValue, oldValue)
    oldValue = newValue
  }

  const effect = new ReactiveEffect(getter, job)

  // 3. immediate: true — вызвать колбэк сразу, не дожидаясь первого изменения.
  if (options.immediate) {
    job()
  } else {
    // Первый прогон только собирает зависимости и запоминает стартовое
    // значение — колбэк пока не зовём.
    oldValue = effect.run()
  }

  // Возвращаем функцию остановки наблюдения.
  return () => effect.stop()
}

// watchEffect(fn) — «упрощённый watch без источника». Сразу выполняет fn, а затем
// перезапускает её при изменении любых реактивных данных, которые она прочитала.
// В отличие от watch, не даёт старое/новое значение — просто «делай это, когда
// что-то из прочитанного изменится». Возвращает функцию остановки.
//
//   const stop = watchEffect(() => console.log('count =', count.value))
export function watchEffect(fn) {
  const effect = new ReactiveEffect(fn, () => effect.run())
  effect.run() // первый прогон: и выполняет, и собирает зависимости
  return () => effect.stop()
}

// Рекурсивно обходим объект, читая каждое свойство. Само чтение через
// reactive-Proxy вызовет track, поэтому эффект подпишется на все уровни.
// seen защищает от зацикливания на объектах со ссылками на самих себя.
function traverse(value, seen = new Set()) {
  if (!isObject(value) || seen.has(value)) return value
  seen.add(value)
  for (const key in value) {
    traverse(value[key], seen)
  }
  return value
}
