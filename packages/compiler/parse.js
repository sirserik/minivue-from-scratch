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
//
//  A parser has one extra duty besides building the tree: REFUSING bad input
//  loudly. A template typo (an unclosed tag, a stray "}}") should produce a
//  clear compile-time error pointing at the template — not a cryptic crash
//  later, deep inside the generated JavaScript.
// ============================================================================

// AST node types.
export const NodeTypes = {
  ELEMENT: 'Element', // <div>...</div>
  TEXT: 'Text', // plain text
  INTERPOLATION: 'Interpolation', // {{ expression }}
}

// All parse errors go through here so they share one recognizable shape and
// always quote the piece of the template where parsing stopped.
function parseError(context, message) {
  const near = context.source.slice(0, 40)
  throw new SyntaxError(
    `[minivue compiler] ${message} (near: ${near ? JSON.stringify(near) : 'end of template'})`,
  )
}

/**
 * Parse a template string into an AST — an array of top-level nodes.
 * @param {string} template - The template markup to parse.
 * @returns {Array} Array of AST nodes (see NodeTypes).
 */
export function parse(template) {
  const context = { source: template.trim() }
  const nodes = parseChildren(context)
  // parseChildren stops when it sees a closing tag. At the top level there is
  // no open element, so leftover input can only mean a stray "</...>".
  if (context.source.length > 0) {
    parseError(context, 'Unexpected closing tag — there is no matching open tag')
  }
  return nodes
}

// Parse a sequence of nodes until we hit a closing tag or the end.
function parseChildren(context) {
  const nodes = []
  while (!isEnd(context)) {
    // Remember how much input is left: every loop iteration MUST consume at
    // least one character, otherwise we would spin forever on the same spot.
    const lengthBefore = context.source.length

    const s = context.source
    let node = null
    if (s.startsWith('<!--')) {
      parseComment(context) // comments produce no output — just skip them
    } else if (s.startsWith('{{')) {
      node = parseInterpolation(context)
    } else if (s[0] === '<' && /[a-zA-Z]/.test(s[1])) {
      node = parseElement(context)
    } else {
      // Everything else is text — including a lone '<' that does not start a
      // tag (e.g. "5 < 10" or "i <3 vue").
      node = parseText(context)
    }
    if (node) nodes.push(node)

    // The progress guarantee. If a branch above ever consumes nothing, we fail
    // loudly instead of hanging the whole program in an infinite loop.
    if (context.source.length === lengthBefore) {
      parseError(context, 'Parser made no progress — cannot understand this input')
    }
  }
  return condenseWhitespace(nodes)
}

// Whitespace handling, the way Vue does it ("condense" mode). A template is
// usually indented for the HUMAN reading it — those newlines and indents are
// formatting, not content. But a single space between inline elements
// ("<b>a</b> <b>b</b>") IS content: dropping it would glue the words together.
// Rule: a whitespace-only text node that contains a newline came from code
// formatting → drop it; one without a newline is deliberate → keep one space.
function condenseWhitespace(nodes) {
  const out = []
  for (const node of nodes) {
    if (node.type === NodeTypes.TEXT && node.content.trim() === '') {
      if (node.content.includes('\n')) continue // formatting — drop
      out.push({ ...node, content: ' ' }) // deliberate space — keep as ' '
    } else {
      out.push(node)
    }
  }
  return out
}

// parseChildren stop condition: end of the string or start of a closing tag.
// (Whether the closing tag actually MATCHES the open element is checked by
// parseElement — mismatches are a compile error.)
function isEnd(context) {
  const s = context.source
  return s.length === 0 || s.startsWith('</')
}

// Chop n characters off the front of source.
function advanceBy(context, n) {
  context.source = context.source.slice(n)
}

