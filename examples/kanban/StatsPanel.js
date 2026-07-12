// ============================================================================
//  StatsPanel.js — stats panel, loaded asynchronously (defineAsyncComponent).
//  A separate file so it can be pulled in on demand via import().
// ============================================================================
import { computed, watchEffect } from '../../packages/runtime-core/index.js'
import { useBoard } from './store.js'

export default {
  name: 'StatsPanel',
  setup() {
    const board = useBoard()
    // Per-column counters — recomputed reactively whenever the board changes.
    const stats = computed(() =>
      board.columns.map((c) => ({ name: c.name, n: board.byColumn(c.id).length })),
    )
    const doneCount = computed(() => board.active.filter((c) => c.done).length)

    // watchEffect for demonstration: logs the total number of active cards.
    watchEffect(() => {
      if (typeof console !== 'undefined') {
        // eslint-disable-next-line no-console
        console.log('[stats] active cards:', board.count)
      }
    })

    return { stats, doneCount, total: computed(() => board.count) }
  },
  template: `
    <div class="stats card">
      <h3>Stats</h3>
      <ul>
        <li v-for="s in stats" :key="s.name">{{ s.name }}: <b>{{ s.n }}</b></li>
      </ul>
      <p>Done: {{ doneCount }} of {{ total }}</p>
    </div>
  `,
}
