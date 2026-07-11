// ============================================================================
//  store.js — стор доски MiniTrello (аналог Pinia, setup-стиль)
// ----------------------------------------------------------------------------
//  Единственный источник правды для всего приложения: карточки и колонки.
//  Компоненты (доска, модалка, архив, статистика) читают и меняют только его.
// ============================================================================
import { defineStore } from '../../packages/store/index.js'
import { ref, computed, watchEffect } from '../../packages/runtime-core/index.js'

const STORAGE_KEY = 'minitrello'

// Начальные карточки (если в localStorage ничего нет).
const seed = () => [
  { id: 1, title: 'Сверстать шапку', columnId: 'todo', priority: 'high', done: false, archived: false },
  { id: 2, title: 'Написать тесты', columnId: 'todo', priority: 'normal', done: false, archived: false },
  { id: 3, title: 'Ревью PR', columnId: 'doing', priority: 'normal', done: false, archived: false },
  { id: 4, title: 'Настроить проект', columnId: 'done', priority: 'low', done: true, archived: false },
]

export const useBoard = defineStore('board', () => {
  const columns = [
    { id: 'todo', name: 'Надо' },
    { id: 'doing', name: 'В работе' },
    { id: 'done', name: 'Готово' },
  ]

  // Загружаем из localStorage, если есть (в браузере), иначе — начальные данные.
  let initial = seed()
  let maxId = 4
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        // Принимаем ТОЛЬКО непустой массив карточек. Иначе (пустой массив, не
        // массив, битый JSON) откатываемся на начальные данные — иначе
        // items.value.filter(...) в computed упал бы и обнулил всю страницу.
        if (Array.isArray(parsed) && parsed.length > 0) {
          initial = parsed
          maxId = initial.reduce((m, c) => Math.max(m, Number(c.id) || 0), 0)
        }
      } catch {
        /* битые данные — оставим seed */
      }
    }
  }
  let nextId = maxId + 1
  const items = ref(initial)

  // --- производные значения (computed) -------------------------------------
  const active = computed(() => items.value.filter((c) => !c.archived))
  const archivedCards = computed(() => items.value.filter((c) => c.archived))
  const count = computed(() => active.value.length)

  // --- «геттеры»-функции ---------------------------------------------------
  const byColumn = (colId) => active.value.filter((c) => c.columnId === colId)
  const byId = (id) => items.value.find((c) => c.id === Number(id))

  // --- действия (мутируют состояние заменой массива) -----------------------
  const add = (title, columnId = 'todo') => {
    items.value = [
      ...items.value,
      { id: nextId++, title, columnId, priority: 'normal', done: false, archived: false },
    ]
  }
  const update = (id, patch) => {
    items.value = items.value.map((c) => (c.id === Number(id) ? { ...c, ...patch } : c))
  }
  const move = (id, columnId) => update(id, { columnId })
  const remove = (id) => {
    items.value = items.value.filter((c) => c.id !== Number(id))
  }
  const archive = (id) => update(id, { archived: true })
  const restore = (id) => update(id, { archived: false })
  const toggleDone = (id) => update(id, { done: !byId(id).done })

  // Персистентность: watchEffect читает items.value и сохраняет при каждом
  // изменении. В Node (тесты, SSR) localStorage нет — тогда просто ничего не пишем.
  watchEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items.value))
    }
  })

  return {
    items,
    columns,
    active,
    archivedCards,
    count,
    byColumn,
    byId,
    add,
    update,
    move,
    remove,
    archive,
    restore,
    toggleDone,
  }
})
