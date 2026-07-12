// ============================================================================
//  store.js — MiniTrello board store (Pinia-like, setup style)
// ----------------------------------------------------------------------------
//  The single source of truth for the whole app: cards and columns.
//  Components (board, modal, archive, stats) only read and mutate this store.
// ============================================================================
import { defineStore } from '../../packages/store/index.js'
import { ref, computed, watchEffect } from '../../packages/runtime-core/index.js'

const STORAGE_KEY = 'minitrello'

// Initial cards (used when there's nothing in localStorage).
const seed = () => [
  { id: 1, title: 'Design the header', columnId: 'todo', priority: 'high', done: false, archived: false },
  { id: 2, title: 'Write tests', columnId: 'todo', priority: 'normal', done: false, archived: false },
  { id: 3, title: 'Review PR', columnId: 'doing', priority: 'normal', done: false, archived: false },
  { id: 4, title: 'Set up the project', columnId: 'done', priority: 'low', done: true, archived: false },
]

export const useBoard = defineStore('board', () => {
  const columns = [
    { id: 'todo', name: 'To do' },
    { id: 'doing', name: 'In progress' },
    { id: 'done', name: 'Done' },
  ]

  // Load from localStorage if present (in the browser), otherwise seed data.
  let initial = seed()
  let maxId = 4
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        // Accept ONLY a non-empty array of cards. Otherwise (empty array, not
        // an array, corrupted JSON) fall back to the seed data — otherwise
        // items.value.filter(...) in a computed would throw and blank the page.
        if (Array.isArray(parsed) && parsed.length > 0) {
          initial = parsed
          maxId = initial.reduce((m, c) => Math.max(m, Number(c.id) || 0), 0)
        }
      } catch {
        /* corrupted data — keep the seed */
      }
    }
  }
  let nextId = maxId + 1
  const items = ref(initial)

  // --- derived values (computed) -------------------------------------------
  const active = computed(() => items.value.filter((c) => !c.archived))
  const archivedCards = computed(() => items.value.filter((c) => c.archived))
  const count = computed(() => active.value.length)

  // --- "getter" functions --------------------------------------------------
  const byColumn = (colId) => active.value.filter((c) => c.columnId === colId)
  const byId = (id) => items.value.find((c) => c.id === Number(id))

  // --- actions (mutate state by replacing the array) -----------------------
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

  // Persistence: watchEffect reads items.value and saves on every change.
  // In Node (tests, SSR) there is no localStorage — then we simply write nothing.
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
