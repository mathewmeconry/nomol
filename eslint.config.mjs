import { fileURLToPath } from 'node:url';
import globals from 'globals';
import pluginJs from '@eslint/js';
import { fixupPluginRules, includeIgnoreFile } from '@eslint/compat';
import tseslint from 'typescript-eslint';
import pluginReact from 'eslint-plugin-react';
import pluginJsxA11y from 'eslint-plugin-jsx-a11y';
import pluginReactHooks from 'eslint-plugin-react-hooks';

const gitignorePath = fileURLToPath(new URL('.gitignore', import.meta.url));

// eslint-plugin-react and eslint-plugin-jsx-a11y still call context methods
// that were removed in ESLint 10 (e.g. context.getFilename()). fixupPluginRules
// shims them until the plugins ship native ESLint 10 support.
const reactRecommended = {
  ...pluginReact.configs.flat.recommended,
  plugins: { react: fixupPluginRules(pluginReact) },
};
const jsxA11yRecommended = {
  ...pluginJsxA11y.flatConfigs.recommended,
  plugins: { 'jsx-a11y': fixupPluginRules(pluginJsxA11y) },
};

export default [
  includeIgnoreFile(gitignorePath, 'Imported .gitignore patterns'),
  {
    ignores: [
      '**/tsconfig.json',
      'apps/web/react-router.config.ts',
      'apps/web/build/',
      '**/.vite/',
      '.vscode/',
      '.agents/',
      '.claude/',
      '**/*.d.ts',
      'apps/web/public/',
      '**/coverage/',
    ],
  },
  { files: ['**/*.{js,mjs,cjs,ts,jsx,tsx}'] },
  { languageOptions: { globals: globals.browser } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  reactRecommended,
  jsxA11yRecommended,
  {
    plugins: {
      'react-hooks': pluginReactHooks,
    },
    rules: pluginReactHooks.configs.recommended.rules,
  },
  { settings: { react: { version: 'detect' } } },
  {
    rules: {
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
      // Ignores eslint no-unused-vars errors if vars, args or error are prefixed with _
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // Expo config plugins and React Native's autolinking config are loaded by Node as CommonJS.
    files: ['apps/native/plugins/**/*.js', 'packages/native-modules/react-native.config.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Tests rely on partial mocks (`as any`); source files stay strict.
    files: ['**/*.test.{ts,tsx}', 'packages/core/src/tests/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
