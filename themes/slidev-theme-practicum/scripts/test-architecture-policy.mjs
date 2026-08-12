import ts from 'typescript'

const allowedRawExtensions = new Set(['.css', '.md'])
const projectReaderModules = new Set([
  './helpers/project-root.cjs',
  '../tests/helpers/project-root.cjs',
])
const fileSystemModules = new Set(['fs', 'fs/promises', 'node:fs', 'node:fs/promises'])
const fileSystemReaders = new Set(['readFile', 'readFileSync'])

function moduleKind(specifier) {
  if (projectReaderModules.has(specifier) || specifier.endsWith('/helpers/project-root.cjs'))
    return 'project'
  if (fileSystemModules.has(specifier))
    return 'fs'
  return undefined
}

function requireSpecifier(node) {
  return (
    ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === 'require'
    && node.arguments.length === 1
    && ts.isStringLiteral(node.arguments[0])
  )
    ? node.arguments[0].text
    : undefined
}

function readerNameAllowed(kind, name) {
  return kind === 'project'
    ? name === 'readProjectFile'
    : kind === 'fs' && fileSystemReaders.has(name)
}

function memberAccess(node) {
  if (ts.isPropertyAccessExpression(node))
    return { object: node.expression, name: node.name.text }
  if (
    ts.isElementAccessExpression(node)
    && node.argumentExpression
    && ts.isStringLiteralLike(node.argumentExpression)
  ) {
    return { object: node.expression, name: node.argumentExpression.text }
  }
  return undefined
}

function collectBindings(sourceFile) {
  const directReaders = new Set()
  const namespaces = new Map()
  const initializers = new Map()
  const declarations = []

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const kind = moduleKind(statement.moduleSpecifier.text)
      if (!kind)
        continue

      const clause = statement.importClause
      if (clause?.name)
        namespaces.set(clause.name.text, kind)
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings))
        namespaces.set(clause.namedBindings.name.text, kind)
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          const importedName = element.propertyName?.text ?? element.name.text
          if (readerNameAllowed(kind, importedName))
            directReaders.add(element.name.text)
        }
      }
    }
  }

  function visitDeclarations(node) {
    if (ts.isVariableDeclaration(node)) {
      declarations.push(node)
      if (ts.isIdentifier(node.name) && node.initializer)
        initializers.set(node.name.text, node.initializer)

      const specifier = node.initializer
        ? requireSpecifier(node.initializer)
        : undefined
      const kind = specifier ? moduleKind(specifier) : undefined

      if (kind && ts.isIdentifier(node.name))
        namespaces.set(node.name.text, kind)
      if (kind && ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          if (!ts.isIdentifier(element.name))
            continue

          const importedName = element.propertyName && ts.isIdentifier(element.propertyName)
            ? element.propertyName.text
            : element.name.text
          if (readerNameAllowed(kind, importedName))
            directReaders.add(element.name.text)
        }
      }
    }

    ts.forEachChild(node, visitDeclarations)
  }

  visitDeclarations(sourceFile)

  let changed = true
  while (changed) {
    changed = false

    for (const declaration of declarations) {
      if (!declaration.initializer)
        continue

      if (
        ts.isObjectBindingPattern(declaration.name)
        && ts.isIdentifier(declaration.initializer)
      ) {
        const kind = namespaces.get(declaration.initializer.text)
        if (!kind)
          continue

        for (const element of declaration.name.elements) {
          if (!ts.isIdentifier(element.name))
            continue

          const importedName = element.propertyName && ts.isIdentifier(element.propertyName)
            ? element.propertyName.text
            : element.name.text
          if (readerNameAllowed(kind, importedName) && !directReaders.has(element.name.text)) {
            directReaders.add(element.name.text)
            changed = true
          }
        }
        continue
      }

      if (!ts.isIdentifier(declaration.name))
        continue

      const localName = declaration.name.text
      if (directReaders.has(localName))
        continue

      if (
        ts.isIdentifier(declaration.initializer)
        && directReaders.has(declaration.initializer.text)
      ) {
        directReaders.add(localName)
        changed = true
        continue
      }

      const access = memberAccess(declaration.initializer)
      if (access) {
        const namespaceKind = ts.isIdentifier(access.object)
          ? namespaces.get(access.object.text)
          : undefined
        const requiredModule = requireSpecifier(access.object)
        const requiredKind = requiredModule ? moduleKind(requiredModule) : undefined
        const kind = namespaceKind ?? requiredKind

        if (kind && readerNameAllowed(kind, access.name)) {
          directReaders.add(localName)
          changed = true
        }
      }
    }
  }

  return { directReaders, initializers, namespaces }
}

function collectPathCandidates(node, initializers, seen = new Set()) {
  if (ts.isStringLiteralLike(node))
    return [node.text]

  if (ts.isIdentifier(node) && initializers.has(node.text) && !seen.has(node.text)) {
    seen.add(node.text)
    return collectPathCandidates(initializers.get(node.text), initializers, seen)
  }

  const candidates = []
  ts.forEachChild(node, child =>
    candidates.push(...collectPathCandidates(child, initializers, new Set(seen))))
  return candidates
}

function extensionOf(path) {
  const match = path.toLowerCase().match(/(\.[a-z0-9]+)$/u)
  return match?.[1]
}

function rawReaderKind(call, bindings) {
  if (ts.isIdentifier(call.expression) && bindings.directReaders.has(call.expression.text))
    return true

  const access = memberAccess(call.expression)
  if (!access)
    return false

  const namespaceKind = ts.isIdentifier(access.object)
    ? bindings.namespaces.get(access.object.text)
    : undefined
  const requiredModule = requireSpecifier(access.object)
  const requiredKind = requiredModule ? moduleKind(requiredModule) : undefined
  const kind = namespaceKind ?? requiredKind

  return Boolean(kind && readerNameAllowed(kind, access.name))
}

export function findDisallowedRawSourceReads(source, relativeFile = 'test.cjs') {
  const sourceFile = ts.createSourceFile(
    relativeFile,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  )
  const bindings = collectBindings(sourceFile)
  const violations = []

  function visit(node) {
    if (ts.isCallExpression(node) && rawReaderKind(node, bindings)) {
      const candidates = node.arguments[0]
        ? collectPathCandidates(node.arguments[0], bindings.initializers)
        : []
      const pathCandidates = candidates.filter(candidate => extensionOf(candidate))
      const disallowedPath = pathCandidates.find(path =>
        !allowedRawExtensions.has(extensionOf(path)))

      if (disallowedPath || pathCandidates.length === 0) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1
        violations.push(`${disallowedPath ?? '<динамический путь>'}:${line}`)
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return violations
}
