const js = require('@eslint/js');
const globals = require('globals');
const prettierPlugin = require('eslint-plugin-prettier');

module.exports = [
  {
    ignores: ['node_modules/**', '.husky/**', 'public/**', 'dist/**', 'coverage/**']
  },
  {
    ...js.configs.recommended,
    files: ['**/*.js'],
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      globals: {
        ...globals.node
      },
      ecmaVersion: 2021,
      sourceType: 'script'
    },
    plugins: {
      prettier: prettierPlugin
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-console': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'prettier/prettier': 'error'
    }
  }
];
