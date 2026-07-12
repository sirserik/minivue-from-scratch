// ============================================================================
//  components.js — all MiniShop components.
//  Kept in one file so the catalog, product page and cart can share helpers.
//
//  Navigation here is programmatic (useRouter().push) rather than via
//  <RouterLink>, because these links carry CSS classes and this teaching
//  renderer does not fall through attributes onto a component's root. The sister
//  MiniTrello demo shows <RouterLink>; this one shows the router API directly.
// ============================================================================
import { ref, reactive, watchEffect } from '../../packages/runtime-core/index.js'
import { useRoute, useRouter } from '../../packages/router/index.js'
import { useCatalog, useCart } from './store.js'
import { api } from './api.js'

// Format a number as a price. Exposed to templates that need it.
const money = (n) => '$' + Number(n).toFixed(2)

// ---------------------------------------------------------------------------
//  ProductCard — one product in the grid. Opens the detail page and can add
//  straight to the cart.
// ---------------------------------------------------------------------------
export const ProductCard = {
  name: 'ProductCard',
  props: ['product'],
  setup(props) {
    const cart = useCart()
    const router = useRouter()
    const open = () => router.push('/product/' + props.product.id)
    const add = () => cart.add(props.product)
    return { open, add, money }
  },
  template: `
    <div class="pcard">
      <div class="pcard-img" @click="open">
        <img :src="product.thumbnail" :alt="product.title" v-img-fallback loading="lazy" />
      </div>
      <div class="pcard-body">
        <span class="pcard-title" @click="open">{{ product.title }}</span>
        <div class="pcard-meta">
          <span class="rating">★ {{ product.rating }}</span>
          <span class="cat">{{ product.category }}</span>
        </div>
        <div class="pcard-foot">
          <strong class="price">{{ money(product.price) }}</strong>
          <button class="primary" @click="add">Add</button>
        </div>
      </div>
    </div>
  `,
}

// ---------------------------------------------------------------------------
//  CatalogPage — the storefront: search, category chips, product grid.
//  Loads data on mount; loading/error/empty states are all handled.
// ---------------------------------------------------------------------------
export const CatalogPage = {
  name: 'CatalogPage',
  components: { ProductCard },
  setup() {
    const catalog = useCatalog()
    catalog.load() // fire-and-forget; the template reacts to loading/error/filtered
    return { catalog }
  },
  template: `
    <div>
      <div class="toolbar card">
        <input class="search" v-model="catalog.search" v-focus placeholder="🔎 Search products…" />
        <button v-if="catalog.search" @click="catalog.search = ''">✕</button>
        <span class="sep"></span>
        <label class="ctl">
          Sort
          <select v-model="catalog.sort">
            <option value="featured">Featured</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
            <option value="rating">Top rated</option>
            <option value="name">Name A–Z</option>
          </select>
        </label>
        <label class="ctl">
          Price
          <input type="number" class="pin" min="0" v-model="catalog.minPrice" placeholder="min" />
          <span class="dash">–</span>
          <input type="number" class="pin" min="0" v-model="catalog.maxPrice" placeholder="max" />
        </label>
      </div>

      <div class="chips">
        <button class="chip" :class="{ active: catalog.activeCategory === '' }" @click="catalog.activeCategory = ''">All</button>
        <button class="chip" v-for="c in catalog.categories" :key="c.slug"
                :class="{ active: catalog.activeCategory === c.slug }" @click="catalog.setCategory(c.slug)">{{ c.name }}</button>
      </div>

      <p v-if="catalog.loading" class="muted state">Loading products…</p>
      <p v-if="catalog.error" class="error state">⚠ {{ catalog.error }}</p>

      <div v-if="!catalog.loading && !catalog.error">
        <p class="muted result-count" v-if="catalog.filtered.length > 0">{{ catalog.filtered.length }} products</p>
        <p v-if="catalog.filtered.length === 0" class="muted state">
          Nothing matches your filters.
          <button @click="catalog.resetFilters()">Reset</button>
        </p>
        <div class="grid">
          <ProductCard v-for="p in catalog.filtered" :key="p.id" :product="p" />
        </div>
      </div>
    </div>
  `,
}

