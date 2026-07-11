// ============================================================================
//  parse.js — из строки-шаблона в дерево-описание (AST)
// ----------------------------------------------------------------------------
//  Шаблон — это просто текст: "<div class='x'>{{ msg }}</div>". Компьютер не
//  понимает текст структурно, поэтому первый шаг компилятора — разобрать строку
//  в дерево объектов (AST, abstract syntax tree). Каждый тег, кусок текста и
//  вставка {{...}} становится узлом дерева. Дальше (в compile.js) по этому дереву
//  сгенерируется render-функция.
//
//  Мы пишем парсер «рекурсивным спуском»: идём по строке слева направо, а на
//  вложенные теги вызываем сами себя. Позицию во входной строке храним в объекте
//  context, откусывая от начала разобранные куски.
// ============================================================================

// Типы узлов AST.
export const NodeTypes = {
  ELEMENT: 'Element', // <div>...</div>
  TEXT: 'Text', // просто текст
  INTERPOLATION: 'Interpolation', // {{ выражение }}
}

export function parse(template) {
  const context = { source: template.trim() }
  return parseChildren(context)
}

// Разобрать последовательность узлов, пока не упрёмся в закрывающий тег или конец.
function parseChildren(context) {
  const nodes = []
  while (!isEnd(context)) {
    const s = context.source
    let node
    if (s.startsWith('{{')) {
      node = parseInterpolation(context)
    } else if (s[0] === '<' && /[a-zA-Z]/.test(s[1])) {
      node = parseElement(context)
    } else {
      node = parseText(context)
    }
    nodes.push(node)
  }
  // Выкидываем узлы из чистого пробела между тегами (переносы строк в разметке),
  // чтобы не плодить пустые текстовые узлы.
  return nodes.filter((n) => !(n.type === NodeTypes.TEXT && n.content.trim() === ''))
}

// Условие остановки parseChildren: конец строки или начало закрывающего тега.
function isEnd(context) {
  const s = context.source
  return s.length === 0 || s.startsWith('</')
}

// Откусить n символов от начала source.
function advanceBy(context, n) {
  context.source = context.source.slice(n)
}

// --- <element ...> ---------------------------------------------------------
function parseElement(context) {
  // Открывающий тег: <tag attr="...">
  const match = /^<([a-zA-Z][\w-]*)/.exec(context.source)
  const tag = match[1]
  advanceBy(context, match[0].length)

  const props = parseAttributes(context)

  // Самозакрывающийся тег <br/> — детей нет.
  let isSelfClosing = context.source.startsWith('/>')
  advanceBy(context, isSelfClosing ? 2 : 1) // съедаем '/>' или '>'

  if (isSelfClosing || isVoidTag(tag)) {
    return { type: NodeTypes.ELEMENT, tag, props, children: [] }
  }

  // Дети — рекурсивно, до закрывающего тега.
  const children = parseChildren(context)

  // Съедаем закрывающий </tag>.
  const closeMatch = /^<\/([a-zA-Z][\w-]*)\s*>/.exec(context.source)
  if (closeMatch) advanceBy(context, closeMatch[0].length)

  return { type: NodeTypes.ELEMENT, tag, props, children }
}

// Теги, у которых по HTML не бывает содержимого и закрывающего тега.
function isVoidTag(tag) {
  return ['br', 'hr', 'img', 'input', 'meta', 'link'].includes(tag)
}

// --- атрибуты и директивы --------------------------------------------------
// Возвращаем «сырой» список { name, value }. Разбор директив (v-if, :bind, @on)
// делает уже трансформатор в compile.js — так парсер остаётся простым.
function parseAttributes(context) {
  const props = []
  while (
    context.source.length > 0 &&
    !context.source.startsWith('>') &&
    !context.source.startsWith('/>')
  ) {
    // Пропускаем пробелы между атрибутами.
    const ws = /^\s+/.exec(context.source)
    if (ws) advanceBy(context, ws[0].length)
    if (context.source.startsWith('>') || context.source.startsWith('/>')) break

    // Имя атрибута: буквы, а также : @ - . [ ] для директив (@click, :id, v-if).
    const nameMatch = /^[^\s=/>]+/.exec(context.source)
    const name = nameMatch[0]
    advanceBy(context, name.length)

    let value = ''
    const eq = /^\s*=\s*/.exec(context.source)
    if (eq) {
      advanceBy(context, eq[0].length)
      const quote = context.source[0]
      if (quote === '"' || quote === "'") {
        advanceBy(context, 1)
        const end = context.source.indexOf(quote)
        value = context.source.slice(0, end)
        advanceBy(context, end + 1)
      } else {
        // Значение без кавычек.
        const m = /^[^\s>]+/.exec(context.source)
        value = m ? m[0] : ''
        advanceBy(context, value.length)
      }
    }
    props.push({ name, value })
  }
  return props
}

// --- {{ выражение }} -------------------------------------------------------
function parseInterpolation(context) {
  advanceBy(context, 2) // '{{'
  const end = context.source.indexOf('}}')
  const content = context.source.slice(0, end).trim()
  advanceBy(context, end + 2) // выражение + '}}'
  return { type: NodeTypes.INTERPOLATION, content }
}

// --- обычный текст ---------------------------------------------------------
function parseText(context) {
  // Текст идёт до ближайшего '<' (тег) или '{{' (вставка).
  let end = context.source.length
  for (const token of ['<', '{{']) {
    const i = context.source.indexOf(token)
    if (i !== -1 && i < end) end = i
  }
  const content = context.source.slice(0, end)
  advanceBy(context, end)
  return { type: NodeTypes.TEXT, content }
}
