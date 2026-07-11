// ============================================================================
//  directives.js — кастомные директивы приложения
// ----------------------------------------------------------------------------
//  Обе написаны с оглядкой на среду без DOM (тесты, сервер): если у элемента нет
//  нужного метода или нет document — директива просто ничего не делает.
// ============================================================================

// v-focus — поставить фокус в поле при появлении.
export const focus = {
  mounted(el) {
    if (el && typeof el.focus === 'function') el.focus()
  },
}

// v-click-outside="fn" — вызвать fn при клике вне элемента (закрыть меню/модалку).
export const clickOutside = {
  mounted(el, binding) {
    if (typeof document === 'undefined') return
    el.__onDocClick = (e) => {
      if (!el.contains(e.target)) binding.value(e)
    }
    document.addEventListener('click', el.__onDocClick, true)
  },
  unmounted(el) {
    if (typeof document === 'undefined') return
    document.removeEventListener('click', el.__onDocClick, true)
  },
}
