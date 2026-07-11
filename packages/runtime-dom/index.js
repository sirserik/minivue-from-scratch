// ============================================================================
//  runtime-dom — «сборка» рендерера под браузер.
//  Соединяем платформо-независимый renderer из runtime-core с браузерными
//  операциями nodeOps и patchProp. Наружу отдаём готовые render() и h().
// ============================================================================

import { createRenderer } from '../runtime-core/renderer.js'
import { nodeOps } from './nodeOps.js'
import { patchProp } from './patchProp.js'

// Собираем набор операций: узлы + один особый ключ patchProp.
const rendererOptions = { ...nodeOps, patchProp }

// Единственный экземпляр рендерера для браузера.
const renderer = createRenderer(rendererOptions)

// render(vnode, container) — показать VNode внутри реального элемента.
export const render = renderer.render

// Отдаём и «внутренности» — они понадобятся слою компонентов (createApp).
export const __renderer = renderer

// Реэкспорт удобств из ядра, чтобы пользователю хватало одного импорта.
export { h, createVNode, Text, Fragment } from '../runtime-core/vnode.js'
