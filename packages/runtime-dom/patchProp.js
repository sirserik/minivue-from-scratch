// ============================================================================
//  patchProp.js — как выставить одно свойство на реальном элементе
// ----------------------------------------------------------------------------
//  Рендерер зовёт patchProp(el, key, prevValue, nextValue) на каждый атрибут.
//  «Свойства» бывают очень разными: обычные атрибуты (id, class), обработчики
//  событий (onClick), стили (style), булевы значения. Здесь мы решаем, как
//  именно применить каждое из них к DOM.
// ============================================================================

export function patchProp(el, key, prevValue, nextValue) {
  if (key === 'class') {
    // class удобнее ставить через .className целиком.
    el.className = nextValue == null ? '' : nextValue
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
  next = next || {}
  // Ставим/обновляем новые свойства стиля.
  for (const name in next) {
    el.style[name] = next[name]
  }
  // Убираем те, что были, но исчезли.
  if (prev) {
    for (const name in prev) {
      if (next[name] == null) el.style[name] = ''
    }
  }
}

function patchAttr(el, key, nextValue) {
  if (nextValue == null || nextValue === false) {
    // null / undefined / false — атрибут надо убрать.
    el.removeAttribute(key)
  } else {
    // Для value/checked у полей ввода корректнее писать в свойство напрямую,
    // иначе браузер не обновит уже отрисованное поле.
    if (key === 'value' && 'value' in el) {
      el.value = nextValue
    } else {
      el.setAttribute(key, nextValue === true ? '' : nextValue)
    }
  }
}
