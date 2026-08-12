import { inject, provide } from 'vue'

const textFitScopeKey = Symbol('theme-text-fit-scope')

export function provideTextFitScope() {
  const scope = `theme-text-fit-${Math.random().toString(36).slice(2, 10)}`
  provide(textFitScopeKey, scope)
  return scope
}

export function useTextFitScope() {
  return inject(textFitScopeKey, '')
}
