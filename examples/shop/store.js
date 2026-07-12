// ============================================================================
//  store.js — two Pinia-like stores for the shop.
//    useCatalog — products + categories loaded from the fake API, plus the
//                 client-side search/category filter.
//    useCart    — the shopping cart, persisted to localStorage.
// ============================================================================
import { defineStore } from '../../packages/store/index.js'
import { ref, computed, watchEffect } from '../../packages/runtime-core/index.js'
import { api } from './api.js'

// ---------------------------------------------------------------------------
//  Catalog: async data + reactive filtering.
// ---------------------------------------------------------------------------
export const useCatalog = defineStore('catalog', () => {
  const products = ref([])
  const categories = ref([])
  const loading = ref(false)
  const error = ref(null)
  const loaded = ref(false)

  // Filter state — bound to the search box and the category chips.
  const search = ref('')
  const activeCategory = ref('') // '' means "all"

  // Load products and categories once. Errors are captured into `error` so the
  // UI can show a message instead of throwing.
  async function load() {
    if (loaded.value || loading.value) return
    loading.value = true
    error.value = null
    try {
      const [prods, cats] = await Promise.all([api.products(), api.categories()])
      products.value = prods
      categories.value = cats
      loaded.value = true
    } catch (e) {
      error.value = e.message || 'Failed to load the catalog'
    } finally {
      loading.value = false
    }
  }

  // The visible products: filtered by category and by the search query.
  const filtered = computed(() => {
    const q = search.value.trim().toLowerCase()
    return products.value.filter((p) => {
      const okCat = !activeCategory.value || p.category === activeCategory.value
      const okSearch = !q || p.title.toLowerCase().includes(q)
      return okCat && okSearch
    })
  })

  const setCategory = (slug) => {
    activeCategory.value = activeCategory.value === slug ? '' : slug
  }

  return { products, categories, loading, error, loaded, search, activeCategory, filtered, load, setCategory }
})

// ---------------------------------------------------------------------------
//  Cart: line items { id, title, price, thumbnail, qty }, persisted.
// ---------------------------------------------------------------------------
const STORAGE_KEY = 'minishop-cart'

export const useCart = defineStore('cart', () => {
  // Restore from localStorage (browser only); fall back to an empty cart.
  let initial = []
  if (typeof localStorage !== 'undefined') {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
      if (Array.isArray(saved)) initial = saved
    } catch {
      /* corrupt data — start empty */
    }
  }
  const items = ref(initial)

  const count = computed(() => items.value.reduce((n, it) => n + it.qty, 0))
  const total = computed(() => items.value.reduce((sum, it) => sum + it.price * it.qty, 0))

  const find = (id) => items.value.find((it) => it.id === id)

  const add = (product, qty = 1) => {
    const line = find(product.id)
    if (line) {
      items.value = items.value.map((it) => (it.id === product.id ? { ...it, qty: it.qty + qty } : it))
    } else {
      items.value = [
        ...items.value,
        { id: product.id, title: product.title, price: product.price, thumbnail: product.thumbnail, qty },
      ]
    }
  }
  const setQty = (id, qty) => {
    if (qty <= 0) return remove(id)
    items.value = items.value.map((it) => (it.id === id ? { ...it, qty } : it))
  }
  const remove = (id) => {
    items.value = items.value.filter((it) => it.id !== id)
  }
  const clear = () => {
    items.value = []
  }

  // Persist on every change (browser only).
  watchEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items.value))
    }
  })

  return { items, count, total, add, setQty, remove, clear, find }
})
