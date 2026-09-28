import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // e2e/: real-Chrome suites, Node scripts that log progress (see e2e/README.md).
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'e2e/**'] },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    rules: {
      // Profile data is sensitive. Plain logging is disallowed so values cannot leak
      // into console output by accident; warn/error remain for genuine failures.
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['apps/chrome-extension/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, chrome: 'readonly' },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['*.{js,ts}', '**/vite*.config.ts'],
    languageOptions: { globals: globals.node },
  },
);
