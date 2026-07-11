// ============================================================================
//  shared.js — мелкие утилиты, общие для рантайма, компилятора и SSR
// ----------------------------------------------------------------------------
//  В шаблонах class и style удобно задавать не только строкой, но и объектом
//  или массивом:
//
//    :class="{ active: isActive, done: isDone }"   // включаем классы по условию
//    :class="['btn', isPrimary && 'btn-primary']"  // список
//    :style="{ color: 'red', fontSize: size + 'px' }"
//
//  Чтобы и браузер, и SSR понимали любую из этих форм одинаково, приводим их к
//  каноничному виду здесь.
// ============================================================================

// Привести class к строке: 'a b c'.
export function normalizeClass(value) {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) {
    // Массив: нормализуем каждый элемент и склеиваем непустые.
    return value
      .map(normalizeClass)
      .filter(Boolean)
      .join(' ')
  }
  if (value && typeof value === 'object') {
    // Объект { имяКласса: включён? } — берём ключи с истинным значением.
    return Object.keys(value)
      .filter((key) => value[key])
      .join(' ')
  }
  return ''
}

// Привести style к объекту { свойство: значение }. Строку разбираем в объект.
export function normalizeStyle(value) {
  if (Array.isArray(value)) {
    // Массив объектов стилей — сливаем в один.
    const result = {}
    for (const item of value) Object.assign(result, normalizeStyle(item))
    return result
  }
  if (typeof value === 'string') {
    const result = {}
    for (const decl of value.split(';')) {
      const [prop, val] = decl.split(':')
      if (prop && val) result[prop.trim()] = val.trim()
    }
    return result
  }
  if (value && typeof value === 'object') return value
  return {}
}

// Объект стиля → строка 'color:red;font-size:14px' (для атрибута и SSR).
// camelCase-свойства переводим в kebab-case: fontSize → font-size.
export function styleToString(style) {
  const obj = normalizeStyle(style)
  return Object.keys(obj)
    .map((k) => `${camelToKebab(k)}:${obj[k]}`)
    .join(';')
}

export function camelToKebab(str) {
  return str.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
}
