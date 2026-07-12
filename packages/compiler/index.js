// ============================================================================
//  Public compiler entry point + wiring it into the runtime.
//  By importing this file, a component gains the ability to have a `template`
//  option — the runtime automatically compiles it into a render function (see
//  finishComponentSetup in component.js). This closes the loop:
//  template string → h(...) → DOM.
// ============================================================================

import { compile, compileToString } from './compile.js'
import { registerRuntimeCompiler } from '../runtime-core/component.js'

// Register the compiler with the runtime once, at import time.
registerRuntimeCompiler(compile)

export { compile, compileToString }
export { parse, NodeTypes } from './parse.js'
