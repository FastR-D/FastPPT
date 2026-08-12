const { readFileSync } = require('node:fs')
const ts = require('typescript')

/** @typedef {NodeJS.Module & { _compile(source: string, filename: string): void }} CompilableModule */

let registered = false

function registerTypeScript() {
  if (registered)
    return

  require.extensions['.ts'] = (module, filename) => {
    const compilableModule = /** @type {CompilableModule} */ (module)
    const source = readFileSync(filename, 'utf8')
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: filename,
    })

    compilableModule._compile(outputText, filename)
  }

  registered = true
}

module.exports = { registerTypeScript }
