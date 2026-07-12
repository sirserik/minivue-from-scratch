// App routes. The history is injected from outside (hash in the browser,
// memory in tests) — so here we only have the path → component map.
import { BoardPage, ArchivePage } from './components.js'

export const routes = [
  { path: '/', component: BoardPage },
  { path: '/archive', component: ArchivePage },
]
