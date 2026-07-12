// ============================================================================
//  components.js — all MiniTrello components (except the async StatsPanel).
//  Kept in one file because BoardView and CardModal reference each other.
// ============================================================================
import {
  ref,
  shallowRef,
  computed,
  provide,
  defineAsyncComponent,
} from '../../packages/runtime-core/index.js'
import { storeToRefs } from '../../packages/store/index.js'
import { useBoard } from './store.js'

const PRIORITIES = [
  { v: 'low', n: 'Low' },
  { v: 'normal', n: 'Normal' },
  { v: 'high', n: 'High' },
]

// ---------------------------------------------------------------------------
//  CardModal — card edit modal. Lives in #modals via Teleport.
//  We edit a local copy (draft) and commit it on "Save".
// ---------------------------------------------------------------------------
export const CardModal = {
  name: 'CardModal',
  props: ['id'],
  setup(props, { emit }) {
    const board = useBoard()
    const card = board.byId(props.id)
    // Edit draft — separate refs bound to the fields via v-model.
    const title = ref(card ? card.title : '')
    const priority = ref(card ? card.priority : 'normal')
    const done = ref(card ? card.done : false)

    const close = () => emit('close')
    const save = () => {
      board.update(props.id, { title: title.value, priority: priority.value, done: done.value })
      close()
    }
    const archive = () => {
      board.archive(props.id)
      close()
    }
    const remove = () => {
      board.remove(props.id)
      close()
    }
    return { title, priority, done, priorities: PRIORITIES, close, save, archive, remove }
  },
  template: `
    <Teleport to="#modals">
      <div class="backdrop" @click.self="close">
        <div class="modal card" v-click-outside="close">
          <h3>Card</h3>
          <label>Title</label>
          <input v-model="title" v-focus @keyup.enter="save" />
          <label>Priority</label>
          <select v-model="priority">
            <option v-for="p in priorities" :key="p.v" :value="p.v">{{ p.n }}</option>
          </select>
          <label class="check">
            <input type="checkbox" v-model="done" /> Done
          </label>
          <div class="modal-actions">
            <button class="primary" @click="save">Save</button>
            <button @click="archive">Archive</button>
            <button class="danger" @click="remove">Delete</button>
            <button @click="close">Cancel</button>
          </div>
        </div>
      </div>
    </Teleport>
  `,
}

// ---------------------------------------------------------------------------
//  BoardView — the board itself: columns, search, adding, opening a card.
// ---------------------------------------------------------------------------
export const BoardView = {
  name: 'BoardView',
  components: { CardModal },
  setup() {
    const board = useBoard()
    const search = ref('')
    const draft = ref('')
    const draftCol = ref('todo')
    const selected = ref(null) // id of the open card (for the modal)

    // Filter method: a column's cards that match the search.
    const filtered = (colId) =>
      board.byColumn(colId).filter((c) => c.title.toLowerCase().includes(search.value.toLowerCase()))

    // How many cards match the current search (for the empty-state hint).
    const matchCount = computed(() =>
      board.active.filter((c) => c.title.toLowerCase().includes(search.value.toLowerCase())).length,
    )

    const add = () => {
      const t = draft.value.trim()
      if (!t) return
      board.add(t, draftCol.value)
      draft.value = ''
    }

    return { board, search, draft, draftCol, selected, filtered, matchCount, add }
  },
  template: `
    <div>
      <div class="controls card">
        <input class="search" v-model="search" placeholder="🔎 Search cards…" />
        <button v-if="search" @click="search = ''">✕</button>
        <span class="sep"></span>
        <input v-model="draft" @keyup.enter="add" placeholder="New card…" />
        <select v-model="draftCol">
          <option v-for="c in board.columns" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <button class="primary" @click="add">Add</button>
      </div>

      <p v-if="search && matchCount === 0" class="muted">
        Nothing found for «{{ search }}» — cards are hidden by the filter.
        <button @click="search = ''">Show all</button>
      </p>

      <div class="board">
        <div class="column" v-for="col in board.columns" :key="col.id">
          <h3>{{ col.name }} <span class="pill">{{ filtered(col.id).length }}</span></h3>
          <div class="kcard" :class="{ done: card.done, ['p-' + card.priority]: true }"
               v-for="card in filtered(col.id)" :key="card.id" @click="selected = card.id">
            <span>{{ card.title }}</span>
          </div>
        </div>
      </div>

      <CardModal v-if="selected" :id="selected" @close="selected = null" />
    </div>
  `,
}

// Asynchronously loaded stats panel.
const StatsPanel = defineAsyncComponent(() => import('./StatsPanel.js'))

// ---------------------------------------------------------------------------
//  BoardPage — board page with "Board"/"Stats" tabs under KeepAlive
//  (the board's search state is preserved when switching tabs).
// ---------------------------------------------------------------------------
export const BoardPage = {
  name: 'BoardPage',
  setup() {
    const tab = shallowRef(BoardView)
    const tabs = [
      { name: 'Board', comp: BoardView },
      { name: 'Stats', comp: StatsPanel },
    ]
    return { tab, tabs }
  },
  template: `
    <div>
      <div class="tabs">
        <button v-for="t in tabs" :key="t.name"
                :class="{ active: tab === t.comp }" @click="tab = t.comp">{{ t.name }}</button>
      </div>
      <KeepAlive><component :is="tab" /></KeepAlive>
    </div>
  `,
}

// ---------------------------------------------------------------------------
//  ArchivePage — list of archived cards with the option to restore them.
// ---------------------------------------------------------------------------
export const ArchivePage = {
  name: 'ArchivePage',
  setup() {
    const board = useBoard()
    const { archivedCards } = storeToRefs(board)
    return { archivedCards, restore: board.restore }
  },
  template: `
    <div class="card">
      <h3>Archive</h3>
      <p v-if="archivedCards.length === 0" class="muted">The archive is empty.</p>
      <div class="arow" v-for="card in archivedCards" :key="card.id">
        <span>{{ card.title }}</span>
        <button @click="restore(card.id)">Restore</button>
      </div>
    </div>
  `,
}

// ---------------------------------------------------------------------------
//  App — root: header with navigation and a counter, RouterView.
// ---------------------------------------------------------------------------
export const App = {
  name: 'App',
  setup() {
    provide('appName', 'MiniTrello') // provide/inject demonstration
    const board = useBoard()
    const { count } = storeToRefs(board)
    return { count }
  },
  template: `
    <div class="app">
      <header class="topbar">
        <strong>MiniTrello</strong>
        <nav>
          <RouterLink to="/">Board</RouterLink>
          <RouterLink to="/archive">Archive</RouterLink>
        </nav>
        <span class="pill">Active: {{ count }}</span>
      </header>
      <main><RouterView /></main>
    </div>
  `,
}
