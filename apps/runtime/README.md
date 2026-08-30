# Runtime Entry Points

`fastppt_runtime` is the shared composition root for local and server modes.
It validates configuration before startup, injects SQLite/filesystem or
PostgreSQL/S3 implementations, and exposes the selected mode in health data.
Server mode fails closed when database, object storage, authentication, CORS,
or production agent settings are absent.
