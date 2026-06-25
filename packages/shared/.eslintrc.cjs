module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    // No `project`/typed-linting on purpose: none of the enabled rules are
    // type-aware, and pointing at tsconfig.json (which excludes specs/.d.ts)
    // makes ESLint throw "TSConfig does not include this file" on every
    // src/**/*.spec.ts the lint glob picks up. If type-aware rules are added
    // later, introduce a lint-specific tsconfig that includes the linted files.
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
  },
  ignorePatterns: ['.eslintrc.cjs', 'dist', 'node_modules'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
};
