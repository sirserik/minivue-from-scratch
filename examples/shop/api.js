// ============================================================================
//  api.js — a thin wrapper around a fake REST API (DummyJSON).
// ----------------------------------------------------------------------------
//  The whole app talks to the network only through this module. That keeps the
//  fetch details in one place and lets tests point it at a mock server by
//  setting `globalThis.__SHOP_API_BASE__` before the app loads.
// ============================================================================

const BASE = globalThis.__SHOP_API_BASE__ || 'https://dummyjson.com'

async function get(path) {
  const res = await fetch(BASE + path)
  if (!res.ok) throw new Error(`Request failed: HTTP ${res.status}`)
  return res.json()
}

export const api = {
  /** First `limit` products (each has title, price, thumbnail, rating, …). */
  products: (limit = 100) => get(`/products?limit=${limit}&select=title,price,thumbnail,rating,stock,category,brand,discountPercentage`).then((d) => d.products),

  /** Category list, normalised to `{ slug, name }` (DummyJSON has shifted shapes over time). */
  categories: () =>
    get('/products/categories').then((list) =>
      list.map((c) => (typeof c === 'string' ? { slug: c, name: c } : { slug: c.slug, name: c.name })),
    ),

  /** A single product by id (full detail: images, description, …). */
  product: (id) => get(`/products/${id}`),
}