// --- <!-- comments --> -------------------------------------------------------
// Comments carry no meaning for rendering, so we simply skip over them. What
// matters is recognizing them at all: without this branch "<!--" would fall
// into parseText, which stops at every '<' — and the parser would loop forever.
function parseComment(context) {
  const end = context.source.indexOf('-->')
  if (end === -1) {
    parseError(context, 'Comment is missing its closing "-->"')
  }
  advanceBy(context, end + 3) // '<!--' + text + '-->'
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

  // Consume the closing </tag>. Here the parser earns its keep as a validator:
  // a missing or mismatched closing tag would silently mis-nest the whole
  // rest of the template, so we stop and report it instead.
  const closeMatch = /^<\/([a-zA-Z][\w-]*)\s*>/.exec(context.source)
  if (!closeMatch) {
    parseError(context, `Element <${tag}> is missing its closing tag`)
  }
  if (closeMatch[1] !== tag) {
    parseError(context, `Closing tag </${closeMatch[1]}> does not match the open element <${tag}>`)
  }
  advanceBy(context, closeMatch[0].length)

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
    if (!nameMatch) {
      parseError(context, 'Unexpected character inside a tag — expected an attribute or ">"')
    }
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
        if (end === -1) {
          parseError(context, `Attribute "${name}" has an unterminated quoted value`)
        }
        value = context.source.slice(0, end)
        advanceBy(context, end + 1)
      } else {
        // Unquoted value.
        const m = /^[^\s>]+/.exec(context.source)
        value = m ? m[0] : ''
        advanceBy(context, value.length)
      }
    }
    // Attribute values may use HTML entities: title="Tom &amp; Jerry".
    props.push({ name, value: decodeEntities(value) })
  }
  return props
}

// --- {{ expression }} ------------------------------------------------------
function parseInterpolation(context) {
  advanceBy(context, 2) // '{{'
  const end = context.source.indexOf('}}')
  if (end === -1) {
    // Without this check the "expression" would be the entire rest of the
    // template, and new Function would later throw an incomprehensible
    // SyntaxError. Fail here, where we can still point at the template.
    parseError(context, 'Interpolation "{{" is missing its closing "}}"')
  }
  const content = context.source.slice(0, end).trim()
  advanceBy(context, end + 2) // expression + '}}'
  return { type: NodeTypes.INTERPOLATION, content }
}

// --- plain text ------------------------------------------------------------
function parseText(context) {
  const s = context.source
  // Text runs up to the nearest '{{' (interpolation) or the nearest '<' that
  // actually starts markup: a tag (<b), a closing tag (</b) or a comment (<!).
  // A '<' followed by anything else — "5 < 10" — is just part of the text.
  let end = s.length
  const brace = s.indexOf('{{')
  if (brace !== -1 && brace < end) end = brace
  let lt = s.indexOf('<')
  while (lt !== -1 && lt < end) {
    if (/[a-zA-Z/!]/.test(s[lt + 1] || '')) {
      end = lt
      break
    }
    lt = s.indexOf('<', lt + 1)
  }
  // Safety net: if we are called ON a markup character (should not happen),
  // consume at least one char so the parse loop always moves forward.
  if (end === 0) end = 1

  const content = s.slice(0, end)
  advanceBy(context, end)
  // Text may use HTML entities — &amp; must become '&' in the real output.
  return { type: NodeTypes.TEXT, content: decodeEntities(content) }
}

// --- HTML entities -----------------------------------------------------------
// In HTML you cannot write a bare '<' or '&' in text, so the markup uses
// escapes: &lt; &amp; and friends. The BROWSER decodes those when it parses
// HTML — but our templates never pass through the browser's parser (the
// renderer creates text nodes directly), so the compiler must decode them
// itself. We support the handful of named entities people actually use, plus
// the general numeric forms &#123; and &#x1F600;.
const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0', // non-breaking space
}

function decodeEntities(text) {
  if (!text.includes('&')) return text // fast path — most text has no entities
  return text.replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|([a-zA-Z]+));/g, (full, hex, dec, name) => {
    if (hex) return String.fromCodePoint(parseInt(hex, 16))
    if (dec) return String.fromCodePoint(parseInt(dec, 10))
    // Unknown named entity — leave it as written rather than guessing.
    return name in NAMED_ENTITIES ? NAMED_ENTITIES[name] : full
  })
}
