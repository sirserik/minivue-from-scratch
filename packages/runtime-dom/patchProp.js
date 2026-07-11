// ============================================================================
//  patchProp.js — как выставить одно свойство на реальном элементе
// ----------------------------------------------------------------------------
//  Рендерер зовёт patchProp(el, key, prevValue, nextValue) на каждый атрибут.
//  «Свойства» бывают очень разными: обычные атрибуты (id, class), обработчики
//  событий (onClick), стили (style), булевы значения. Здесь мы решаем, как
//  именно применить каждое из них к DOM.
// ============================================================================

import { normalizeClass, normalizeStyle, camelToKebab } from '../shared.js'

export function patchProp(el, key, prevValue, nextValue) {
  if (key === 'class') {
    // class может прийти строкой, массивом или объектом — приводим к строке.
    el.className = normalizeClass(nextValue)
  } else if (key === 'style') {
    patchStyle(el, prevValue, nextValue)
  } else if (isEventKey(key)) {
    // onClick, onInput и т.п. — это обработчики событий.
    patchEvent(el, key, prevValue, nextValue)
  } else {
    patchAttr(el, key, nextValue)
  }
}

// Ключ-обработчик события: начинается с 'on' и дальше заглавная буква (onClick).
function isEventKey(key) {
  return /^on[A-Z]/.test(key)
}

// onClick → 'click'. Отрезаем 'on' и переводим в нижний регистр.
function eventName(key) {
  return key.slice(2).toLowerCase()
}

function patchEvent(el, key, prevValue, nextValue) {
  const name = eventName(key)
  // Снимаем старый обработчик, если он был, и вешаем новый.
  if (prevValue) el.removeEventListener(name, prevValue)
  if (nextValue) el.addEventListener(name, nextValue)
}

function patchStyle(el, prev, next) {
  const nextObj = normalizeStyle(next)
  const prevObj = normalizeStyle(prev)
  // Ставим/обновляем новые свойства стиля (kebab-case через setProperty).
  for (const name in nextObj) {
    el.style.setProperty(camelToKebab(name), nextObj[name])
  }
  // Убираем те, что были, но исчезли.
  for (const name in prevObj) {
    if (nextObj[name] == null) el.style.removeProperty(camelToKebab(name))
  }
}

function patchAttr(el, key, nextValue) {
  // Для value/checked у полей ввода пишем в СВОЙСТВО напрямую, иначе браузер не
  // обновит уже отрисованное поле (атрибут задаёт лишь начальное значение).
  if ((key === 'value' || key === 'checked') && key in el) {
    el[key] = key === 'checked' ? !!nextValue : nextValue == null ? '' : nextValue
    return
  }
  if (nextValue == null || nextValue === false) {
    // null / undefined / false — атрибут надо убрать.
    el.removeAttribute(key)
  } else {
    el.setAttribute(key, nextValue === true ? '' : nextValue)
  }
}
