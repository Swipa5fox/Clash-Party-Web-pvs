const js = require('@eslint/js')
const react = require('eslint-plugin-react')
const reactHooks = require('eslint-plugin-react-hooks')
const importPlugin = require('eslint-plugin-import')
const { configs } = require('@electron-toolkit/eslint-config-ts')

module.exports = [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/extra/**', '**/src/native/**']
  },

  js.configs.recommended,
  ...configs.recommended,

  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: {
      react: react,
      'react-hooks': reactHooks,
      import: importPlugin
    },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      // React Hooks 规则
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Import 规则
      'import/no-duplicates': 'warn',
      'import/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'never'
        }
      ],
      // 代码质量
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'warn',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'warn'
    },
    settings: {
      react: {
        version: 'detect'
      }
    },
    languageOptions: {
      ...react.configs.recommended.languageOptions
    }
  },

  {
    files: ['**/*.cjs', '**/*.mjs', '**/tailwind.config.js', '**/postcss.config.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  },

  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn'
    }
  },

  {
    files: ['**/logger.ts'],
    rules: {
      'no-console': 'off'
    }
  }
]
