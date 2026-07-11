// ============================================================================
//  renderer.js — превращает дерево VNode в реальные узлы и обновляет их
// ----------------------------------------------------------------------------
//  Рендерер не знает, где он работает — в браузере, на сервере или в тесте.
//  Все операции над «настоящими» узлами он получает снаружи, в объекте options
//  (это и есть nodeOps). Так один и тот же алгоритм diff работает и с DOM, и с
//  выдуманным деревом в тесте. Именно так устроен настоящий Vue.
//
//  Главные действующие лица:
//    render(vnode, container) — точка входа: показать vnode внутри container
//    patch(n1, n2, ...)       — сравнить старый узел n1 и новый n2, внести правки
//    mount* / patch* / unmount — конкретные операции монтирования/обновления
// ============================================================================

import { Text, Fragment, normalizeVNode } from './vnode.js'

export function createRenderer(options) {
  // Распаковываем платформенные операции. Для браузера их даст runtime-dom.
  const {
    createElement: hostCreateElement,
    createText: hostCreateText,
    setText: hostSetText,
    setElementText: hostSetElementText,
    insert: hostInsert,
    remove: hostRemove,
    patchProp: hostPatchProp,
  } = options

  // -------------------------------------------------------------------------
  //  patch — сердце рендерера. Сравнивает n1 («было») и n2 («стало»).
  //   n1 === null           → это первое появление узла, монтируем.
  //   n1.type !== n2.type   → узлы несовместимы, старый убираем, новый монтируем.
  //   иначе                 → обновляем на месте (самый частый и дешёвый путь).
  //  anchor — «якорь»: перед каким узлом вставлять (нужно, чтобы попадать в
  //  нужное место среди соседей). null означает «в конец».
  // -------------------------------------------------------------------------
  function patch(n1, n2, container, anchor = null) {
    // Тот же самый объект — сравнивать нечего.
    if (n1 === n2) return

    // Разные типы узлов нельзя обновлять друг в друга (div не станет span).
    // Убираем старый и дальше пойдём по ветке монтирования.
    if (n1 && n1.type !== n2.type) {
      unmount(n1)
      n1 = null
    }

    const { type } = n2
    if (type === Text) {
      processText(n1, n2, container, anchor)
    } else if (type === Fragment) {
      processFragment(n1, n2, container, anchor)
    } else if (typeof type === 'string') {
      processElement(n1, n2, container, anchor)
    } else if (typeof type === 'object' || typeof type === 'function') {
      // Компоненты появятся в слое 3 — там мы допишем processComponent и
      // подключим его сюда. Пока честно сообщаем, что рано.
      processComponent(n1, n2, container, anchor)
    }
  }

  // --- Текстовые узлы -------------------------------------------------------
  function processText(n1, n2, container, anchor) {
    if (n1 == null) {
      // Монтируем новый текстовый узел. children у Text — это сама строка.
      n2.el = hostCreateText(n2.children)
      hostInsert(n2.el, container, anchor)
    } else {
      // Обновляем: переиспользуем существующий узел, меняем только текст.
      n2.el = n1.el
      if (n2.children !== n1.children) {
        hostSetText(n2.el, n2.children)
      }
    }
  }

  // --- Фрагменты (группа узлов без родительского тега) ----------------------
  function processFragment(n1, n2, container, anchor) {
    if (n1 == null) {
      mountChildren(n2.children, container, anchor)
    } else {
      // Оба — фрагменты: сравниваем их детей напрямую в том же контейнере.
      patchChildren(n1, n2, container, anchor)
    }
  }

  // --- Элементы (div, span, ul, ...) ---------------------------------------
  function processElement(n1, n2, container, anchor) {
    if (n1 == null) {
      mountElement(n2, container, anchor)
    } else {
      patchElement(n1, n2)
    }
  }

  function mountElement(vnode, container, anchor) {
    const { type, props, children } = vnode
    // 1. Создаём сам элемент и запоминаем ссылку на него в vnode.el.
    const el = (vnode.el = hostCreateElement(type))

    // 2. Ставим атрибуты и обработчики. oldValue = null (их ещё нет).
    for (const key in props) {
      if (key === 'key') continue // key — служебный, в DOM не пишем
      hostPatchProp(el, key, null, props[key])
    }

    // 3. Монтируем содержимое: строку — как текст, массив — по одному ребёнку.
    if (typeof children === 'string' || typeof children === 'number') {
      hostSetElementText(el, String(children))
    } else if (Array.isArray(children)) {
      mountChildren(children, el, null)
    }

    // 4. Вставляем готовый элемент в родителя (перед якорем или в конец).
    hostInsert(el, container, anchor)
  }

  function mountChildren(children, container, anchor) {
    for (let i = 0; i < children.length; i++) {
      // Нормализуем: строки/числа станут текстовыми VNode.
      const child = (children[i] = normalizeVNode(children[i]))
      patch(null, child, container, anchor)
    }
  }

  function patchElement(n1, n2) {
    // Элемент того же типа — переиспользуем настоящий узел.
    const el = (n2.el = n1.el)
    patchProps(el, n1.props, n2.props)
    patchChildren(n1, n2, el, null)
  }

  // Сравнить наборы атрибутов: обновить/добавить новые, убрать исчезнувшие.
  function patchProps(el, oldProps, newProps) {
    // Обновляем и добавляем.
    for (const key in newProps) {
      if (key === 'key') continue
      const prev = oldProps[key]
      const next = newProps[key]
      if (prev !== next) {
        hostPatchProp(el, key, prev, next)
      }
    }
    // Удаляем то, чего в новых props больше нет.
    for (const key in oldProps) {
      if (key === 'key') continue
      if (!(key in newProps)) {
        hostPatchProp(el, key, oldProps[key], null)
      }
    }
  }

  // -------------------------------------------------------------------------
  //  patchChildren — сравнить содержимое узла. Дети бывают трёх видов:
  //  текст, массив узлов или пусто. Значит вариантов «было → стало» девять,
  //  но они сводятся к нескольким осмысленным случаям.
  // -------------------------------------------------------------------------
  function patchChildren(n1, n2, container, anchor) {
    const c1 = n1.children
    const c2 = n2.children

    if (typeof c2 === 'string' || typeof c2 === 'number') {
      // Стало текстом. Если было массивом — сначала снимаем старых детей.
      if (Array.isArray(c1)) unmountChildren(c1)
      if (c1 !== c2) hostSetElementText(container, String(c2))
    } else if (Array.isArray(c2)) {
      if (Array.isArray(c1)) {
        // Массив → массив: самый интересный случай, полноценный diff по ключам.
        patchKeyedChildren(c1, c2, container, anchor)
      } else {
        // Было текстом/пусто → стало массивом: чистим текст и монтируем детей.
        hostSetElementText(container, '')
        mountChildren(c2, container, anchor)
      }
    } else {
      // Стало пусто.
      if (Array.isArray(c1)) unmountChildren(c1)
      else if (typeof c1 === 'string') hostSetElementText(container, '')
    }
  }

  // -------------------------------------------------------------------------
  //  patchKeyedChildren — сравнение двух списков детей.
  //  Наивно можно было бы снести старых и создать новых, но это медленно и
  //  теряет состояние (фокус в поле ввода, позицию видео). Поэтому сопоставляем
  //  узлы по ключам и переиспользуем максимум существующих, двигая их при нужде.
  //
  //  Алгоритм (тот же, что во Vue 3):
  //   1) синхронизируем совпадающие узлы с НАЧАЛА, пока ключи совпадают;
  //   2) синхронизируем совпадающие узлы с КОНЦА;
  //   3) если остались только новые — монтируем их;
  //   4) если остались только старые — размонтируем;
  //   5) сложный случай (перемешаны) — строим карту ключей, обновляем совпавшие,
  //      удаляем лишние и минимально двигаем через наибольшую возрастающую
  //      подпоследовательность (LIS).
  // -------------------------------------------------------------------------
  function patchKeyedChildren(c1, c2, container, parentAnchor) {
    // Нормализуем новых детей заранее (строки → текстовые VNode).
    for (let i = 0; i < c2.length; i++) c2[i] = normalizeVNode(c2[i])

    let i = 0
    let e1 = c1.length - 1 // последний индекс в старом списке
    let e2 = c2.length - 1 // последний индекс в новом списке

    // (1) Синхронизация с начала: пока ключи совпадают — обновляем на месте.
    while (i <= e1 && i <= e2 && isSameVNode(c1[i], c2[i])) {
      patch(c1[i], c2[i], container, parentAnchor)
      i++
    }

    // (2) Синхронизация с конца.
    while (i <= e1 && i <= e2 && isSameVNode(c1[e1], c2[e2])) {
      patch(c1[e1], c2[e2], container, parentAnchor)
      e1--
      e2--
    }

    if (i > e1) {
      // (3) Старые кончились, а новые остались (i..e2) — их надо смонтировать.
      if (i <= e2) {
        // Якорь — узел, стоящий сразу за вставляемым диапазоном.
        const nextPos = e2 + 1
        const anchor = nextPos < c2.length ? c2[nextPos].el : parentAnchor
        while (i <= e2) {
          patch(null, c2[i], container, anchor)
          i++
        }
      }
    } else if (i > e2) {
      // (4) Новые кончились, а старые остались (i..e1) — их надо удалить.
      while (i <= e1) {
        unmount(c1[i])
        i++
      }
    } else {
      // (5) Общий случай: пересекающийся неупорядоченный диапазон.
      const s1 = i // старт в старом списке
      const s2 = i // старт в новом списке

      // Карта «ключ нового узла → его индекс», чтобы быстро искать совпадения.
      const keyToNewIndex = new Map()
      for (let k = s2; k <= e2; k++) {
        const child = c2[k]
        if (child.key != null) keyToNewIndex.set(child.key, k)
      }

      const toBePatched = e2 - s2 + 1 // сколько новых узлов ещё предстоит обработать
      let patched = 0
      // newIndexToOldIndex[новыйОтносительныйИндекс] = старыйИндекс + 1.
      // 0 означает «этому новому узлу не нашлось старого» → надо монтировать.
      const newIndexToOldIndex = new Array(toBePatched).fill(0)

      // Проходим по оставшимся СТАРЫМ узлам: обновляем совпавшие, удаляем лишние.
      for (let k = s1; k <= e1; k++) {
        const prevChild = c1[k]
        if (patched >= toBePatched) {
          // Все новые уже нашли пару — остаток старых лишний.
          unmount(prevChild)
          continue
        }
        let newIndex
        if (prevChild.key != null) {
          newIndex = keyToNewIndex.get(prevChild.key)
        } else {
          // Узлы без ключа ищем перебором среди новых без пары.
          for (let j = s2; j <= e2; j++) {
            if (newIndexToOldIndex[j - s2] === 0 && isSameVNode(prevChild, c2[j])) {
              newIndex = j
              break
            }
          }
        }
        if (newIndex === undefined) {
          // Старому узлу нет пары среди новых — удаляем.
          unmount(prevChild)
        } else {
          newIndexToOldIndex[newIndex - s2] = k + 1
          patch(prevChild, c2[newIndex], container, parentAnchor)
          patched++
        }
      }

      // Теперь двигаем и монтируем. Идём с КОНЦА, чтобы якорь (уже готовый
      // правый сосед) всегда существовал.
      const increasing = getSequence(newIndexToOldIndex) // индексы, что двигать не надо
      let seqPointer = increasing.length - 1

      for (let k = toBePatched - 1; k >= 0; k--) {
        const newIndex = s2 + k
        const newChild = c2[newIndex]
        const anchor = newIndex + 1 < c2.length ? c2[newIndex + 1].el : parentAnchor

        if (newIndexToOldIndex[k] === 0) {
          // Пары не было — это новый узел, монтируем.
          patch(null, newChild, container, anchor)
        } else if (seqPointer < 0 || k !== increasing[seqPointer]) {
          // Узел есть, но он не в «стабильной» подпоследовательности — двигаем.
          hostInsert(newChild.el, container, anchor)
        } else {
          // Узел на своём относительном месте — двигать не нужно.
          seqPointer--
        }
      }
    }
  }

  function unmountChildren(children) {
    for (const child of children) unmount(child)
  }

  function unmount(vnode) {
    if (vnode.type === Fragment) {
      // У фрагмента нет своего узла — размонтируем его детей.
      unmountChildren(vnode.children)
      return
    }
    // Даём компонентам шанс размонтироваться правильно (слой 3 доопределит).
    if (vnode.component) {
      unmountComponent(vnode)
      return
    }
    hostRemove(vnode.el)
  }

  // -------------------------------------------------------------------------
  //  render — публичная точка входа. Хранит предыдущий VNode прямо на
  //  контейнере (container._vnode), чтобы при следующем вызове было с чем
  //  сравнивать.
  // -------------------------------------------------------------------------
  function render(vnode, container) {
    if (vnode == null) {
      // render(null, ...) означает «очистить» — размонтируем прошлое дерево.
      if (container._vnode) unmount(container._vnode)
    } else {
      patch(container._vnode || null, vnode, container, null)
    }
    container._vnode = vnode
  }

  // -------------------------------------------------------------------------
  //  ГИДРАТАЦИЯ (слой 7). Сервер уже прислал готовый HTML. На клиенте не нужно
  //  создавать элементы заново — надо «усыновить» существующие: связать наши
  //  VNode с реальными узлами (vnode.el = узел) и навесить обработчики событий
  //  (их в HTML нет). После этого приложение живёт как обычно — правки идут через
  //  patch по уже адаптированному дереву.
  // -------------------------------------------------------------------------
  function hydrate(vnode, container) {
    hydrateNode(container.firstChild, vnode)
    container._vnode = vnode
  }

  // Гидрировать один узел: сопоставить DOM-узел node и vnode. Возвращает
  // следующий DOM-узел (правого соседа) — чтобы идти по детям по очереди.
  function hydrateNode(node, vnode) {
    vnode = normalizeVNode(vnode)
    const { type } = vnode

    if (type === Text) {
      vnode.el = node
      return node ? node.nextSibling : null
    }

    if (type === Fragment) {
      let cur = node
      for (const child of vnode.children) cur = hydrateNode(cur, child)
      return cur
    }

    if (typeof type === 'string') {
      // Элемент: связываем узел и навешиваем props. Статические атрибуты в HTML
      // уже есть (setAttribute идемпотентен), а вот события добавляются здесь.
      vnode.el = node
      for (const key in vnode.props) {
        if (key !== 'key') hostPatchProp(node, key, null, vnode.props[key])
      }
      // Гидрируем детей по childNodes.
      if (Array.isArray(vnode.children)) {
        let cur = node.firstChild
        for (const child of vnode.children) cur = hydrateNode(cur, child)
      }
      return node.nextSibling
    }

    if (typeof type === 'object' || typeof type === 'function') {
      // Компонент: отдаём его системе компонентов, она смонтируется «поверх»
      // существующего узла и заведёт реактивный эффект для будущих обновлений.
      hydrateComponentImpl(vnode, node)
      return node ? node.nextSibling : null
    }

    return node ? node.nextSibling : null
  }

  // -- Заглушки для компонентов. Их тело подставляет слой 3 через
  //    __installComponents, а гидратацию компонентов — слой 7.
  let processComponent = () => {
    throw new Error('Компоненты появятся в слое 3 (runtime-core/component.js)')
  }
  let unmountComponent = (vnode) => hostRemove(vnode.el)
  let hydrateComponentImpl = () => {
    throw new Error('Гидратация компонентов не подключена')
  }

  // Позволяем слою компонентов «вставить» свою реализацию, не переписывая
  // весь рендерер. Отдаём внутренние функции, которые компонентам нужны
  // (включая hydrateNode — она нужна для гидратации поддерева компонента).
  function __installComponents(install) {
    const api = install({ patch, unmount, render, options, mountChildren, hydrateNode })
    processComponent = api.processComponent
    unmountComponent = api.unmountComponent
    if (api.hydrateComponent) hydrateComponentImpl = api.hydrateComponent
  }

  return { render, hydrate, createRenderer, patch, __installComponents }
}

