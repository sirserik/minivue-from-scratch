// ============================================================================
//  minivue.js — the "full build" of the framework (one import for everything)
// ----------------------------------------------------------------------------
//  This is the counterpart of real Vue's main `vue` package: the browser
//  runtime PLUS the template compiler. Importing from here is enough — and
//  components can use the template option, because importing the compiler
//  registers it with the runtime (a side effect of the line below).
//
//    import { createApp, ref } from '../packages/minivue.js'
// ============================================================================

// Side effect: registers compile() with the runtime (registerRuntimeCompiler).
import './compiler/index.js'

// The entire public API of the browser runtime.
export * from './runtime-dom/index.js'

// And the compiler itself — in case you need to compile a template manually.
export { compile } from './compiler/index.js'
