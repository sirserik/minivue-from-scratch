// Клиентская точка входа. Не создаёт DOM заново, а «оживляет» тот, что прислал
// сервер: hydrate связывает VNode с существующими узлами и навешивает события.
import { hydrate } from '../../packages/runtime-dom/index.js'
import { createVNode } from '../../packages/runtime-core/vnode.js'
import { App } from './app.js'

hydrate(createVNode(App), document.getElementById('app'))
console.log('[client] гидратация завершена — кнопки интерактивны')
