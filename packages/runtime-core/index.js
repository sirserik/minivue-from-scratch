// Публичный вход ядра рантайма (без привязки к платформе).
// Браузерную «сборку» см. в packages/runtime-dom/index.js.
export { createRenderer } from './renderer.js'
export { h, createVNode, isVNode, normalizeVNode, Text, Fragment } from './vnode.js'
