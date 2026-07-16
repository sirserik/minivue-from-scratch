# Встроенные компоненты

У Vue есть несколько «системных» компонентов, которые ведут себя не как обычные:
`Teleport` рисует детей в другом месте страницы, `KeepAlive` сохраняет неактивные
компоненты живыми, а `defineAsyncComponent` подгружает код по требованию. Они особые
— рендерер и система компонентов узнают их по меткам и обрабатывают иначе.

Код главы: `packages/runtime-core/builtins.js` и правки в `renderer.js` и
`component.js`. Тесты — `test/builtins.test.mjs`, демо — `playground/11-builtins.html`.

## Teleport: рисуем в другом месте

Модалка логически принадлежит компоненту, который её открыл, но физически должна
быть в конце `<body>` — иначе её обрежет `overflow: hidden` родителя или задавит
чужой `z-index`. `Teleport` разрывает эту связь: в разметке дети внутри компонента,
а в DOM — в указанном контейнере.

```html
<Teleport to="#modals">
  <div class="modal">...</div>
</Teleport>
```

Сам компонент — просто метка `{ __isTeleport: true }`. Вся работа — в рендерере,
который, увидев эту метку, направляет детей не в текущий контейнер, а в целевой:

```js
function processTeleport(n1, n2, container, anchor) {
  if (n1 == null) {
    n2.el = hostCreateText('')           // пустой якорь на исходном месте
    hostInsert(n2.el, container, anchor)
    const target = (n2.target = resolveTeleportTarget(n2.props))
    if (target && Array.isArray(n2.children)) mountChildren(n2.children, target, null)
  } else {
    n2.el = n1.el
    const prevTarget = n1.target
    const nextTarget = resolveTeleportTarget(n2.props)
    if (prevTarget) {
      n2.target = prevTarget
      patchChildren(n1, n2, prevTarget, null) // сначала diff в СТАРОМ target
      if (nextTarget && nextTarget !== prevTarget) {
        n2.target = nextTarget
        for (const child of n2.children) move(child, nextTarget, null) // `to` сменился
      }
    }
    // … target нашёлся только сейчас → монтируем детей с нуля
  }
}
```

Пустой текстовый якорь остаётся на исходном месте, чтобы соседние узлы не сбивались,
а содержимое живёт в целевом контейнере. Тест «дети рендерятся в целевом контейнере»
проверяет ровно это: в исходном месте пусто, всё содержимое — в target. При
обновлении дети сравниваются в *старом* target (его якоря стабильны), и только
потом, если `to` сменился, переезжают в новый контейнер — игнорирование свежего
target здесь было настоящим багом: вычисленное значение выбрасывалось, и дети
навсегда оставались на месте.

## KeepAlive: не разрушать, а прятать

Обычно при переключении динамического компонента старый уничтожается со всем
состоянием: ввели текст в форму, ушли на другую вкладку, вернулись — поле пустое.
`KeepAlive` это чинит: неактивный компонент не разрушается, а прячется, сохраняя
инстанс и состояние.

```html
<KeepAlive><component :is="currentTab" /></KeepAlive>
```

Реализация — связка «метки на vnode + особая обработка в системе компонентов». Сам
`KeepAlive` ведёт кэш «ключ → vnode с живым инстансом» и расставляет метки:

```js
if (cache.has(key)) {
  vnode.component = cache.get(key).component // переиспользовать живой инстанс
  vnode.__keptAlive = true // система компонентов «оживит», а не смонтирует
}
cache.set(key, vnode) // всегда кладём СВЕЖИЙ vnode — в нём актуальные props
vnode.__shouldKeepAlive = true  // при уходе — спрятать, а не разрушить
vnode.__keepAliveOwner = instance
```

Система компонентов (`component.js`) реагирует на метки в двух точках. При
размонтировании вместо разрушения `unmountComponent` уносит DOM компонента в
off-screen хранилище, не трогая инстанс, — и зовёт `onDeactivated`:

```js
if (vnode.__shouldKeepAlive && owner && !owner.__keepAliveTearingDown) {
  move(instance.subTree, keepAliveStorage(), null) // спрятали
  instance.isDeactivated = true
  invokeHooks(instance.da, instance, 'deactivated hook') // onDeactivated
  return
}
```

А при «монтировании» кэшированного компонента `activateComponent` не создаёт его
заново — возвращает спрятанный DOM, потом прогоняет обычное обновление по новому
vnode (пока компонент спал, его props и слоты могли поменяться) и зовёт
`onActivated`:

