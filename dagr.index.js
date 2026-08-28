import typescript, {
  eslint,
  library,
  prettier,
  typedoc,
  vitest,
} from '//stacks/ts//dagr.stack.js'

const IGNORE = ['node_modules', '.git', 'dist', 'docs']

const VERSIONS = {
  '@eslint/js': '9.12.0',
  '@tsconfig/strictest': '2.0.5',
  '@typescript-eslint/eslint-plugin': '8.8.1',
  '@typescript-eslint/parser': '8.8.1',
  'eslint': '9.12.0',
  'eslint-plugin-prettier': '5.2.1',
  'prettier': '3.3.3',
  'typedoc': '0.28.13',
  'typescript': '5.9.2',
  'vitest': '2.1.3',
}

const stack = typescript({
  base: 'base',
  scope: 'caeus',
  versions: VERSIONS,
  ignore: IGNORE,
  transform(index) {
    return {
      ...index,
      config: {
        base: {
          deps: [],
          run: () => ({
            FROM: 'node:22-alpine',
            steps: [
              { RUN: 'corepack enable && corepack prepare pnpm@11.23.0 --activate' },
            ],
            IGNORE,
          }),
        },
        ...index.config,
      },
    }
  },
})
  .with(library({
    runtime: 'node',
    language: 'ES2023',
    sourceMaps: true,
    assets: ['README.md', 'LICENSE'],
  }))
  .with(prettier({ semi: true, trailingComma: 'all' }))
  .with(vitest({ globals: true, typecheck: true }))
  .with(eslint({ prettier: true, explicitReturnTypes: true }))
  .with(typedoc({ title: 'Wyr' }))

export default stack({
  location: '//wyr',
  version: '0.0.0-rc2',
  metadata: {
    description: 'Deterministic dependency graphs for TypeScript.',
    repository: {
      type: 'git',
      url: 'git+https://github.com/caeus/wyr.git',
    },
    homepage: 'https://github.com/caeus/wyr#readme',
    keywords: [
      'di',
      'inversion of control container',
      'async support',
      'dependency injection',
      'dependency',
      'injection',
      'ioc',
      'container',
      'javascript',
      'typescript',
      'node',
    ],
    author: 'caeus',
    license: 'MIT',
  },
})
