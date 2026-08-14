import eslint from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.tsbuild/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '.fastppt/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.node,
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: globals.node,
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ['**/*.config.ts'],
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: globals.node,
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ['**/*.d.ts', '**/*.d.mts', '**/*.d.css.ts'],
  },
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        projectService: true,
        extraFileExtensions: ['.vue'],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.browser,
    },
  },
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'vue/html-closing-bracket-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/singleline-html-element-content-newline': 'off',
    },
  },
  {
    files: ['themes/**/*.vue'],
    languageOptions: {
      globals: {
        ...globals.browser,
        $slidev: 'readonly',
      },
    },
    rules: {
      'vue/no-v-html': 'off',
      'vue/require-default-prop': 'off',
    },
  },
  {
    files: ['themes/**/agent/scripts/*.mjs'],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['themes/slidev-theme-practicum/**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['themes/slidev-theme-practicum/scripts/browser-smoke.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
  {
    files: ['themes/slidev-theme-practicum/**/*.{ts,vue}'],
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
      'vue/attributes-order': 'off',
      'vue/first-attribute-linebreak': 'off',
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: [
      'packages/slidewave/src/{cache,index,pres,slide,theme,types,validate}.ts',
      'packages/slidewave/src/{internal,preview,primitives,slidev,utils}/**/*.ts',
      'packages/slidewave/test/{internal,slidev}/**/*.ts',
      'packages/slidewave/test/{cache,core,pres,validate}.test.ts',
    ],
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'prefer-const': 'off',
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ['packages/slidewave/test/**/*.ts'],
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
)
