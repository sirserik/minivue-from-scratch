// Общий компонент приложения — ОДИН И ТОТ ЖЕ код рендерится и на сервере
// (в строку), и на клиенте (гидратация). В этом вся идея изоморфного SSR:
// одна логика на две среды.
import '../../packages/compiler/index.js' // регистрируем компилятор (для template)
import { ref } from '../../packages/runtime-core/index.js'

export const App = {
  setup() {
    const count = ref(0)
    return { count, inc: () => count.value++, dec: () => count.value-- }
  },
  template: `
    <div class="card">
      <h2>SSR + гидратация</h2>
      <p>Этот HTML пришёл с сервера уже готовым — посмотрите исходник страницы
        (View Source): счётчик там уже нарисован. После загрузки JS кнопки ожили.</p>
      <div class="counter">
        <button @click="dec">−</button>
        <strong>{{ count }}</strong>
        <button @click="inc">+</button>
      </div>
    </div>
  `,
}
