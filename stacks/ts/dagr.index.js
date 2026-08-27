const STACKS_COMMIT = 'b4abcd3b66f14452aa6cbae543ddbf1ba20f7917'

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
          'git sparse-checkout set ts-library',
          `git fetch --depth=1 --filter=blob:none origin ${STACKS_COMMIT}`,
          'git checkout --detach FETCH_HEAD',
        ].join(' && '),
      },
      { WORKDIR: '/src/ts-library' },
    ],
    IGNORE: [],
  },
}