// ---------------------------------------------------------------------------
//  ProductPage — the detail view for /product/:id.
//  Re-fetches whenever the :id param changes (watchEffect reads route.params).
// ---------------------------------------------------------------------------
export const ProductPage = {
  name: 'ProductPage',
  setup() {
    const route = useRoute()
    const router = useRouter()
    const cart = useCart()
    const product = ref(null)
    const loading = ref(false)
    const error = ref(null)
    const qty = ref(1)

    // Refetch on every id change. Because route.params is reactive, this effect
    // re-runs on navigation between products without remounting the component.
    watchEffect(async () => {
      const id = route.params.id
      if (!id) return
      loading.value = true
      error.value = null
      product.value = null
      qty.value = 1
      try {
        product.value = await api.product(id)
      } catch (e) {
        error.value = e.message || 'Failed to load the product'
      } finally {
        loading.value = false
      }
    })

    const back = () => router.push('/')
    const dec = () => { if (qty.value > 1) qty.value-- }
    const inc = () => qty.value++
    const addToCart = () => {
      if (product.value) cart.add(product.value, qty.value)
    }

    return { product, loading, error, qty, back, dec, inc, addToCart, money }
  },
  template: `
    <div>
      <a class="back" @click="back">← Back to catalog</a>

      <p v-if="loading" class="muted state">Loading…</p>
      <p v-if="error" class="error state">⚠ {{ error }}</p>

      <div v-if="product && !loading" class="detail card">
        <div class="detail-img">
          <img :src="product.thumbnail" :alt="product.title" v-img-fallback />
        </div>
        <div class="detail-body">
          <h2>{{ product.title }}</h2>
          <p class="muted">{{ product.brand }} · {{ product.category }}</p>
          <p class="rating">★ {{ product.rating }} · {{ product.stock }} in stock</p>
          <p class="detail-price">{{ money(product.price) }}</p>
          <p class="detail-desc">{{ product.description }}</p>
          <div class="qty">
            <button @click="dec">−</button>
            <span class="qty-n">{{ qty }}</span>
            <button @click="inc">+</button>
            <button class="primary buy" @click="addToCart">Add {{ qty }} to cart</button>
          </div>
        </div>
      </div>
    </div>
  `,
}

// ---------------------------------------------------------------------------
//  CartDrawer — a slide-over cart rendered into #modals via Teleport.
//  Shown by App when the shared cart-UI state is open.
// ---------------------------------------------------------------------------
export const CartDrawer = {
  name: 'CartDrawer',
  setup(_props, { emit }) {
    const cart = useCart()
    const close = () => emit('close')
    const checkout = () => {
      cart.clear()
      close()
    }
    return { cart, close, checkout, money }
  },
  template: `
    <Teleport to="#modals">
      <div class="backdrop" @click.self="close">
        <aside class="drawer">
          <header class="drawer-head">
            <strong>Your cart</strong>
            <button @click="close">✕</button>
          </header>

          <p v-if="cart.items.length === 0" class="muted state">Your cart is empty.</p>

          <div class="drawer-list">
            <div class="line" v-for="it in cart.items" :key="it.id">
              <img :src="it.thumbnail" :alt="it.title" v-img-fallback />
              <div class="line-main">
                <span class="line-title">{{ it.title }}</span>
                <span class="muted">{{ money(it.price) }}</span>
              </div>
              <div class="qty small">
                <button @click="cart.setQty(it.id, it.qty - 1)">−</button>
                <span class="qty-n">{{ it.qty }}</span>
                <button @click="cart.setQty(it.id, it.qty + 1)">+</button>
              </div>
              <button class="danger" @click="cart.remove(it.id)">Remove</button>
            </div>
          </div>

          <footer v-if="cart.items.length > 0" class="drawer-foot">
            <div class="total"><span>Total</span><strong>{{ money(cart.total) }}</strong></div>
            <button class="primary block" @click="checkout">Checkout</button>
          </footer>
        </aside>
      </div>
    </Teleport>
  `,
}

// ---------------------------------------------------------------------------
//  App — top bar (with a live cart count), the routed page under KeepAlive,
//  and the cart drawer.
// ---------------------------------------------------------------------------
export const App = {
  name: 'App',
  components: { CartDrawer },
  setup() {
    const cart = useCart()
    const router = useRouter()
    const ui = reactive({ cartOpen: false })
    const goHome = () => router.push('/')
    return { cart, ui, goHome }
  },
  template: `
    <div class="app">
      <header class="topbar">
        <a class="brand" @click="goHome">MiniShop</a>
        <span class="grow"></span>
        <button class="cart-btn" @click="ui.cartOpen = true">
          🛒 Cart <span class="pill" v-if="cart.count > 0">{{ cart.count }}</span>
        </button>
      </header>
      <main>
        <KeepAlive><RouterView /></KeepAlive>
      </main>
      <CartDrawer v-if="ui.cartOpen" @close="ui.cartOpen = false" />
    </div>
  `,
}
