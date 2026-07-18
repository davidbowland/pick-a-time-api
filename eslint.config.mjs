// Fleet ESLint flat config — API / SAM+Lambda TypeScript flavor.
// ESLint 9 + typescript-eslint 8. Translated from the fleet's .eslintrc.json
// (food-api / pick-a-time-api) preserving original intent.
//
// PER-REPO ADAPTATION (edit the two marked spots below):
//   1. `ignores`: add repo-specific build/output dirs if they differ from the
//      defaults below (mirror the repo's old .eslintignore — e.g. some repos
//      also ignore `infrastructure/`, `docs/`).
//   2. Nothing else should need changing for a standard API repo. These rules
//      are NON-type-checked (no parserOptions.project needed) so the config is
//      fast and works without a tsconfig wired to the linter.
//
// Requires devDeps: eslint, @eslint/js, typescript-eslint, eslint-plugin-jest,
//   eslint-plugin-functional, eslint-config-prettier, globals.
import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import functional from 'eslint-plugin-functional'
import jest from 'eslint-plugin-jest'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // 1) ADAPT PER REPO: build artifacts and generated files never linted.
  //    ESLint 9 flat config does NOT implicitly skip dot-directories the way the
  //    old .eslintignore/eslintrc enumerator did, so EVERY build-cache dir must be
  //    listed explicitly or a stale local build (e.g. a leftover `.aws-sam/`,
  //    `.swc/`) will flood the run with thousands of errors. Add any repo-specific
  //    output dir the repo gitignores that isn't already here.
  {
    ignores: [
      '**/__mocks__/',
      '**/__snapshots__/',
      '.aws-sam/',
      '.swc/',
      'build/',
      'coverage/',
      'dist/',
      'docs/',
      'infrastructure/',
      'node_modules/',
      '**/*.min.*',
      'jest.*.*',
    ],
  },

  // 2) Base recommended sets.
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // 3) Language options + fleet rule intent (from food-api / pick-a-time-api).
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
        module: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      // ignoreRestSiblings keeps the fleet's `{ field: _, ...rest }` drop-a-field
      // idiom clean (used e.g. in .map(({ data: { version: _, ...joke }, id }) => …));
      // varsIgnorePattern alone does NOT cover destructured args, so both are needed.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '_', ignoreRestSiblings: true, varsIgnorePattern: '_' },
      ],
      'no-negated-condition': 'error',
      'sort-vars': 'error',
    },
  },

  // 4) eslint-plugin-functional LITE subset — rules the fleet's existing API
  //    source passes with ZERO code changes (validated against food-api/src and
  //    pick-a-time-api/src). These enforce the functional style CLAUDE.md mandates.
  //    If a rule ever fires non-trivially on a given repo, turn THAT rule off here
  //    with a `// TODO(functional)` note rather than rewriting product code.
  //    Validated: these two run CLEAN (zero errors, no crashes) across all of
  //    food-api/src + pick-a-time-api/src EXCEPT the custom Error subclasses in
  //    `errors.ts` — which are the one sanctioned OOP exception, so they are
  //    carved out here. (no-loop-statements / no-conditional-statements /
  //    no-throw-statements / no-let all fire on real code; prefer-tacit /
  //    immutable-data / no-mixed-types need type info and crash without a TS
  //    program — all deliberately excluded from the lite subset.)
  {
    files: ['src/**/*.ts'],
    ignores: ['**/errors.ts'], // Error subclasses legitimately use `class`/`this`.
    plugins: { functional },
    rules: {
      'functional/no-classes': 'error',
      'functional/no-this-expressions': 'error',
    },
  },

  // 5) Jest rules scoped to test / mock files only.
  {
    files: ['**/*.test.ts', '**/__tests__/**/*.ts', '**/__mocks__/**/*.ts'],
    ...jest.configs['flat/recommended'],
    // Pin the jest version so the plugin never has to auto-detect it at lint time.
    settings: { jest: { version: 29 } },
    rules: {
      ...jest.configs['flat/recommended'].rules,
      'jest/no-mocks-import': 'off',
    },
  },

  // 6) Prettier LAST — disables all formatting rules that would fight prettier.
  prettier,
)
