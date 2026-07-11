// ============================================================================
//  components.js — все компоненты MiniTrello (кроме асинхронной StatsPanel).
//  Держим в одном файле, потому что BoardView и CardModal ссылаются друг на друга.
// ============================================================================
import {
  ref,
  shallowRef,
  provide,
  defineAsyncComponent,
} from '../../packages/runtime-core/index.js'
import { storeToRefs } from '../../packages/store/index.js'
import { useBoard } from './store.js'

const PRIORITIES = [
  { v: 'low', n: 'Низкий' },
  { v: 'normal', n: 'Обычный' },
  { v: 'high', n: 'Высокий' },
]

// ---------------------------------------------------------------------------
//  CardModal — модалка редактирования карточки. Живёт в #modals через Teleport.
//  Редактируем локальную копию (черновик) и коммитим по «Сохранить».
// ---------------------------------------------------------------------------
export const CardModal = {
  name: 'CardModal',
  props: ['id'],
  setup(props, { emit }) {
    const board = useBoard()
    const card = board.byId(props.id)
    // Черновик правки — отдельные ref, связанные с полями через v-model.
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
          <h3>Карточка</h3>
          <label>Заголовок</label>
          <input v-model="title" v-focus @keyup.enter="save" />
          <label>Приоритет</label>
          <select v-model="priority">
            <option v-for="p in priorities" :key="p.v" :value="p.v">{{ p.n }}</option>
          </select>
          <label class="check">
            <input type="checkbox" v-model="done" /> Выполнено
          </label>
          <div class="modal-actions">
            <button class="primary" @click="save">Сохранить</button>
            <button @click="archive">В архив</button>
            <button class="danger" @click="remove">Удалить</button>
            <button @click="close">Отмена</button>
          </div>
        </div>
      </div>
    </Teleport>
  `,
}

// ---------------------------------------------------------------------------
//  BoardView — сама доска: колонки, поиск, добавление, открытие карточки.
// ---------------------------------------------------------------------------
export const BoardView = {
  name: 'BoardView',
  components: { CardModal },
  setup() {
    const board = useBoard()
    const search = ref('')
    const draft = ref('')
    const draftCol = ref('todo')
    const selected = ref(null) // id открытой карточки (для модалки)

    // Метод-фильтр: карточки колонки, подходящие под поиск.
    const filtered = (colId) =>
      board.byColumn(colId).filter((c) => c.title.toLowerCase().includes(search.value.toLowerCase()))

    const add = () => {
      const t = draft.value.trim()
      if (!t) return
      board.add(t, draftCol.value)
      draft.value = ''
    }

    return { board, search, draft, draftCol, selected, filtered, add }
  },
  template: `
    <div>
      <div class="controls card">
        <input v-model="search" placeholder="Поиск карточек…" />
        <input v-model="draft" @keyup.enter="add" placeholder="Новая карточка…" />
        <select v-model="draftCol">
          <option v-for="c in board.columns" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <button class="primary" @click="add">Добавить</button>
      </div>

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

// Асинхронно загружаемая панель статистики.
const StatsPanel = defineAsyncComponent(() => import('./StatsPanel.js'))

// ---------------------------------------------------------------------------
//  BoardPage — страница доски с вкладками «Доска»/«Статистика» под KeepAlive
//  (состояние поиска на доске сохраняется при переключении вкладок).
// ---------------------------------------------------------------------------
export const BoardPage = {
  name: 'BoardPage',
  setup() {
    const tab = shallowRef(BoardView)
    const tabs = [
      { name: 'Доска', comp: BoardView },
      { name: 'Статистика', comp: StatsPanel },
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
//  ArchivePage — список архивных карточек с возможностью восстановить.
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
      <h3>Архив</h3>
      <p v-if="archivedCards.length === 0" class="muted">Архив пуст.</p>
      <div class="arow" v-for="card in archivedCards" :key="card.id">
        <span>{{ card.title }}</span>
        <button @click="restore(card.id)">Восстановить</button>
      </div>
    </div>
  `,
}

// ---------------------------------------------------------------------------
//  App — корень: шапка с навигацией и счётчиком, RouterView.
// ---------------------------------------------------------------------------
export const App = {
  name: 'App',
  setup() {
    provide('appName', 'MiniTrello') // демонстрация provide/inject
    const board = useBoard()
    const { count } = storeToRefs(board)
    return { count }
  },
  template: `
    <div class="app">
      <header class="topbar">
        <strong>MiniTrello</strong>
        <nav>
          <RouterLink to="/">Доска</RouterLink>
          <RouterLink to="/archive">Архив</RouterLink>
        </nav>
        <span class="pill">Активных: {{ count }}</span>
      </header>
      <main><RouterView /></main>
    </div>
  `,
}
