// Client entry point. It does not recreate the DOM but "brings to life" the one
// sent by the server: hydrate binds the VNode to the existing nodes and attaches events.
import { hydrate } from '../../packages/runtime-dom/index.js'
import { createVNode } from '../../packages/runtime-core/vnode.js'
import { App } from './app.js'

hydrate(createVNode(App), document.getElementById('app'))
console.log('[client] hydration complete — buttons are interactive')
