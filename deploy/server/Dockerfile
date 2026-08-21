FROM node:24-bookworm-slim AS node-deps
WORKDIR /build/agent-harness
COPY packages/agent-harness/package.json packages/agent-harness/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM python:3.13-slim-bookworm
ENV PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /opt/fastppt
RUN useradd --create-home --uid 10001 fastppt
COPY . .
COPY --from=node-deps /build/agent-harness/node_modules packages/agent-harness/node_modules
RUN python -m pip install --no-cache-dir ".[server,kernel,agents]"
RUN mkdir -p /var/lib/fastppt/data /var/lib/fastppt/tmp /var/lib/fastppt/exports && chown -R fastppt:fastppt /var/lib/fastppt
USER fastppt
EXPOSE 43110
HEALTHCHECK --interval=20s --timeout=4s --start-period=20s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:43110/api/v1/health', timeout=3)"
CMD ["fastppt-api"]
