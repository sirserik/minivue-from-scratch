// ============================================================================
//  parse.js — from a template string to a descriptive tree (AST)
// ----------------------------------------------------------------------------
//  A template is just text: "<div class='x'>{{ msg }}</div>". A computer does
//  not understand text structurally, so the compiler's first step is to parse
//  the string into a tree of objects (an AST, abstract syntax tree). Every tag,
//  chunk of text, and {{...}} interpolation becomes a node in the tree. Later
//  (in compile.js) a render function is generated from this tree.
//
//  We write a "recursive descent" parser: we walk the string left to right, and
//  for nested tags we call ourselves. The position within the input string is
//  kept in the `context` object, chopping the parsed pieces off the front.
// ============================================================================

// AST node types.
export const NodeTypes = {
  ELEMENT: 'Element', // <div>...</div>
  TEXT: 'Text', // plain text
  INTERPOLATION: 'Interpolation', // {{ expression }}
}

/**
 * Parse a template string into an AST — an array of top-level nodes.
 * @param {string} template - The template markup to parse.
 * @returns {Array} Array of AST nodes (see NodeTypes).
 */
export function parse(template) {
  const context = { source: template.trim() }
  return parseChildren(context)
}

// Parse a sequence of nodes until we hit a closing tag or the end.
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
  // Drop nodes of pure whitespace between tags (newlines in the markup) so we
  // don't spawn empty text nodes.
  return nodes.filter((n) => !(n.type === NodeTypes.TEXT && n.content.trim() === ''))
}

// parseChildren stop condition: end of the string or start of a closing tag.
function isEnd(context) {
  const s = context.source
  return s.length === 0 || s.startsWith('</')
}

// Chop n characters off the front of source.
function advanceBy(context, n) {
  context.source = context.source.slice(n)
}

// --- <element ...> ---------------------------------------------------------
function parseElement(context) {
  // Opening tag: <tag attr="...">
  const match = /^<([a-zA-Z][\w-]*)/.exec(context.source)
  const tag = match[1]
  advanceBy(context, match[0].length)

  const props = parseAttributes(context)

  // A self-closing tag <br/> — no children.
  let isSelfClosing = context.source.startsWith('/>')
  advanceBy(context, isSelfClosing ? 2 : 1) // consume '/>' or '>'

  if (isSelfClosing || isVoidTag(tag)) {
    return { type: NodeTypes.ELEMENT, tag, props, children: [] }
  }

  // Children — recursively, up to the closing tag.
  const children = parseChildren(context)

  // Consume the closing </tag>.
  const closeMatch = /^<\/([a-zA-Z][\w-]*)\s*>/.exec(context.source)
  if (closeMatch) advanceBy(context, closeMatch[0].length)

  return { type: NodeTypes.ELEMENT, tag, props, children }
}

// Tags that per HTML have no content and no closing tag.
function isVoidTag(tag) {
  return ['br', 'hr', 'img', 'input', 'meta', 'link'].includes(tag)
}

// --- attributes and directives ---------------------------------------------
// We return a "raw" list of { name, value }. Parsing directives (v-if, :bind,
// @on) is done by the transformer in compile.js — this keeps the parser simple.
function parseAttributes(context) {
  const props = []
  while (
    context.source.length > 0 &&
    !context.source.startsWith('>') &&
    !context.source.startsWith('/>')
  ) {
    // Skip whitespace between attributes.
    const ws = /^\s+/.exec(context.source)
    if (ws) advanceBy(context, ws[0].length)
    if (context.source.startsWith('>') || context.source.startsWith('/>')) break

    // Attribute name: letters, plus : @ - . [ ] for directives (@click, :id, v-if).
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
        // Unquoted value.
        const m = /^[^\s>]+/.exec(context.source)
        value = m ? m[0] : ''
        advanceBy(context, value.length)
      }
    }
    props.push({ name, value })
  }
  return props
}

// --- {{ expression }} ------------------------------------------------------
function parseInterpolation(context) {
  advanceBy(context, 2) // '{{'
  const end = context.source.indexOf('}}')
  const content = context.source.slice(0, end).trim()
  advanceBy(context, end + 2) // expression + '}}'
  return { type: NodeTypes.INTERPOLATION, content }
}

// --- plain text ------------------------------------------------------------
function parseText(context) {
  // Text runs up to the nearest '<' (tag) or '{{' (interpolation).
  let end = context.source.length
  for (const token of ['<', '{{']) {
    const i = context.source.indexOf(token)
    if (i !== -1 && i < end) end = i
  }
  const content = context.source.slice(0, end)
  advanceBy(context, end)
  return { type: NodeTypes.TEXT, content }
}
