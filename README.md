# MiniVue — Vue 3 своими руками, с нуля

Учебная реализация Vue 3 и всей его экосистемы **с нуля**: реактивность, virtual
DOM, компилятор шаблонов, компоненты, роутер (аналог Vue Router), стор (аналог
Pinia) и SSR. Пишем на **чистом ESM без сборки** — ни Webpack, ни Vite, ни
TypeScript. Всё, что делает браузер, видно как есть: открыл файл — импортировал
модуль — работает.

Цель — чтобы человек, **никогда не писавший на JavaScript**, прошёл путь от «что
такое реактивная переменная» до «как устроен SSR», собирая настоящий фреймворк по
кирпичику. Каждый слой сопровождается главой учебника (`book/`), рабочим кодом
(`packages/`), тестами (`test/`) и живым демо в браузере (`playground/`).

> Это не про то, как **пользоваться** Vue (для этого есть соседний проект
> `vue3-from-scratch`). Это про то, как Vue **устроен внутри** — мы его строим.

## Слои (порядок изучения)

| Слой | Пакет | Что внутри | Статус |
|------|-------|-----------|--------|
| 1. Реактивность | `packages/reactivity` | `ref`, `reactive`, `computed`, `watch`, `effect` | ✅ готово |
| 2. Virtual DOM | `packages/runtime-core`, `runtime-dom` | `h`, `createRenderer`, diff | ⏳ |
| 3. Компоненты | `packages/runtime-core` | `setup`, props/emit, слоты, lifecycle, `createApp` | ⏳ |
| 4. Компилятор | `packages/compiler` | `template` → render-функция | ⏳ |
| 5. Router | `packages/router` | `createRouter`, `RouterView`, `RouterLink` | ⏳ |
| 6. Store | `packages/store` | `createPinia`, `defineStore` | ⏳ |
| 7. SSR | `packages/server-renderer` | `renderToString`, гидратация | ⏳ |

## Как запустить

```bash
# Тесты (встроенный тест-раннер Node, зависимостей нет)
npm test

# Живые демо в браузере
npm run serve
# затем открыть http://localhost:5173/playground/
```

Требуется только Node.js 18+ (для тест-раннера и dev-сервера). Сам фреймворк
работает в любом современном браузере без Node.

## Структура

```
packages/     — исходный код фреймворка, по пакету на подсистему (как в Vue)
playground/   — HTML-демо, импортируют packages/ напрямую (ESM, без сборки)
test/         — тесты на node:test
book/         — учебник (Markdown → PDF через pandoc + xelatex)
scripts/      — dev-сервер для playground
```

## Сборка учебника

```bash
bash book/build/build-pdf.sh
# на выходе — book/MiniVue-from-scratch.pdf
```

Зависимости: `pandoc` 3.x и `xelatex` (TeX Live).

---

Автор: Серик Мурадов · лицензия MIT · названия API совпадают с Vue 3 намеренно —
чтобы знания переносились на настоящий фреймворк один в один.
