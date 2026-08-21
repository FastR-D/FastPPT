# FastPPT Security Policy

Report vulnerabilities privately to the maintainers of
<https://github.com/FastR-D/FastPPT>. Do not include production documents,
credentials, session cookies, storage keys, or personal information in public
issues.

FastPPT treats uploads, document text, model input, model output, archive
members, remote endpoints, and filenames as untrusted. Server deployments must
use TLS, explicit CORS origins, session authentication, PostgreSQL, S3-compatible
object storage, and server-only secrets. The deterministic test Agent is not a
production option.
