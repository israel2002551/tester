import globals from 'globals';

export default [
  {
    files: ['src/**/*.js', 'scripts/**/*.mjs', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-constant-binary-expression': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error'
    }
  }
];