// Два VNode «те же самые» (можно обновлять один в другой), если совпали и тип,
// и ключ. Разный ключ при одинаковом теге — это разные логические узлы.
function isSameVNode(n1, n2) {
  return n1.type === n2.type && n1.key === n2.key
}

// ---------------------------------------------------------------------------
//  getSequence — наибольшая возрастающая подпоследовательность (LIS).
//  Возвращает индексы элементов массива, которые образуют самую длинную
//  возрастающую цепочку. В диффе это узлы, которые УЖЕ стоят в правильном
//  относительном порядке — их можно не двигать, а двигать только остальные.
//  Так число перемещений в DOM минимально. Реализация — классический алгоритм
//  за O(n log n) с восстановлением пути через массив предков.
// ---------------------------------------------------------------------------
function getSequence(arr) {
  const p = arr.slice() // предки: p[i] — индекс предыдущего в цепочке для i
  const result = [0] // индексы элементов текущей найденной цепочки
  let i, j, lo, hi, mid

  for (i = 0; i < arr.length; i++) {
    const arrI = arr[i]
    if (arrI === 0) continue // 0 = «новый узел», в цепочку не берём

    j = result[result.length - 1]
    if (arr[j] < arrI) {
      // arrI больше последнего — просто продлеваем цепочку.
      p[i] = j
      result.push(i)
      continue
    }

    // Бинарным поиском находим, какой элемент цепочки заменить на i.
    lo = 0
    hi = result.length - 1
    while (lo < hi) {
      mid = (lo + hi) >> 1
      if (arr[result[mid]] < arrI) lo = mid + 1
      else hi = mid
    }
    if (arrI < arr[result[lo]]) {
      if (lo > 0) p[i] = result[lo - 1]
      result[lo] = i
    }
  }

  // Восстанавливаем цепочку по предкам, идя с конца.
  let u = result.length
  let v = result[u - 1]
  while (u-- > 0) {
    result[u] = v
    v = p[v]
  }
  return result
}
