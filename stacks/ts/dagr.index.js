const STACKS_COMMIT = 'f24b3341c9eecf71eb26ed43dcd19a384852809f'

export default {
  '/': {
    FROM: 'alpine:3.22',
    steps: [
      { RUN: 'apk add --no-cache git' },
      {
        RUN: [
          'git init /src',
          'cd /src',
          'git remote add origin https://github.com/caeus/dagr-stacks.git',
          'git sparse-checkout init --cone',
          'git sparse-checkout set typescript',
          `git fetch --depth=1 --filter=blob:none origin ${STACKS_COMMIT}`,
          'git checkout --detach FETCH_HEAD',
        ].join(' && '),
      },
      { WORKDIR: '/src/typescript' },
    ],
    IGNORE: [],
  },
}
