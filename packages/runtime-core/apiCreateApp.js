// ============================================================================
//  apiCreateApp.js — создание приложения
// ----------------------------------------------------------------------------
//  createApp(RootComponent).mount('#app') — точка входа любого Vue-приложения.
//  app — это тонкая обёртка вокруг render(): она хранит корневой компонент,
//  общий на приложение контекст (для provide и плагинов) и умеет смонтироваться
//  в контейнер. Роутер и стор из следующих слоёв подключаются через app.use().
// ============================================================================

import { createVNode } from './vnode.js'
import { createAppContext } from './component.js'

// Фабрика: получает функцию render конкретной платформы (браузерную из
// runtime-dom) и возвращает createApp, умеющий этой render пользоваться.
export function createAppAPI(render) {
  return function createApp(rootComponent, rootProps = null) {
    const context = createAppContext()
    let isMounted = false
    let rootContainer = null

    const app = {
      _context: context,
      _component: rootComponent,
      // config с globalProperties — сюда плагины (router, pinia) кладут $router,
      // $route, $pinia. Один объект на всё приложение.
      config: context.config,

      // Подключить плагин. Плагин — объект с методом install(app) или просто
      // функция. Так работают router и pinia: app.use(router).
      use(plugin, ...options) {
        if (plugin && typeof plugin.install === 'function') {
          plugin.install(app, ...options)
        } else if (typeof plugin === 'function') {
          plugin(app, ...options)
        }
        return app // чтобы вызовы можно было сцеплять: app.use(a).use(b)
      },

      // Дать значение на уровне всего приложения — его сможет inject любой
      // компонент дерева.
      provide(key, value) {
        context.provides[key] = value
        return app
      },

      // Зарегистрировать глобальный компонент по имени (упрощённо).
      component(name, comp) {
        if (!comp) return context.components[name]
        context.components[name] = comp
        return app
      },

      // Зарегистрировать глобальную директиву (v-focus и т.п.).
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

        // Оборачиваем корневой компонент в vnode и цепляем к нему контекст
        // приложения — дальше он унаследуется всем деревом.
        const vnode = createVNode(rootComponent, rootProps)
        vnode.appContext = context

        render(vnode, rootContainer)
        isMounted = true
        return vnode.component // инстанс корня (пригодится для тестов/отладки)
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
