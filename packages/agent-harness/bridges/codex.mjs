import { Codex } from "@openai/codex-sdk";

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => resolve(input));
    process.stdin.on("error", reject);
  });
}

function fail(message) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
}

try {
  const request = JSON.parse(await readStdin());
  if (!request.prompt || !request.model || !request.workingDirectory) {
    throw new Error("prompt, model, and workingDirectory are required");
  }
  const client = new Codex({
    apiKey: request.apiKey || undefined,
    baseUrl: request.baseUrl || undefined,
    env: request.env || undefined,
  });
  const thread = client.startThread({
    model: request.model,
    workingDirectory: request.workingDirectory,
    skipGitRepoCheck: true,
    sandboxMode: "read-only",
    approvalPolicy: "never",
    networkAccessEnabled: false,
    webSearchMode: "disabled",
    modelReasoningEffort: request.reasoningEffort || "medium",
  });
  const turn = await thread.run(request.prompt, {
    outputSchema: request.outputSchema,
  });
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      threadId: thread.id,
      output: turn.finalResponse,
      usage: turn.usage,
    })}\n`,
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
