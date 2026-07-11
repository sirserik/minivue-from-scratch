// Фейковый «DOM» для тестов рендерера. Реализует тот же набор операций, что и
// браузерный nodeOps/patchProp, но строит обычное JS-дерево в памяти. Так мы
// проверяем алгоритм diff без браузера — и заодно доказываем, что рендерер
// действительно платформо-независим.

// Узлы — простые объекты. type: 'element' | 'text'.
function createElement(tag) {
  return { type: 'element', tag, props: {}, events: {}, children: [], parent: null }
}
function createText(text) {
  return { type: 'text', text: String(text), parent: null }
}
function setText(node, text) {
  node.text = String(text)
}
function setElementText(el, text) {
  // Аналог textContent: заменяет всё содержимое одним текстом.
  el.children = text === '' ? [] : [{ type: 'text', text: String(text), parent: el }]
}
function detach(node) {
  const p = node.parent
  if (p) {
    const i = p.children.indexOf(node)
    if (i !== -1) p.children.splice(i, 1)
  }
  node.parent = null
}
function insert(child, parent, anchor = null) {
  // Поддержка перемещения: если узел уже где-то был, сначала вынимаем.
  detach(child)
  child.parent = parent
  if (anchor == null) {
    parent.children.push(child)
  } else {
    const i = parent.children.indexOf(anchor)
    parent.children.splice(i === -1 ? parent.children.length : i, 0, child)
  }
}
function remove(child) {
  detach(child)
}
function patchProp(el, key, prev, next) {
  if (/^on[A-Z]/.test(key)) {
    // Обработчики складываем отдельно, чтобы в тесте их вызывать вручную.
    const name = key.slice(2).toLowerCase()
    if (next) el.events[name] = next
    else delete el.events[name]
    return
  }
  if (next == null || next === false) delete el.props[key]
  else el.props[key] = next
}

export const testOptions = {
  createElement,
  createText,
  setText,
  setElementText,
  insert,
  remove,
  patchProp,
  parentNode: (n) => n.parent,
  nextSibling: (n) => {
    const p = n.parent
    if (!p) return null
    return p.children[p.children.indexOf(n) + 1] || null
  },
}

// Корневой контейнер для рендера.
export function createRoot() {
  return { type: 'element', tag: 'root', props: {}, events: {}, children: [], parent: null }
}

// Сериализация дерева в HTML-подобную строку — для наглядных проверок.
export function serialize(node) {
  if (node.type === 'text') return node.text
  const attrs = Object.keys(node.props)
    .sort()
    .map((k) => ` ${k}="${node.props[k]}"`)
    .join('')
  const inner = node.children.map(serialize).join('')
  if (node.tag === 'root') return inner
  return `<${node.tag}${attrs}>${inner}</${node.tag}>`
}

// Найти первый узел, у которого props.id === id (для проверки идентичности).
export function findById(node, id) {
  if (node.type === 'element' && node.props.id === id) return node
  for (const c of node.children || []) {
    const found = findById(c, id)
    if (found) return found
  }
  return null
}
