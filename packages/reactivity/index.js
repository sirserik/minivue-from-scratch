// ============================================================================
//  Публичный вход в пакет реактивности.
//  Отсюда остальные слои (компоненты, стор, роутер) берут всё, что им нужно.
//  Это точная копия «поверхности» настоящего @vue/reactivity, поэтому имена
//  совпадают: ref, reactive, computed, watch, effect и т.д.
// ============================================================================

export { effect, stop, ReactiveEffect, track, trigger } from './effect.js'
export { reactive, isReactive, toRaw, isObject } from './reactive.js'
export { ref, isRef, unref, toRef, toRefs, proxyRefs } from './ref.js'
export { computed } from './computed.js'
export { watch } from './watch.js'
