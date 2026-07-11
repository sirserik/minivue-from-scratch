// ============================================================================
//  vnode.js — «виртуальный узел», описание куска интерфейса как объект
// ----------------------------------------------------------------------------
//  Прямо создавать и менять элементы страницы (document.createElement и т.п.)
//  дорого и неудобно. Вместо этого мы описываем, КАКИМ интерфейс должен быть,
//  обычными объектами — они и называются virtual DOM. Потом рендерер (renderer.js)
//  сравнивает «как было» и «как должно стать» и вносит в реальную страницу только
//  необходимые точечные правки.
//
//  Один VNode — это узел дерева:
//    {
//      type,     // что это: строка-тег ('div'), Text, Fragment или компонент
//      props,    // атрибуты/обработчики: { id, class, onClick, ... }
//      children, // содержимое: строка, массив дочерних VNode или null
//      key,      // необязательный ключ для сопоставления в списках
//      el,       // ссылка на реальный узел страницы (заполняется при монтировании)
//    }
// ============================================================================

// Особые «типы» узлов, для которых нет тега. Symbol гарантирует уникальность —
// их не спутать со строковым тегом.
export const Text = Symbol('Text') // просто текстовый узел
export const Fragment = Symbol('Fragment') // группа узлов без обёртки-тега

// Создать VNode вручную. Обычно зовут h() (ниже), а createVNode — фундамент.
export function createVNode(type, props = null, children = null) {
  return {
    type,
    props: props || {},
    children,
    key: props && props.key != null ? props.key : null,
    el: null, // сюда renderer положит настоящий DOM-узел
  }
}

// ---------------------------------------------------------------------------
//  h(type, propsOrChildren, children) — удобная «человеческая» обёртка над
//  createVNode. Позволяет опускать props, если их нет:
//
//    h('div', 'привет')                       // тег + текст
//    h('div', { id: 'app' }, 'привет')        // тег + props + текст
//    h('ul', [ h('li', 'a'), h('li', 'b') ])  // тег + массив детей
//    h('div', { class: 'x' }, [ ...дети ])     // всё вместе
//
//  Имя h — от «hyperscript», исторического названия таких функций. Мы его
//  сохраняем, потому что так же называется функция во Vue и React.
// ---------------------------------------------------------------------------
export function h(type, propsOrChildren = null, children = null) {
  // Второй аргумент может быть либо props (объект), либо сразу children
  // (строка/массив/VNode). Разбираемся, что именно передали.
  if (arguments.length === 2) {
    if (isVNode(propsOrChildren)) {
      // h('div', someVNode) — единственный ребёнок-VNode
      return createVNode(type, null, [propsOrChildren])
    }
    if (typeof propsOrChildren === 'object' && !Array.isArray(propsOrChildren)) {
      // h('div', { props }) — это props без детей
      return createVNode(type, propsOrChildren, null)
    }
    // h('div', 'текст') или h('div', [дети]) — это children без props
    return createVNode(type, null, propsOrChildren)
  }

  // Полная форма h(type, props, children).
  return createVNode(type, propsOrChildren, children)
}

export function isVNode(value) {
  return value != null && typeof value === 'object' && 'type' in value && 'el' in value
}

// withDirectives(vnode, [[dir, value, arg, modifiers], ...]) — прицепить к vnode
// список кастомных директив. Рендерер потом вызовет их хуки (mounted/updated/
// unmounted). Компилятор генерирует именно такой вызов для v-focus, v-color и т.п.
export function withDirectives(vnode, directives) {
  vnode.dirs = directives.map(([dir, value, arg, modifiers]) => ({
    dir,
    value,
    oldValue: undefined,
    arg,
    modifiers: modifiers || {},
  }))
  return vnode
}

// Привести «сырое» дитя к VNode. Строки и числа заворачиваем в текстовый узел,
// чтобы рендерер работал с однородным деревом из одних только VNode.
export function normalizeVNode(child) {
  if (child == null || typeof child === 'boolean') {
    // null/undefined/false в разметке — это «ничего»; рисуем пустой текст.
    return createVNode(Text, null, '')
  }
  if (typeof child === 'string' || typeof child === 'number') {
    return createVNode(Text, null, String(child))
  }
  // Уже VNode — возвращаем как есть.
  return child
}
