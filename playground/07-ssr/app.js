// Shared app component — the SAME code is rendered both on the server
// (to a string) and on the client (hydration). This is the whole idea of
// isomorphic SSR: one set of logic for two environments.
import '../../packages/compiler/index.js' // register the compiler (for template)
import { ref } from '../../packages/runtime-core/index.js'

export const App = {
  setup() {
    const count = ref(0)
    return { count, inc: () => count.value++, dec: () => count.value-- }
  },
  template: `
    <div class="card">
      <h2>SSR + hydration</h2>
      <p>This HTML arrived from the server already rendered — look at the page source
        (View Source): the counter is already drawn there. Once the JS loads, the buttons come alive.</p>
      <div class="counter">
        <button @click="dec">−</button>
        <strong>{{ count }}</strong>
        <button @click="inc">+</button>
      </div>
    </div>
  `,
}
