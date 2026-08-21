# Render Service

`fastppt-render-worker` runs only on Windows with Microsoft PowerPoint and
`pywin32`. It claims render-only jobs, opens the exact exported PPTX, produces
per-page PNG files, binds their hashes and the PowerPoint version to the locked
page versions, and advances the export from `validating` to `ready`. Browser or
SVG output is never registered as authoritative.

For local deployment, set `FASTPPT_RENDER_BACKEND=powerpoint`; `fastppt start`
then manages the API and Render Worker together. For a server deployment,
install `.[server,kernel,render]` on a separate Windows host, provide the same
`FASTPPT_DATABASE_URL` and S3 settings as the server stack, and run
`fastppt-render-worker`. Enable the server render backend only after its
heartbeat reports PowerPoint as ready.
