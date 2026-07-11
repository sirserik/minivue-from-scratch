# Формы и привязки

Ядро фреймворка готово, но на первой же настоящей форме новичок упрётся в три
неудобства. Поле ввода приходится вручную и читать, и записывать. Классы хочется
включать по условию, а не клеить строку. А обработчику события постоянно нужны
`preventDefault` и проверка нажатой клавиши. Vue закрывает это тремя удобствами:
`v-model`, привязкой `class`/`style` объектом и модификаторами событий. Все три —
надстройки над тем, что уже есть, и добавляются малой кровью.

Код главы: `packages/shared.js` (нормализация class/style), изменения в
`packages/compiler/compile.js` (`v-model`, модификаторы) и
`packages/runtime-dom/patchProp.js`. Тесты — `test/forms.test.mjs`, демо —
`playground/08-forms.html`.

## Привязка class и style

В слое 2 `class` можно было задать только строкой. Но удобнее — объектом «класс →
включён ли» или массивом:

```html
<span :class="{ active: isActive, done: isDone }" />
<span :class="['btn', isPrimary && 'btn-primary']" />
<div :style="{ color: 'red', fontSize: size + 'px' }" />
```

Чтобы и браузер, и SSR понимали любую форму одинаково, мы приводим её к каноничной
в `shared.js`. `normalizeClass` превращает объект/массив в строку, `normalizeStyle`
— в объект, `styleToString` — в строку с kebab-case-свойствами:

```js
normalizeClass({ active: true, off: false })  // 'active'
normalizeClass(['a', false, 'b'])              // 'a b'
styleToString({ color: 'red', fontSize: '14px' }) // 'color:red;font-size:14px'
```

Эти помощники вызываются в двух местах: в браузерном `patchProp` (при установке
`class`/`style` на реальный элемент) и в серверном `renderAttrs`. Одна логика —
оба пути. `fontSize` превращается в `font-size` автоматически, поэтому в объекте
стиля можно писать привычные JS-имена свойств.

## v-model: двусторонняя связь

Поле ввода — улица с двусторонним движением: состояние должно показываться в поле,
а ввод пользователя — обновлять состояние. Вручную это две вещи сразу:

```html
<input :value="name" @input="name = $event.target.value" />
```

`v-model` — сахар ровно над этой парой. `<input v-model="name">` компилятор
разворачивает в привязку значения плюс обработчик. Смотрим на реализацию в
`applyVModel`: она выбирает свойство и событие по типу поля, потому что поля разные:

- текстовый `input` и `textarea` → `:value` + `@input`;
- `checkbox` → `:checked` + `@change` (и берём `$event.target.checked`);
- `select` → `:value` + `@change`.

```js
directives.binds.push({ arg: prop, exp })                       // :value="name"
directives.ons.push({ event, exp: `${exp} = $event.target.${field}` }) // @input="name = ..."
```

Дальше это идёт по обычному пути генерации props — никакого особого узла. Модели
поддерживают и модификаторы: `.number` оборачивает значение в `Number(...)`,
`.trim` — в `.trim()`. Тест «ввод обновляет состояние» проверяет обе стороны: и что
состояние показывается в поле, и что ввод его меняет.

Тонкость на стороне рантайма: для `value` и `checked` `patchProp` пишет не в
атрибут, а в свойство элемента (`el.value`, `el.checked`). Атрибут задаёт лишь
начальное значение, а обновить уже отрисованное поле можно только через свойство —
без этого `v-model` «залипал» бы.

## Модификаторы событий

Обработчики почти всегда начинаются с шаблонных строк: «не перезагружай страницу»,
«не всплывай выше», «реагируй только на Enter». Vue выносит их в модификаторы после
имени события:

```html
<form @submit.prevent="save" />        <!-- $event.preventDefault() -->
<div @click.stop="onClick" />           <!-- $event.stopPropagation() -->
<input @keyup.enter="submit" />         <!-- только если нажат Enter -->
```

Компилятор парсит имя `@submit.prevent` на событие и список модификаторов
(`parseEvent`), а `genHandler` строит обёртку с нужными проверками:

```js
function genHandler(on) {
  if (on.modifiers.length === 0) {
    // без модификаторов — как раньше: ссылка на метод или инлайн-выражение
    return isMethodPath ? `(${exp})` : `$event => (${exp})`
  }
  const guards = []
  if (keyMods.length) guards.push(`if(!_key($event,${JSON.stringify(keyMods)}))return;`)
  if (mods.includes('stop')) guards.push('$event.stopPropagation();')
  if (mods.includes('prevent')) guards.push('$event.preventDefault();')
  if (mods.includes('self')) guards.push('if($event.target!==$event.currentTarget)return;')
  return `$event => { ${guards.join('')} ${isMethodPath ? `${exp}($event)` : `(${exp})`} }`
}
```

Клавишные модификаторы (`.enter`, `.esc`, `.up` и другие) сверяются через помощник
`_key`, который сопоставляет имя модификатора значению `event.key` (`enter` →
`'Enter'`). Тесты проверяют и сгенерированный код, и поведение: `@click.prevent`
действительно зовёт `preventDefault`, а `@keyup.enter` срабатывает только на Enter.

Важно, что путь «без модификаторов» мы оставили прежним — короткая ссылка `(inc)`
или `$event => (count++)`. Так старый код и тесты из слоя 4 продолжают работать без
изменений, а обёртка появляется только там, где реально есть модификаторы.

## Что мы упростили

Настоящий Vue поддерживает больше: `v-model` на компонентах (с `modelValue` и
`update:modelValue`), несколько моделей на одном компоненте, `.lazy`, привязку
`v-model` к `radio` и множественному `select`, системные модификаторы клавиш
(`.ctrl`, `.shift`), `.once`, `.capture`, `.passive`. Мы взяли самое ходовое —
текстовые поля, чекбокс и select, объектный/массивный `class`/`style`,
`.stop`/`.prevent`/`.self` и клавиши. Этого хватает, чтобы собрать полноценную
форму, а принцип у остального ровно тот же.

## Проверяем себя

```bash
npm test        # среди прочего — 11 тестов форм и привязок
npm run serve   # http://localhost:5173/playground/08-forms.html
```

В демо — форма с текстовым полем, `select` и чекбоксом на `v-model`, значком,
класс которого включается объектом `:class`, отправкой по `@submit.prevent` и по
`@keyup.enter`. «Живое состояние» под формой всегда совпадает с полями — это и есть
двусторонняя связь в действии.
