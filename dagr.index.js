import typescript from '//stacks/ts//dagr.stack.js'
import { writeJson, writeYaml } from '//stacks/ts//dagr.file_utils.js'

const IGNORE = ['node_modules', '.git', 'dist', 'docs']

const VERSIONS = {
  '@eslint/eslintrc': '3.1.0',
  '@eslint/js': '9.12.0',
  '@tsconfig/strictest': '2.0.5',
  '@types/node': '22.7.5',
  '@typescript-eslint/eslint-plugin': '8.8.1',
  '@typescript-eslint/parser': '8.8.1',
  'eslint': '9.12.0',
  'eslint-config-prettier': '9.1.0',
  'eslint-plugin-prettier': '5.2.1',
  'prettier': '3.3.3',
  'typedoc': '0.28.13',
  'typescript': '5.9.2',
  'vitest': '2.1.3',
}

const TSCONFIG = {
  extends: '@tsconfig/strictest/tsconfig.json',
  include: ['src/**/*.ts'],
  compilerOptions: {
    target: 'ES2023',
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    rootDir: 'src',
    outDir: 'dist',
    sourceMap: true,
    inlineSources: true,
    esModuleInterop: true,
    forceConsistentCasingInFileNames: true,
    useUnknownInCatchVariables: true,
    skipLibCheck: true,
    noEmit: true,
    types: ['vitest/globals'],
  },
}

const TSCONFIG_BUILD = {
  extends: './tsconfig.json',
  compilerOptions: {
    declaration: true,
    noEmit: false,
  },
  include: ['src/**/*.ts'],
  exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
}

const PRETTIER = {
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
}

const stack = typescript({
  base: 'base',
  scope: 'caeus',
  versions: VERSIONS,
  ignore: IGNORE,
  tsconfig: TSCONFIG,
  prettier: PRETTIER,
  transform(index) {
    const manifest = index.config.manifest
    const manifestRun = manifest.run

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
        manifest: {
          ...manifest,
          run: context => {
            const recipe = manifestRun(context)
            return {
              ...recipe,
              steps: [
                ...recipe.steps,
                writeJson('/repo/tsconfig.build.json', TSCONFIG_BUILD),
                writeYaml('/repo/pnpm-workspace.yaml', {
                  allowBuilds: { esbuild: true },
                }),
              ],
            }
          },
        },
      },
      ci: {
        ...index.ci,
        typecheck: {
          deps: ['build'],
          run: ({ images }) => ({
            FROM: images.build,
            steps: [
              { WORKDIR: '/repo' },
              { RUN: 'pnpm exec tsc -p tsconfig.build.json --noEmit' },
            ],
            IGNORE,
          }),
        },
        lint: {
          deps: ['install'],
          run: ({ images }) => ({
            FROM: images.install,
            steps: [
              { COPY: { src: 'src', dest: '/repo/src' } },
              { COPY: { src: 'eslint.config.mjs', dest: '/repo/eslint.config.mjs' } },
              { WORKDIR: '/repo' },
              { RUN: "pnpm exec eslint 'src/**/*.ts'" },
            ],
            IGNORE,
          }),
        },
        test: {
          deps: ['install'],
          run: ({ images }) => ({
            FROM: images.install,
            steps: [
              { COPY: { src: 'src', dest: '/repo/src' } },
              { COPY: { src: 'vitest.config.ts', dest: '/repo/vitest.config.ts' } },
              { WORKDIR: '/repo' },
              { RUN: 'pnpm exec vitest run' },
            ],
            IGNORE,
          }),
        },
        build: {
          deps: ['install', 'lint', 'test'],
          run: ({ images }) => ({
            FROM: images.install,
            steps: [
              { COPY: { src: 'src', dest: '/repo/src' } },
              { COPY: { src: 'README.md', dest: '/repo/README.md' } },
              { COPY: { src: 'LICENSE', dest: '/repo/LICENSE' } },
              { WORKDIR: '/repo' },
              { RUN: 'pnpm exec tsc -p tsconfig.build.json' },
            ],
            IGNORE,
          }),
        },
        docs: {
          deps: ['build'],
          run: ({ images }) => ({
            FROM: images.build,
            steps: [
              { COPY: { src: 'typedoc.json', dest: '/repo/typedoc.json' } },
              { WORKDIR: '/repo' },
              { RUN: 'pnpm exec typedoc --tsconfig tsconfig.build.json' },
            ],
            IGNORE,
            EXPORT: { '/repo/docs/': 'docs/' },
          }),
        },
      },
    }
  },
})

// The current stack infers npm names from non-root logical locations. Supplying //wyr gives the
// root package its real npm identity without coupling the mounted stack to this repository.
export default stack({
  location: '//wyr',
  version: '0.0.0-rc1',
  deps: [
    { npm: '@eslint/eslintrc', at: 'dev' },
    { npm: '@eslint/js', at: 'dev' },
    { npm: '@types/node', at: 'dev' },
    { npm: '@typescript-eslint/eslint-plugin', at: 'dev' },
    { npm: '@typescript-eslint/parser', at: 'dev' },
    { npm: 'eslint', at: 'dev' },
    { npm: 'eslint-config-prettier', at: 'dev' },
    { npm: 'eslint-plugin-prettier', at: 'dev' },
    { npm: 'prettier', at: 'dev' },
    { npm: 'typedoc', at: 'dev' },
    { npm: 'vitest', at: 'dev' },
  ],
  packageJson: {
    description: 'Deterministic dependency graphs for TypeScript.',
    private: false,
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
    files: ['dist/index.js', 'dist/index.d.ts', 'LICENSE', 'README.md'],
    author: 'caeus',
    license: 'MIT',
  },
})