```js
function activateComponent(vnode, container, anchor) {
  const instance = vnode.component // положен рендер-функцией KeepAlive из кэша
  move(instance.subTree, container, anchor)
  updateComponent(instance.vnode, vnode)
  vnode.el = instance.subTree.el
  instance.isDeactivated = false
  invokeHooks(instance.a, instance, 'activated hook') // onActivated
}
```

Инстанс всё это время жив, его реактивный эффект не остановлен — поэтому состояние
на месте. Тест «состояние сохраняется при переключении» доказывает это: счётчик,
увеличенный на вкладке A, после ухода на B и возврата остаётся прежним, а не
сбрасывается.

Метка `__keepAliveOwner` важна в самом конце. Когда сам `KeepAlive` размонтируется
по-настоящему, `unmountComponent` помечает его как сворачивающийся: детей больше не
прячут, а всё, что ещё сидит в кэше, получает настоящий unmount — хуки срабатывают,
эффекты останавливаются, DOM хранилища освобождается. Без владельца «размонтирование»
прятало бы вечно, и каждый закэшированный компонент утекал бы до конца жизни страницы.

### Побочно найденный баг слотов

`KeepAlive` вскрыл тонкую ошибку. Его `setup` возвращает `() => slots.default()`,
захватывая `slots` в замыкание. А наш код при обновлении компонента **переприсваивал**
`instance.slots` новым объектом — и замыкание продолжало видеть старый. Из-за этого
`KeepAlive` всегда показывал первую вкладку. Починка: обновлять содержимое того же
объекта `slots`, а не заменять ссылку (`updateSlots` в `component.js`). Хороший урок:
стабильность ссылок важна везде, где что-то захватывается в замыкание.

## Асинхронные компоненты

Большое приложение незачем грузить целиком сразу — редкие экраны можно подтянуть
позже. `defineAsyncComponent` оборачивает загрузчик (обычно динамический `import`) в
компонент, который показывает «загрузку», пока код едет, а потом — настоящий
компонент:

```js
const Chart = defineAsyncComponent(() => import('./Chart.js'))
```

Реализация — снова просто реактивность. Обёртка в `setup` запускает загрузчик и
держит `ref`'ы состояния; когда промис разрешится, `ref` переключается — и обёртка
перерисовывается уже с настоящим компонентом:

```js
setup() {
  const instance = getCurrentInstance()
  const loaded = ref(false)
  const error = ref(null)

  load() // один общий запрос на все инстансы обёртки
    .then(() => {
      if (!instance || !instance.isUnmounted) loaded.value = true
    })
    .catch((err) => {
      if (!instance || !instance.isUnmounted) error.value = err
    })

  return () => {
    if (loaded.value && resolvedComponent) return h(resolvedComponent)
    if (error.value) {
      return options.errorComponent ? h(options.errorComponent) : h('span', 'Loading failed')
    }
    return options.loadingComponent ? h(options.loadingComponent) : h('span', 'Loading…')
  }
}
```

Никакой особой машинерии — реактивность сама переключает вид. Две страховки
заслуживают внимания: `load()` кэширует единственный промис загрузки, так что десять
асинхронных компонентов в списке дают один запрос, а не десять (проваленная загрузка
очищает слот и разрешает повтор); а проверки `isUnmounted` не дают обёртке, снятой до
прихода чанка, переключить состояние и смонтировать опоздавший компонент в уже
исчезнувший контейнер. Тесты проверяют оба исхода: успешную загрузку и ошибку (тогда
показывается `errorComponent`).

## Что мы упростили

За кадром остался `Suspense` — координатор нескольких асинхронных зависимостей с
общим фоллбэком и асинхронным `setup`. Он завязан на более глубокую работу с
промисами внутри рендера и заслуживал бы отдельной большой главы; в учебных целях
достаточно `defineAsyncComponent`, показывающего суть «загрузка → готово». Также в
настоящем Vue `KeepAlive` умеет `include`/`exclude` и лимит кэша (`max`), а
`Teleport` — `disabled`. Мы взяли ядро каждого — но хуки `activated`/`deactivated`
всё-таки вошли: `onActivated`/`onDeactivated` срабатывают ровно там, где компонент
прячут и возвращают.

## Проверяем себя

```bash
npm test        # среди прочего — 5 тестов встроенных компонентов
npm run serve   # http://localhost:5173/playground/11-builtins.html
```

В демо: модалка через `Teleport` уезжает в `#modals`, вкладки под `KeepAlive`
хранят введённый текст, а асинхронный блок появляется с задержкой. Остался
последний слой — расширения стора и большое итоговое приложение, где сойдётся всё.
