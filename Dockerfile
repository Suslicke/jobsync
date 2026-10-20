# Codex CLI, for the "Codex CLI (ChatGPT plan)" AI provider. Version and the
# SHA-256 of both archives change together. codex-code-mode-host is a separate
# archive of the same release: without it Codex prints an `error` event before
# the turn, and every answer is refused as invalid output.
ARG CODEX_VERSION=0.162.0
ARG CODEX_SHA256=8daf67f6261161aa5939d8d42a516032d760406216779d7ce6040f242140ff73
ARG CODEX_HOST_SHA256=dee8bf3df637c68e1495b928d643b76d4ad44f94e4f0ed79fe8482fa79e23d97

FROM scratch AS codex-archive
ARG CODEX_VERSION
ARG CODEX_SHA256
ARG CODEX_HOST_SHA256
# ponytail: amd64 only, which is what the server runs. An arm64 host needs the
# aarch64 archives and their checksums.
ADD --checksum=sha256:${CODEX_SHA256} \
    https://github.com/openai/codex/releases/download/rust-v${CODEX_VERSION}/codex-x86_64-unknown-linux-musl.tar.gz \
    /codex.tar.gz
ADD --checksum=sha256:${CODEX_HOST_SHA256} \
    https://github.com/openai/codex/releases/download/rust-v${CODEX_VERSION}/codex-code-mode-host-x86_64-unknown-linux-musl.tar.gz \
    /codex-code-mode-host.tar.gz

FROM node:20.20.2-alpine AS base

# Install dependencies only when needed
FROM base AS deps

RUN apk add --no-cache libc6-compat
# Set the working directory
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json package-lock.json* ./
RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV DATABASE_URL=file:/data/dev.db

# Generate Prisma client
RUN npx prisma generate

RUN npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

# Set environment variables
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 -h /home/nextjs nextjs

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Set up /data directory with the right permissions
RUN mkdir -p /data/files/resumes && chown -R nextjs:nodejs /data/files/resumes

# bubblewrap is the Linux sandbox behind `codex exec -s read-only`. The sign-in
# lives in CODEX_HOME, a volume of its own: `codex login` once, then it renews.
RUN --mount=type=bind,from=codex-archive,source=/codex.tar.gz,target=/tmp/codex.tar.gz \
    --mount=type=bind,from=codex-archive,source=/codex-code-mode-host.tar.gz,target=/tmp/codex-code-mode-host.tar.gz \
    apk add --no-cache bubblewrap \
    && mkdir /tmp/codex \
    && tar -xzf /tmp/codex.tar.gz -C /tmp/codex \
    && tar -xzf /tmp/codex-code-mode-host.tar.gz -C /tmp/codex \
    && install -m 0755 /tmp/codex/codex-code-mode-host-*-unknown-linux-musl /usr/local/bin/codex-code-mode-host \
    && rm /tmp/codex/codex-code-mode-host-*-unknown-linux-musl \
    && install -m 0755 /tmp/codex/codex-*-unknown-linux-musl /usr/local/bin/codex \
    && rm -rf /tmp/codex \
    && install -d -o nextjs -g nodejs -m 0700 /home/nextjs/.codex
ENV CODEX_HOME=/home/nextjs/.codex

# Gemini CLI, for the "Gemini CLI (Google account)" provider. A Node package,
# so it rides on the image's own Node. The sign-in lives in GEMINI_CLI_HOME
# (a volume): `NO_BROWSER=true gemini` once, then it renews itself.
ARG GEMINI_CLI_VERSION=0.65.0
RUN npm install -g --no-audit --no-fund @google/gemini-cli@${GEMINI_CLI_VERSION} \
    && npm cache clean --force \
    && install -d -o nextjs -g nodejs -m 0700 /home/nextjs/gemini
ENV GEMINI_CLI_HOME=/home/nextjs/gemini

COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3737

ENV PORT=3737

ENTRYPOINT ["/app/docker-entrypoint.sh"]
