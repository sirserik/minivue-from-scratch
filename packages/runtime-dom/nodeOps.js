// ============================================================================
//  nodeOps.js — операции над реальными узлами браузера
// ----------------------------------------------------------------------------
//  Рендерер (renderer.js) сам ничего не знает про DOM. Все конкретные действия
//  «создай элемент», «вставь», «удали» он берёт отсюда. Заменив этот файл на
//  другой (например, на выдуманное дерево), тот же рендерер заработает в другой
//  среде — этим мы воспользуемся и в тестах, и на сервере (SSR).
// ============================================================================

export const nodeOps = {
  // Создать элемент по имени тега: 'div' → <div>.
  createElement(tag) {
    return document.createElement(tag)
  },

  // Создать текстовый узел.
  createText(text) {
    return document.createTextNode(text)
  },

  // Заменить текст в текстовом узле.
  setText(node, text) {
    node.nodeValue = text
  },

  // Задать текстовое содержимое элемента (стирает прежних детей).
  setElementText(el, text) {
    el.textContent = text
  },

  // Вставить child внутрь parent перед anchor. Если anchor === null —
  // insertBefore(child, null) работает как «добавить в конец». Удобно: одна
  // операция и для вставки в середину, и в конец.
  insert(child, parent, anchor = null) {
    parent.insertBefore(child, anchor)
  },

  // Удалить узел из его родителя.
  remove(child) {
    const parent = child.parentNode
    if (parent) parent.removeChild(child)
  },

  // Соседний справа узел — нужен как якорь при перемещениях.
  nextSibling(node) {
    return node.nextSibling
  },

  parentNode(node) {
    return node.parentNode
  },

  // Найти элемент по селектору — нужно Teleport'у для строкового to="#modals".
  querySelector(selector) {
    return document.querySelector(selector)
  },
}
