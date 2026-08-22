# FastPPT Web

The v1.1.0 frontend source lives in `src/` and is a React + TypeScript + Vite
application. Run `npm install` and `npm run build` from this directory for the
production bundle. The Python runtime continues to serve `public/` as a
dependency-free fallback during local development and API contract tests; it
must not be treated as a second domain implementation.

The browser receives project state and redacted Provider Profiles only. Agent
and image secrets stay in the runtime service.
