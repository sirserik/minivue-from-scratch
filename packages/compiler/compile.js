// ============================================================================
//  compile.js — из AST в render-функцию
// ----------------------------------------------------------------------------
//  Парсер (parse.js) дал нам дерево узлов. Теперь по нему надо сгенерировать код
//  render-функции — той самой, что возвращает h(...). Мы делаем это в два приёма:
//
//    1) transform — классифицируем «сырые» атрибуты в директивы (v-if, v-for,
//       :bind, @on) и раскладываем по удобным полям узла;
//    2) generate — обходим дерево и собираем СТРОКУ с кодом вида
//       "h('div', {...}, [...])", а затем превращаем её в настоящую функцию
//       через new Function.
//
//  Итоговая функция принимает ctx и через with(ctx) обращается к состоянию
//  компонента напрямую: {{ count }} становится h(...) с выражением count,
//  которое with достанет из ctx.
// ============================================================================

import { parse, NodeTypes } from './parse.js'
import { h, Fragment } from '../runtime-core/vnode.js'

// Публичная функция: строка-шаблон → готовая render-функция.
export function compile(template) {
  const ast = parse(template)
  const code = generate(ast)
  return createRenderFunction(code)
}

// Экспортируем и отдельные шаги — пригодятся в тестах и для показа кода в книге.
export function compileToString(template) {
  return generate(parse(template))
}

// --- превращение сгенерированной строки в функцию --------------------------
function createRenderFunction(code) {
  // Вспомогательные функции, доступные внутри сгенерированного кода:
  //   _s — привести значение к строке (для интерполяции),
  //   _l — отрисовать список (v-for),
  //   h, Fragment — из рантайма.
  const _s = (v) => (v == null ? '' : String(v))
  const _l = renderList

  // Функция-фабрика создаёт render со всеми помощниками в области видимости.
  // with(ctx) внутри позволяет писать в шаблоне count вместо ctx.count.
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'h',
    'Fragment',
    '_s',
    '_l',
    `return function render(ctx){ with(ctx){ return ${code} } }`,
  )
  return factory(h, Fragment, _s, _l)
}

// _l: отрисовать список для v-for. Поддерживает массивы, числа (1..n) и объекты.
function renderList(source, fn) {
  const result = []
  if (Array.isArray(source) || typeof source === 'string') {
    for (let i = 0; i < source.length; i++) result.push(fn(source[i], i))
  } else if (typeof source === 'number') {
    for (let i = 0; i < source; i++) result.push(fn(i + 1, i))
  } else if (source && typeof source === 'object') {
    const keys = Object.keys(source)
    keys.forEach((key, i) => result.push(fn(source[key], key, i)))
  }
  return result
}

// ===========================================================================
//  ГЕНЕРАЦИЯ КОДА
// ===========================================================================
function generate(ast) {
  const children = ast // parseChildren вернул массив узлов верхнего уровня
  if (children.length === 1) {
    // Один корневой узел — возвращаем его напрямую.
    return genNode(children[0])
  }
  // Несколько корней — заворачиваем во Fragment (тег-невидимка из слоя 2).
  return `h(Fragment, null, ${genChildren(children)})`
}

function genNode(node) {
  switch (node.type) {
    case NodeTypes.ELEMENT:
      return genElement(node)
    case NodeTypes.TEXT:
      // Текст — строковый литерал. JSON.stringify экранирует кавычки/переносы.
      return JSON.stringify(node.content)
    case NodeTypes.INTERPOLATION:
      // {{ expr }} → _s(expr): значение выражения, приведённое к строке.
      return `_s(${node.content})`
    default:
      return 'null'
  }
}

function genElement(node) {
  const directives = classify(node.props)

  // v-for оборачивает узел в _l(список, (item, index) => <тот же узел>).
  // Убираем сам v-for, чтобы не зациклиться, и генерируем внутренность.
  if (directives.for) {
    const { source, valueAlias, indexAlias } = parseForExpression(directives.for)
    const inner = genElementWithoutStructural(node, directives)
    const args = indexAlias ? `${valueAlias}, ${indexAlias}` : valueAlias
    return `_l(${source}, (${args}) => ${inner})`
  }

  // v-if генерируется на уровне списка детей (нужен доступ к соседним v-else),
  // поэтому здесь обрабатываем узел без структурных директив.
  return genElementWithoutStructural(node, directives)
}

// Сгенерировать h('tag', props, children) без учёта v-for/v-if.
function genElementWithoutStructural(node, directives) {
  const tag = JSON.stringify(node.tag)
  const props = genProps(directives)
  const children = genChildren(node.children)
  return `h(${tag}, ${props}, ${children})`
}

