// ============================================================================
//  apiCreateApp.js — application creation
// ----------------------------------------------------------------------------
//  createApp(RootComponent).mount('#app') — the entry point of any Vue app.
//  app is a thin wrapper around render(): it holds the root component, an
//  app-wide context (for provide and plugins), and knows how to mount into a
//  container. The router and store from later layers plug in via app.use().
// ============================================================================

import { createVNode } from './vnode.js'
import { createAppContext } from './component.js'

/**
 * Factory: takes a platform-specific render function (the browser one from
 * runtime-dom) and returns a createApp that uses that render.
 * @param {(vnode: any, container: any) => void} render Platform render function.
 * @returns {(rootComponent: object, rootProps?: object|null) => object} The createApp function.
 */
export function createAppAPI(render) {
  /**
   * Create an application instance rooted at the given component.
   * @param {object} rootComponent The root component definition.
   * @param {object|null} [rootProps] Props passed to the root component.
   * @returns {object} The app instance (use/provide/component/directive/mount/unmount).
   */
  return function createApp(rootComponent, rootProps = null) {
    const context = createAppContext()
    let isMounted = false
    let rootContainer = null

    const app = {
      _context: context,
      _component: rootComponent,
      // config.globalProperties — where plugins (router, pinia) put $router,
      // $route, $pinia. A single object for the whole app.
      config: context.config,

      // Install a plugin. A plugin is an object with an install(app) method or
      // just a function. This is how router and pinia work: app.use(router).
      use(plugin, ...options) {
        if (plugin && typeof plugin.install === 'function') {
          plugin.install(app, ...options)
        } else if (typeof plugin === 'function') {
          plugin(app, ...options)
        }
        return app // so calls can be chained: app.use(a).use(b)
      },

      // Provide a value at the app level — any component in the tree can inject it.
      provide(key, value) {
        context.provides[key] = value
        return app
      },

      // Register a global component by name (simplified).
      component(name, comp) {
        if (!comp) return context.components[name]
        context.components[name] = comp
        return app
      },

      // Register a global directive (v-focus, etc.).
      directive(name, def) {
        if (!def) return context.directives[name]
        context.directives[name] = def
        return app
      },

      mount(containerOrSelector) {
        if (isMounted) return
        rootContainer =
          typeof containerOrSelector === 'string'
            ? document.querySelector(containerOrSelector)
            : containerOrSelector

        // Wrap the root component in a vnode and attach the app context to it —
        // from here it is inherited by the whole tree.
        const vnode = createVNode(rootComponent, rootProps)
        vnode.appContext = context

        render(vnode, rootContainer)
        isMounted = true
        return vnode.component // the root instance (handy for tests/debugging)
      },

      unmount() {
        if (isMounted) {
          render(null, rootContainer)
          isMounted = false
        }
      },
    }

    return app
  }
}
