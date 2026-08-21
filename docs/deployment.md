# Deployment and upgrade

## Local

Run `deploy/local/install.ps1` once and use the start, status, and stop scripts.
Back up the configured data and export directories before upgrading. Pull the
new `main`, rerun `install.ps1`, run `tools/test.ps1`, then start the service.
SQLite and Artifact files remain under the configured data directory.

## Server

Store the server environment file outside Git. Back up PostgreSQL and the S3
bucket before rebuilding. Pull the accepted `main` commit, run the test and
configuration gates, build the `fastppt:1.0.0` image, then use Compose rolling
restart. API and Worker must use the same image and environment contract.

The Compose profile intentionally starts with authoritative rendering disabled.
Install the Render Worker on a separate Windows host with PowerPoint and the
server storage/database configuration, then set `FASTPPT_RENDER_BACKEND` only
after its heartbeat is healthy.
