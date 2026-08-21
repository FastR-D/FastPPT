# Local Deployment

Run `install.ps1`, then `start.ps1`. The service binds to `127.0.0.1:43110`,
uses SQLite, a private filesystem Artifact Store, and a persistent local queue.
Use `status.ps1` and `stop.ps1` for lifecycle management. Override data paths,
port, Agent SDK, model, and official/relay endpoint through the documented
`FASTPPT_*` environment variables; no checkout path is embedded in scripts.
