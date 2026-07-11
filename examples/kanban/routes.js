// Маршруты приложения. История подставляется снаружи (hash в браузере,
// memory в тестах) — поэтому здесь только карта путь → компонент.
import { BoardPage, ArchivePage } from './components.js'

export const routes = [
  { path: '/', component: BoardPage },
  { path: '/archive', component: ArchivePage },
]
