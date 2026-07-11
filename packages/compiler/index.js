// ============================================================================
//  Публичный вход компилятора + подключение его к рантайму.
//  Импортировав этот файл, компонент сможет иметь свойство template — рантайм
//  автоматически скомпилирует его в render-функцию (см. finishComponentSetup в
//  component.js). Так замыкается цепочка: строка-шаблон → h(...) → DOM.
// ============================================================================

import { compile, compileToString } from './compile.js'
import { registerRuntimeCompiler } from '../runtime-core/component.js'

// Регистрируем компилятор в рантайме один раз при импорте.
registerRuntimeCompiler(compile)

export { compile, compileToString }
export { parse, NodeTypes } from './parse.js'
