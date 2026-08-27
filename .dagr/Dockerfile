FROM node:22-alpine

RUN apk add --no-cache docker-cli docker-cli-buildx git && corepack enable && corepack prepare pnpm@11.23.0 --activate

WORKDIR /dagr

# The pinned SHA is part of this layer's cache key, so bumping it here is what rebuilds dagr.
# A moving ref like `main` would cache forever and silently keep running a stale build.
RUN git clone --revision=6368f774474d6e28bf430fa995f41e7cf1b461bf --depth 1 https://github.com/caeus/dagr.git .

RUN pnpm install --frozen-lockfile && pnpm exec tsc

ENV REPO_ROOT=/repo

ENTRYPOINT ["node", "--experimental-vm-modules", "dist/index.js"]
