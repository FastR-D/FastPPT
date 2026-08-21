# FastPPT repository instructions

FastPPT is an application with local and server deployment modes. It is not a
Skill package. Product code lives in `apps`, `packages`, and `services`.

- Work only on `main`; do not create product or deployment branches.
- Use the repository `.venv` for Python commands.
- Keep paths portable and reject client-supplied absolute paths.
- Keep secrets and storage keys on the server.
- Do not call files under `kernel/ppt-master/upstream` outside
  `packages/ppt-master-adapter`.
- Do not edit the upstream snapshot during normal FastPPT work. For a kernel
  update, read `kernel/ppt-master/upstream/SKILL.md`, run the integrity gate,
  apply one exact commit with `kernel/ppt-master/sync.py`, and run full tests.
- Never label SVG or browser output as a PowerPoint-authoritative preview.
- Never use an unregistered full-slide raster as editable PPTX output.
