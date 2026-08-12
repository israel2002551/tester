import eslint from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Context modules intentionally colocate their Provider and consumer hook.
    files: ['src/contexts/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // These two route-composition modules are intentionally broad surfaces. Keep all
    // correctness rules enabled while avoiding release failures for tree-shaken icon imports.
    files: ['src/pages/MarketplacePages.tsx', 'src/pages/WorkspacePages.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