// --- атрибуты и обработчики → объект props ---------------------------------
function genProps(directives) {
  const entries = []

  for (const attr of directives.attrs) {
    // Статический атрибут: значение — строковый литерал.
    entries.push(`${JSON.stringify(attr.name)}: ${JSON.stringify(attr.value)}`)
  }
  for (const bind of directives.binds) {
    // :id="expr" — значение вычисляется. exp кладём как есть, with(ctx) достанет.
    entries.push(`${JSON.stringify(bind.arg)}: (${bind.exp})`)
  }
  for (const on of directives.ons) {
    // @click="handler" → onClick. Имя события с заглавной буквы.
    const key = 'on' + on.event[0].toUpperCase() + on.event.slice(1)
    entries.push(`${JSON.stringify(key)}: ${genHandler(on.exp)}`)
  }

  return entries.length ? `{ ${entries.join(', ')} }` : 'null'
}

// Обработчик события бывает двух видов:
//   @click="doThing"       — ссылка на метод, используем как есть;
//   @click="count++"       — инлайн-выражение, оборачиваем в $event => (...).
function genHandler(exp) {
  const isMethodPath = /^[A-Za-z_$][\w$.]*$/.test(exp.trim())
  return isMethodPath ? `(${exp})` : `$event => (${exp})`
}

// --- дети с учётом v-if / v-else -------------------------------------------
function genChildren(children) {
  if (!children || children.length === 0) return 'null'

  const pieces = []
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    const dirs = child.type === NodeTypes.ELEMENT ? classify(child.props) : null

    if (dirs && dirs.if != null) {
      // Собираем цепочку v-if / v-else-if / v-else в тернарный оператор.
      // genNode игнорирует сами директивы (classify отделяет их от атрибутов),
      // поэтому дополнительно «раздевать» узел не нужно.
      let code = `(${dirs.if}) ? ${genNode(child)}`
      let j = i + 1
      let hasElse = false
      while (j < children.length && children[j].type === NodeTypes.ELEMENT) {
        const nextDirs = classify(children[j].props)
        if (nextDirs.elseif != null) {
          code += ` : (${nextDirs.elseif}) ? ${genNode(children[j])}`
          j++
        } else if (nextDirs.else) {
          code += ` : ${genNode(children[j])}`
          hasElse = true
          j++
          break
        } else break
      }
      if (!hasElse) code += ' : null' // нет v-else — рисуем «ничего»
      pieces.push(code)
      i = j - 1 // перескакиваем обработанные ветки
    } else {
      pieces.push(genNode(child))
    }
  }

  // v-for возвращает массив — его надо «влить» в общий список через spread.
  const joined = pieces
    .map((p) => (p.startsWith('_l(') ? `...${p}` : p))
    .join(', ')
  return `[${joined}]`
}

// --- классификация «сырых» атрибутов в директивы ---------------------------
function classify(props = []) {
  const result = {
    attrs: [], // статические: class="x"
    binds: [], // :id / v-bind:id
    ons: [], // @click / v-on:click
    if: null,
    elseif: null,
    else: false,
    for: null,
  }
  for (const { name, value } of props) {
    if (name === 'v-if') result.if = value
    else if (name === 'v-else-if') result.elseif = value
    else if (name === 'v-else') result.else = true
    else if (name === 'v-for') result.for = value
    else if (name.startsWith(':')) result.binds.push({ arg: name.slice(1), exp: value })
    else if (name.startsWith('v-bind:'))
      result.binds.push({ arg: name.slice(7), exp: value })
    else if (name.startsWith('@')) result.ons.push({ event: name.slice(1), exp: value })
    else if (name.startsWith('v-on:')) result.ons.push({ event: name.slice(5), exp: value })
    else result.attrs.push({ name, value })
  }
  return result
}

// Разобрать выражение v-for: "item in list" или "(item, index) in list".
function parseForExpression(exp) {
  const inMatch = /^(.*?)\s+(?:in|of)\s+(.*)$/.exec(exp.trim())
  const source = inMatch[2].trim()
  let lhs = inMatch[1].trim()
  let valueAlias = lhs
  let indexAlias = null
  const parenMatch = /^\(\s*([^,]+)\s*,\s*([^,)]+)\s*\)$/.exec(lhs)
  if (parenMatch) {
    valueAlias = parenMatch[1].trim()
    indexAlias = parenMatch[2].trim()
  }
  return { source, valueAlias, indexAlias }
}
