export class ApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code = "request_failed", status = 0) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export function requestKey(scope: string): string {
  return `web-${scope}-${crypto.randomUUID()}`;
}

export function artifactUrl(projectId: string, artifactId: string | null | undefined): string {
  return artifactId ? `/api/v1/projects/${projectId}/artifacts/${artifactId}` : "";
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`/api/v1${path}`, { credentials: "include", ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(body?.error?.message || `请求失败（${response.status}）`, body?.error?.code || "request_failed", response.status);
  }
  return body as T;
}
