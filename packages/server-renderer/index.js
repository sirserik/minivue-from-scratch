// ============================================================================
//  server-renderer — рендеринг в HTML-строку на сервере (SSR)
// ----------------------------------------------------------------------------
//  До сих пор мы рисовали в DOM браузера. Но тот же VNode-дерево можно превратить
//  не в узлы, а в текст — готовую HTML-строку. Сервер отдаёт её сразу, и
//  пользователь видит содержимое мгновенно, ещё до загрузки JavaScript. Это и есть
//  SSR (server-side rendering): быстрый первый экран и индексируемость поисковиками.
//
//  Здесь нет ни DOM, ни реактивного эффекта — только обход дерева и склейка строк.
//  «Оживление» этой строки на клиенте (гидратация) живёт в рендерере (слой 7),
//  функция hydrate.
// ============================================================================

import { Text, Fragment, createVNode, normalizeVNode } from '../runtime-core/vnode.js'
import { createSSRComponent, createAppContext } from '../runtime-core/component.js'
import { normalizeClass, styleToString } from '../shared.js'

// Теги без содержимого и закрывающего тега.
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link'])

// ---------------------------------------------------------------------------
//  renderToString(vnode) — превратить VNode-дерево в HTML-строку.
// ---------------------------------------------------------------------------
export function renderToString(vnode) {
  return renderVNode(normalizeVNode(vnode), null)
}

function renderVNode(vnode, parentComponent) {
  vnode = normalizeVNode(vnode)
  const { type } = vnode

  if (type === Text) {
    return escapeHtml(vnode.children)
  }
  if (type === Fragment) {
    return renderChildren(vnode.children, parentComponent)
  }
  if (typeof type === 'string') {
    return renderElement(vnode, parentComponent)
  }
  if (typeof type === 'object' || typeof type === 'function') {
    // Компонент: на сервере создаём инстанс, выполняем setup, получаем поддерево
    // и рекурсивно его сериализуем.
    const { instance, subTree } = createSSRComponent(vnode, parentComponent)
    return renderVNode(subTree, instance)
  }
  return ''
}

function renderElement(vnode, parentComponent) {
  const { type: tag, props, children } = vnode
  const open = `<${tag}${renderAttrs(props)}>`
  if (VOID_TAGS.has(tag)) return open // <input ...> без закрытия
  return open + renderChildren(children, parentComponent) + `</${tag}>`
}

function renderChildren(children, parentComponent) {
  if (children == null) return ''
  if (typeof children === 'string' || typeof children === 'number') {
    return escapeHtml(children)
  }
  if (Array.isArray(children)) {
    return children.map((c) => renderVNode(c, parentComponent)).join('')
  }
  return ''
}

// Сериализация атрибутов. События (onClick) в HTML не выводим — они навесятся
// на клиенте при гидратации. class/style/булевы обрабатываем особо.
function renderAttrs(props) {
  let out = ''
  for (const key in props) {
    if (key === 'key') continue
    if (/^on[A-Z]/.test(key)) continue // обработчики событий — только на клиенте
    const value = props[key]
    if (value == null || value === false) continue

    if (key === 'class') {
      const cls = normalizeClass(value)
      if (cls) out += ` class="${escapeAttr(cls)}"`
    } else if (key === 'style') {
      const style = styleToString(value)
      if (style) out += ` style="${escapeAttr(style)}"`
    } else if (value === true) {
      out += ` ${key}` // булев атрибут: <input disabled>
    } else {
      out += ` ${key}="${escapeAttr(String(value))}"`
    }
  }
  return out
}

// Экранирование, чтобы данные пользователя не ломали разметку и не давали XSS.
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

// ---------------------------------------------------------------------------
//  createSSRApp — как createApp, но вместо mount отдаёт HTML-строку. Плагины
//  (router, pinia) подключаются так же через use().
// ---------------------------------------------------------------------------
export function createSSRApp(rootComponent, rootProps = null) {
  const context = createAppContext()

  const app = {
    _context: context,
    use(plugin, ...options) {
      if (plugin && typeof plugin.install === 'function') plugin.install(app, ...options)
      else if (typeof plugin === 'function') plugin(app, ...options)
      return app
    },
    provide(key, value) {
      context.provides[key] = value
      return app
    },
    component(name, comp) {
      context.components[name] = comp
      return app
    },
    renderToString() {
      const vnode = createVNode(rootComponent, rootProps)
      vnode.appContext = context
      return renderVNode(vnode, null)
    },
  }
  return app
}
