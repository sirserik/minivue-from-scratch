// ============================================================================
//  StatsPanel.js — панель статистики, загружаемая асинхронно (defineAsyncComponent).
//  Отдельный файл, чтобы его можно было подтянуть по требованию через import().
// ============================================================================
import { computed, watchEffect } from '../../packages/runtime-core/index.js'
import { useBoard } from './store.js'

export default {
  name: 'StatsPanel',
  setup() {
    const board = useBoard()
    // Счётчики по колонкам — реактивно пересчитываются при изменениях доски.
    const stats = computed(() =>
      board.columns.map((c) => ({ name: c.name, n: board.byColumn(c.id).length })),
    )
    const doneCount = computed(() => board.active.filter((c) => c.done).length)

    // watchEffect ради демонстрации: печатает общее число активных карточек.
    watchEffect(() => {
      if (typeof console !== 'undefined') {
        // eslint-disable-next-line no-console
        console.log('[stats] активных карточек:', board.count)
      }
    })

    return { stats, doneCount, total: computed(() => board.count) }
  },
  template: `
    <div class="stats card">
      <h3>Статистика</h3>
      <ul>
        <li v-for="s in stats" :key="s.name">{{ s.name }}: <b>{{ s.n }}</b></li>
      </ul>
      <p>Готово: {{ doneCount }} из {{ total }}</p>
    </div>
  `,
}
