// ============================================================================
//  nodeOps.js — operations on real browser nodes
// ----------------------------------------------------------------------------
//  The renderer (renderer.js) knows nothing about the DOM itself. Every
//  concrete action — "create an element", "insert", "remove" — it takes from
//  here. Swap this file for another one (for example, a made-up tree) and the
//  same renderer will run in a different environment — which we rely on in both
//  tests and on the server (SSR).
// ============================================================================

/**
 * Browser DOM node operations passed to the platform-agnostic renderer.
 * @type {object}
 */
export const nodeOps = {
  // Create an element from a tag name: 'div' → <div>.
  createElement(tag) {
    return document.createElement(tag)
  },

  // Create a text node.
  createText(text) {
    return document.createTextNode(text)
  },

  // Replace the text of a text node.
  setText(node, text) {
    node.nodeValue = text
  },

  // Set the element's text content (wipes existing children).
  setElementText(el, text) {
    el.textContent = text
  },

  // Insert child into parent before anchor. When anchor === null,
  // insertBefore(child, null) behaves as "append to the end". Handy: a single
  // operation covers both inserting in the middle and at the end.
  insert(child, parent, anchor = null) {
    parent.insertBefore(child, anchor)
  },

  // Remove a node from its parent.
  remove(child) {
    const parent = child.parentNode
    if (parent) parent.removeChild(child)
  },

  // The next sibling node — needed as an anchor when moving nodes.
  nextSibling(node) {
    return node.nextSibling
  },

  parentNode(node) {
    return node.parentNode
  },

  // Find an element by selector — needed by Teleport for a string to="#modals".
  querySelector(selector) {
    return document.querySelector(selector)
  },
}
