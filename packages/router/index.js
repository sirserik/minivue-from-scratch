// ============================================================================
//  router — аналог Vue Router
// ----------------------------------------------------------------------------
//  Одностраничное приложение (SPA) не перезагружает страницу при переходах.
//  Вместо этого роутер смотрит на адрес, находит подходящий компонент и
//  показывает его в специальном месте — <RouterView>. Меняется адрес — меняется
//  компонент, страница не мигает. Всё держится на нашей же реактивности: текущий
//  маршрут — реактивный объект, а <RouterView> просто читает его в render.
// ============================================================================

import { reactive, inject, h } from '../runtime-core/index.js'

// ---------------------------------------------------------------------------
//  Матчер: превратить строку пути маршрута в проверку с извлечением параметров.
//  '/user/:id' → регэксп /^\/user\/([^/]+)$/ и список имён параметров ['id'].
// ---------------------------------------------------------------------------
function compileRoute(record) {
  const keys = []
  // Заменяем каждый :param на группу захвата, запоминая имя параметра.
  const pattern = record.path
    .replace(/\//g, '\\/')
    .replace(/:(\w+)/g, (_, name) => {
      keys.push(name)
      return '([^/]+)'
    })
  return { ...record, regex: new RegExp('^' + pattern + '$'), keys }
}

// ---------------------------------------------------------------------------
//  createRouter({ history, routes }) — собрать роутер.
// ---------------------------------------------------------------------------
export function createRouter(options) {
  const { history } = options
  const records = options.routes.map(compileRoute)
  const guards = [] // beforeEach-хуки

  // Текущий маршрут — реактивный объект. Компоненты, читающие его поля в render
  // (например, <RouterView> читает matched), автоматически перерисуются при
  // навигации.
  const currentRoute = reactive({
    path: '/',
    params: {},
    matched: [], // список подходящих записей (для вложенных маршрутов взяли бы >1)
  })

  // Найти запись маршрута под путь и вытащить параметры.
  function resolve(path) {
    // Отрезаем query/hash — упрощённо, ищем совпадение только по пути.
    const cleanPath = path.split('?')[0].split('#')[0] || '/'
    for (const record of records) {
      const match = record.regex.exec(cleanPath)
      if (match) {
        const params = {}
        record.keys.forEach((key, i) => (params[key] = decodeURIComponent(match[i + 1])))
        return { path: cleanPath, params, matched: [record] }
      }
    }
    // Ничего не подошло — пустой маршрут (RouterView покажет пусто).
    return { path: cleanPath, params: {}, matched: [] }
  }

  // Записать разрешённый маршрут в реактивный объект — это и дёргает перерисовку.
  function applyRoute(path) {
    const r = resolve(path)
    currentRoute.path = r.path
    currentRoute.params = r.params
    currentRoute.matched = r.matched
  }

  // Основная навигация: прогнать guard'ы, затем сменить адрес в history.
  function navigate(to, replace) {
    const targetPath = typeof to === 'string' ? to : to.path
    const toRoute = resolve(targetPath)
    const from = currentRoute

    // Навигационные хуки: могут отменить (false) или перенаправить (строка).
    for (const guard of guards) {
      const result = guard(toRoute, from)
      if (result === false) return // переход отменён
      if (typeof result === 'string') return navigate(result, replace) // редирект
    }

    history[replace ? 'replace' : 'push'](targetPath)
    // history.listen (см. ниже) вызовет applyRoute — не дублируем здесь.
  }

  const router = {
    currentRoute,
    push: (to) => navigate(to, false),
    replace: (to) => navigate(to, true),
    // Регистрация глобального навигационного хука.
    beforeEach: (guard) => guards.push(guard),
    resolve,

    // Подключение к приложению: app.use(router).
    install(app) {
      // Даём роутер и маршрут всем компонентам через inject.
      app.provide(ROUTER_KEY, router)
      app.provide(ROUTE_KEY, currentRoute)
      // Регистрируем встроенные компоненты (и в PascalCase, и в kebab-case).
      app.component('RouterView', RouterView)
      app.component('router-view', RouterView)
      app.component('RouterLink', RouterLink)
      app.component('router-link', RouterLink)
      // Удобные $router / $route (как во Vue).
      app.config.globalProperties.$router = router
      app.config.globalProperties.$route = currentRoute
    },
  }

  // Слушаем изменения адреса (в т.ч. кнопки браузера) и применяем маршрут.
  history.listen(applyRoute)
  // Инициализируем текущим адресом.
  applyRoute(history.location)

  return router
}

// Ключи для provide/inject — Symbol, чтобы не пересекаться с пользовательскими.
const ROUTER_KEY = Symbol('router')
const ROUTE_KEY = Symbol('route')

// Хуки для использования в setup().
export function useRouter() {
  return inject(ROUTER_KEY)
}
export function useRoute() {
  return inject(ROUTE_KEY)
}

// ---------------------------------------------------------------------------
//  <RouterView> — «дырка», куда роутер вставляет компонент текущего маршрута.
// ---------------------------------------------------------------------------
const RouterView = {
  name: 'RouterView',
  setup() {
    const route = inject(ROUTE_KEY)
    // Возвращаем render-функцию: она читает route.matched реактивно, поэтому
    // при навигации RouterView сам перерисуется с новым компонентом.
    return () => {
      const matched = route.matched[0]
      return matched ? h(matched.component) : null
    }
  },
}

// ---------------------------------------------------------------------------
//  <RouterLink to="/path"> — ссылка, которая переходит без перезагрузки.
// ---------------------------------------------------------------------------
const RouterLink = {
  name: 'RouterLink',
  props: ['to'],
  setup(props, { slots }) {
    const router = inject(ROUTER_KEY)
    return () =>
      h(
        'a',
        {
          href: props.to,
          onClick: (e) => {
            // Отменяем стандартный переход браузера и навигируем сами.
            if (e && e.preventDefault) e.preventDefault()
            router.push(props.to)
          },
        },
        slots.default ? slots.default() : [],
      )
  },
}

export { RouterView, RouterLink }
export {
  createWebHistory,
  createWebHashHistory,
  createMemoryHistory,
} from './history.js'
