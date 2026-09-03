import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { PlanningEditor } from "./PlanningEditor";
import { IntakeComposer } from "./IntakeComposer";
import "./PageStatus.css";
import { CanvasViewport } from "./CanvasViewport";
import { ProjectLauncher } from "./ProjectLauncher";
import { CommandPalette, type StudioCommand } from "./CommandPalette";

type Slide = {
  id: string;
  revision: string | null;
  status?: string;
  statusLabel?: string;
};
type Message = { messageId: string; role: string; content: string };
type Region = { x: number; y: number; width: number; height: number };
type Job = { jobId: string; status: string; sessionId?: string; slide?: string };
type HarnessSession = {
  sessionId: string;
  kind: "claude" | "codex";
  purpose: string;
};
type ProjectInfo = {
  projectId: string;
  projectName: string;
  projectNote?: string | null;
  createdAt: string;
  updatedAt: string;
  projectRoot: string;
  route: string;
  stage: string;
  exportStale?: boolean | null;
  capabilities: Record<string, boolean>;
  harnesses: { kind: string; available: boolean; status: string }[];
};

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) {
    const diagnostics = [data.error, data.message, ...(String(data.stdout ?? "").split("\n").filter((line) => /\[ERROR\]|Failed|Overflow|invalid/i.test(line)).slice(-4)), ...(String(data.stderr ?? "").split("\n").filter(Boolean).slice(-3))].filter(Boolean);
    throw new Error(diagnostics.length ? [...new Set(diagnostics)].join(" · ") : `请求失败 (${response.status})`);
  }
  return data;
}

function App() {
  const [slides, setSlides] = useState<Slide[]>([]),
    [current, setCurrent] = useState<Slide>();
  const [selectedSlides, setSelectedSlides] = useState<string[]>([]),
    [messages, setMessages] = useState<Message[]>([]);
  const [conversation, setConversation] = useState("page"),
    [scope, setScope] = useState("page"),
    [provider, setProvider] = useState("codex");
  const [intent, setIntent] = useState(""),
    [selectedElement, setSelectedElement] = useState<string>(),
    [region, setRegion] = useState<Region>();
  const [status, setStatus] = useState("加载中"),
    [jobs, setJobs] = useState<Job[]>([]),
    [panel, setPanel] = useState(() => new URLSearchParams(window.location.search).get("panel") ?? "job"),
    [confirmation, setConfirmation] = useState<any>();
  const [generationSessions, setGenerationSessions] = useState<
    Record<string, string>
  >({});
  const [revisionSessions, setRevisionSessions] = useState<
    Record<string, string>
  >({});
  const [intake, setIntake] = useState<{ status: string; sessionId?: string; topic?: string; sources?: string[] }>({
    status: "empty",
  });
  const [project, setProject] = useState<ProjectInfo>();
  const [launcherOpen, setLauncherOpen] = useState(() => window.location.pathname === "/");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [validationFailed, setValidationFailed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [generationStaging, setGenerationStaging] = useState<{ jobId: string; status: string; slides: string[] } | null>(null);
  const [leftWidth, setLeftWidth] = useState(200), [rightWidth, setRightWidth] = useState(460);
  const resize = (side: "left" | "right", event: React.PointerEvent) => { const start = event.clientX, initial = side === "left" ? leftWidth : rightWidth; const move = (next: PointerEvent) => { const delta = next.clientX - start, width = Math.max(160, Math.min(480, side === "left" ? initial + delta : initial - delta)); (side === "left" ? setLeftWidth : setRightWidth)(width); }; const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); }; window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop); };
  const refreshSlides = async () => {
    const result = await api<{ slides: Slide[] }>("/api/slides");
    setSlides(result.slides);
    setCurrent(
      (active) =>
        result.slides.find((slide) => slide.id === active?.id) ??
        result.slides[0],
    );
  };
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("panel", panel);
    if (current?.id) url.searchParams.set("slide", current.id);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [panel, current?.id]);

  useEffect(() => {
    Promise.all([
      api<{ slides: Slide[] }>("/api/slides"),
      api<ProjectInfo>("/api/project"),
      api<any>("/api/workflow/confirmations"),
      api<any>("/api/workflow/intake"),
    ]).then(([result, project, workflow, currentIntake]) => {
      setSlides(result.slides);
      const requestedSlide = new URLSearchParams(window.location.search).get("slide");
      setCurrent(result.slides.find((slide) => slide.id === requestedSlide) ?? result.slides[0]);
      setProject(project);
      const canonicalPath = `/projects/${encodeURIComponent(project.projectId)}`;
      if (window.location.pathname !== "/" && window.location.pathname !== canonicalPath) window.history.replaceState(null, "", `${canonicalPath}${window.location.search}`);
      setConfirmation(workflow);
      setIntake(currentIntake?.topic ? currentIntake : { status: "empty" });
      if (currentIntake.status === "research_required" || currentIntake.status === "researching" || String(currentIntake.status).endsWith("failed")) setPanel("job");
      setStatus(
        `${project.route} · ${project.stage} · ${project.exportStale ? "导出已过期" : "导出最新"}`,
      );
      void api<any>("/api/workflow/generation/staging").then(setGenerationStaging);
    }, (error) => setStatus(`项目加载失败 · ${error.message}`));
  }, []);
  useEffect(() => {
    const sequenceKey = `fastppt-studio:${project?.projectId ?? "current"}:last-sequence`;
    const since = Number(sessionStorage.getItem(sequenceKey) ?? 0);
    let lastSequence = Number.isFinite(since) ? since : 0;
    const stream = new EventSource(`/api/events?topics=workspace&since=${Number.isFinite(since) ? since : 0}`);
    const types = [
      "job.plan_ready",
      "gate.required",
      "job.execution_started",
      "validation.started",
      "validation.failed",
      "validation.passed",
      "revision.committed",
      "export.stale",
      "export.completed",
      "job.completed",
      "job.failed",
      "run.cancel_requested",
      "run.canceled",
      "job.canceled",
      "generation.started",
      "generation.progress",
      "generation.completed",
      "generation.failed",
    ];
    const statuses: Record<string, string> = { "run.cancel_requested": "canceling", "run.canceled": "canceled", "job.canceled": "canceled" };
    const receive = (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      const sequence = Number(data.sequence);
      if (Number.isFinite(sequence)) {
        if (sequence <= lastSequence) return;
        lastSequence = sequence;
        sessionStorage.setItem(sequenceKey, String(sequence));
      }
      if (data.jobId)
        setJobs((items) =>
          items.map((job) =>
          job.jobId === data.jobId ? { ...job, status: statuses[data.type] ?? data.type, slide: data.slide ?? job.slide } : job,
          ),
        );
      if (data.type === "revision.committed") void refreshSlides();
      if (["generation.progress", "validation.failed", "generation.failed", "generation.completed", "workflow.plan_ready"].includes(data.type)) {
        void refreshSlides();
        void api<any>("/api/workflow/generation/staging").then(setGenerationStaging);
      }
      setStatus(data.type === "generation.progress" ? `正在生成 ${data.slide}（staging 可预览）` : data.type);
    };
    types.forEach((type) => stream.addEventListener(type, receive));
    stream.onerror = () => setStatus("事件流正在重连…");
    return () => stream.close();
  }, [project?.projectId]);
  useEffect(() => {
    if (current)
      api<{ messages: Message[] }>(
        conversation === "deck"
          ? "/api/conversations/deck/deck"
          : `/api/conversations/page/${current.id}`,
      ).then((result) => setMessages(result.messages));
  }, [current, conversation]);
  useEffect(() => {
    const showPlan = () => setPanel("confirm");
    window.addEventListener("studio:plan-ready", showPlan);
    return () => window.removeEventListener("studio:plan-ready", showPlan);
  }, []);
  useEffect(() => { const route = () => setLauncherOpen(window.location.pathname === "/"); window.addEventListener("popstate", route); return () => window.removeEventListener("popstate", route); }, []);
  useEffect(() => {
    const refresh = () => void refreshSlides();
    window.addEventListener("studio:generation-complete", refresh);
    return () =>
      window.removeEventListener("studio:generation-complete", refresh);
  }, []);

  async function runAgent(jobId: string) {
    setJobs((items) =>
      items.map((job) =>
        job.jobId === jobId ? { ...job, status: "executing" } : job,
      ),
    );
    try {
      await api(`/api/jobs/${jobId}/run-agent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider }),
      });
    } catch (error) {
      setJobs((items) =>
        items.map((job) =>
          job.jobId === jobId ? { ...job, status: "failed" } : job,
        ),
      );
      setStatus(`作业失败 · ${(error as Error).message}`);
    }
  }
  async function revisionSession(slideIds: string[]) {
    const purpose = scope === "region" ? "region_revision" : "page_revision";
    const sessionKey = [
      provider,
      conversation,
      purpose,
      ...slideIds.slice().sort(),
    ].join(":");
    const existing = revisionSessions[sessionKey];
    if (existing)
      return { sessionId: existing, kind: provider, purpose } as HarnessSession;
    let rootSessionId = generationSessions[provider];
    if (!rootSessionId) {
      const rootSession = await api<HarnessSession>("/api/harness/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: provider,
          purpose: "generation",
          context: { source: "studio-web" },
        }),
      });
      rootSessionId = rootSession.sessionId;
      setGenerationSessions((sessions) => ({
        ...sessions,
        [provider]: rootSessionId!,
      }));
    }
    const branch = await api<HarnessSession>(
      `/api/harness/sessions/${rootSessionId}/fork`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          purpose,
          context: { scope, conversation, slides: slideIds },
        }),
      },
    );
    setRevisionSessions((sessions) => ({
      ...sessions,
      [sessionKey]: branch.sessionId,
    }));
    return branch;
  }
  async function submit() {
    if (!current || !intent.trim()) return;
    if (!current.revision && generationStaging?.slides.includes(current.id)) {
      try {
        setStatus("正在修复最近生成的 staging…");
        const result = await api<any>(`/api/workflow/generation/${generationStaging.jobId}/repair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, intent }) });
        setIntent(""); await refreshSlides(); setGenerationStaging(null); setStatus(`生成修复完成 · ${result.slides.length} 页`);
      } catch (error) { setStatus(`生成修复失败 · ${(error as Error).message}`); }
      return;
    }
    if (conversation === "deck" && !["pages", "deck"].includes(scope))
      return setStatus("整套会话请明确选择页面集合或整套作用域");
    if (scope === "selection" && !selectedElement)
      return setStatus("请先点击 SVG 元素");
    if (scope === "region" && !region) return setStatus("请先设置区域坐标");
    const chosen =
      scope === "pages"
        ? slides.filter((slide) => selectedSlides.includes(slide.id))
        : scope === "deck"
          ? slides
          : [current];
    if (!chosen.length) return setStatus("请选择至少一页");
    const thread =
      conversation === "deck"
        ? "/api/conversations/deck/deck"
        : `/api/conversations/page/${current.id}`;
    await api(`${thread}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: intent }),
    });
    const targets = chosen.map((slide) => ({
      slide: slide.id,
      ...(scope === "selection" && slide.id === current.id
        ? {
            elementRefs: [
              { revision: slide.revision, elementId: selectedElement },
            ],
          }
        : {}),
      ...(scope === "region" && slide.id === current.id ? { region } : {}),
    }));
    if (chosen.some((slide) => !slide.revision)) return setStatus("该页面尚未生成，暂时无法创建修改任务");
    const baseRevisions = Object.fromEntries(chosen.map((slide) => [slide.id, slide.revision!]));
    const session = await revisionSession(chosen.map((slide) => slide.id));
    const job = await api<Job>("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scope,
        targets,
        baseRevisions,
        intent,
        mode: "agent",
        exportAfter: true,
        sessionId: session.sessionId,
      }),
    });
    setJobs((items) => [job, ...items]);
    setMessages((items) => [
      ...items,
      { messageId: crypto.randomUUID(), role: "user", content: intent },
    ]);
    setIntent("");
    if (job.status === "queued") void runAgent(job.jobId);
  }
  async function approve(jobId: string) {
    await api(`/api/jobs/${jobId}/approve`, { method: "POST" });
    void runAgent(jobId);
  }
  function bindCanvas(frame: HTMLIFrameElement | null) {
    if (frame)
      frame.onload = () => {
        const document = frame.contentDocument,
          svg = document?.querySelector("svg");
        if (!document || !svg) return;
        let start: DOMPoint | undefined, marquee: SVGRectElement | undefined;
        const point = (event: PointerEvent) => {
          const value = svg.createSVGPoint();
          value.x = event.clientX;
          value.y = event.clientY;
          return value.matrixTransform(svg.getScreenCTM()!.inverse());
        };
        document.addEventListener("pointerdown", (event) => {
          if (scope !== "region") return;
          event.preventDefault();
          start = point(event);
          marquee = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "rect",
          );
          Object.assign(marquee.style, {
            fill: "rgba(59,130,246,.16)",
            stroke: "#3b82f6",
            strokeWidth: "2",
            strokeDasharray: "8 5",
            pointerEvents: "none",
          });
          svg.appendChild(marquee);
        });
        document.addEventListener("pointermove", (event) => {
          if (!start || !marquee) return;
          const end = point(event),
            x = Math.min(start.x, end.x),
            y = Math.min(start.y, end.y);
          marquee.setAttribute("x", String(x));
          marquee.setAttribute("y", String(y));
          marquee.setAttribute("width", String(Math.abs(end.x - start.x)));
          marquee.setAttribute("height", String(Math.abs(end.y - start.y)));
        });
        document.addEventListener("pointerup", (event) => {
          if (!start || !marquee) return;
          const end = point(event),
            next = {
              x: Math.round(Math.min(start.x, end.x)),
              y: Math.round(Math.min(start.y, end.y)),
              width: Math.round(Math.abs(end.x - start.x)),
              height: Math.round(Math.abs(end.y - start.y)),
            };
          marquee.remove();
          marquee = undefined;
          start = undefined;
          if (next.width > 2 && next.height > 2) {
            setRegion(next);
            setStatus(`已框选 ${next.width} × ${next.height}`);
          }
        });
        document.addEventListener("click", (event) => {
          if (scope === "region") return;
          const element = (event.target as Element).closest("[id]");
          if (element) {
            setSelectedElement(element.id);
            setScope("selection");
            setStatus(`已选择 ${element.id}`);
          }
        });
      };
  }
  const validate = () =>
    api<any>("/api/validate", { method: "POST" }).then(
      (result) => { setValidationFailed(false); setStatus(result.status === "not_started" && generationStaging?.status !== "failed" ? "尚未生成页面，暂不需要检查" : `检查通过 · ${result.returncode}`); },
      (error) => { setValidationFailed(true); setStatus(`检查失败 · ${error.message}`); setPanel("job"); },
    );
  const repairGeneration = async () => {
    if (!generationStaging?.jobId) return;
    setStatus("正在调用 Agent 修复生成结果…");
    try {
      const result = await api<{ slides: string[] }>(`/api/workflow/generation/${generationStaging.jobId}/repair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, intent: "修复所有 SVG 校验错误，确保整套页面通过最终检查" }) });
      setValidationFailed(false);
      await refreshSlides();
      setGenerationStaging(null);
      setStatus(`Agent 修复完成 · ${result.slides.length} 页`);
    } catch (error) {
      setValidationFailed(true);
      setStatus(`Agent 修复失败 · ${(error as Error).message}`);
    }
  };
  const exportDeck = () => {
    if (generationStaging && !slides.some((slide) => slide.revision)) { setPanel("job"); setStatus("当前只有 staging SVG，请先输入修复要求并通过检查后再导出"); return; }
    setStatus("正在导出…");
    api<{ downloadUrl: string }>("/api/export/run", { method: "POST" }).then(
      (result) => {
        setStatus("导出完成，正在下载…");
        const link = document.createElement("a");
        link.href = result.downloadUrl;
        link.download = "";
        document.body.appendChild(link);
        link.click();
        link.remove();
      },
      (error) => setStatus(`导出失败 · ${error.message}`),
    );
  };
  const changeHistory = async (operation: "undo" | "redo") => {
    if (!current?.revision) return setStatus("当前页没有可操作的版本");
    try {
      await api(`/api/slides/${current.id}/history/${operation}`, { method: "POST" });
      await refreshSlides();
      setStatus(operation === "undo" ? "已撤销当前页" : "已重做当前页");
    } catch (error) { setStatus((error as Error).message); }
  };
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]") || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault(); void changeHistory(event.shiftKey ? "redo" : "undo");
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [current]);
  const commands: StudioCommand[] = [
    { id: "project", label: "打开项目启动页", run: () => setLauncherOpen(true) },
    { id: "validate", label: "检查当前项目", run: validate },
    { id: "export", label: "导出并下载 PPTX", run: exportDeck },
    { id: "undo", label: "撤销当前页", shortcut: "Ctrl/⌘ Z", run: () => void changeHistory("undo") },
    { id: "redo", label: "重做当前页", shortcut: "Ctrl/⌘ ⇧ Z", run: () => void changeHistory("redo") },
    { id: "conversation", label: "打开对话面板", run: () => setPanel("job") },
    { id: "planning", label: "打开规划确认", run: () => setPanel("confirm") },
    { id: "history", label: "打开版本历史", run: () => setPanel("history") },
    { id: "exports", label: "打开导出历史", run: () => setPanel("exports") },
    { id: "sidecars", label: "打开附属内容", run: () => setPanel("sidecar") },
    { id: "notes", label: "打开讲稿编辑", run: () => setPanel("notes") },
  ];

  return (
    <div className={`shell${leftCollapsed ? " left-collapsed" : ""}${rightCollapsed ? " right-collapsed" : ""}`} style={{ "--left-width": `${leftWidth}px`, "--right-width": `${rightWidth}px` } as React.CSSProperties}>
      <header>
        <button className="project-home" onClick={() => { window.history.pushState(null, "", "/"); setLauncherOpen(true); }}>
          {project?.projectName ?? "FastPPT"}
        </button>
        <span>{status.replace("unknown", "待开始").replace("topic_research", "主题研究")}</span>
        {confirmation?.stage && confirmation.stage !== "studio" && (
          <em>
            {confirmation.stage} ·{" "}
            {confirmation.confirmed ? "已确认" : "等待确认"}
          </em>
        )}
        <button onClick={validate}>检查</button>
        {validationFailed && <><button className="primary" onClick={validate}>重新检查</button>{generationStaging?.jobId && <button className="primary" onClick={() => void repairGeneration()}>修复</button>}</>}
        <button onClick={() => void changeHistory("undo")} title="撤销当前页 (Ctrl/Cmd+Z)">撤销</button>
        <button onClick={() => void changeHistory("redo")} title="重做当前页 (Ctrl/Cmd+Shift+Z)">重做</button>
        <button onClick={exportDeck}>导出</button>
      </header>
      <aside className="slides"><span className="resize-handle left-handle" onPointerDown={(event) => resize("left", event)} onDoubleClick={() => setLeftWidth(200)} aria-label="调整页面栏宽度" />
        {slides.map((slide) => (
          <div className="slideRow" key={slide.id}>
            <input
              type="checkbox"
              checked={selectedSlides.includes(slide.id)}
              onChange={(event) =>
                setSelectedSlides((items) =>
                  event.target.checked
                    ? [...items, slide.id]
                    : items.filter((id) => id !== slide.id),
                )
              }
            />
            <button
              className={slide.id === current?.id ? "active" : ""}
              onClick={() => {
                setCurrent(slide);
                setSelectedElement(undefined);
              }}
            >
              <span className="slide-preview">
                {slide.revision ? (
                  <img
                    src={`/api/slides/${slide.id}/raw?revision=${encodeURIComponent(slide.revision)}`}
                    alt={`${slide.id} 缩略图`}
                  />
                ) : (
                  <span>{slide.id}</span>
                )}
              </span>
              <span className="slide-meta">
                {slide.id}
                <small
                  className={`page-status status-${slide.status ?? "ungenerated"}`}
                >
                  {slide.statusLabel ??
                    (slide.revision ? slide.revision.slice(7, 15) : "未生成")}
                </small>
              </span>
            </button>
          </div>
        ))}
        {!slides.length && (
          <div className="empty">
            <b>暂无页面</b>
            <p>请先生成或导入一个项目。</p>
          </div>
        )}
      </aside>
      <main>
        {generationStaging?.slides.includes(current?.id ?? "") && !current?.revision ? (
          <div className="staging-canvas"><small>最近生成 staging · {generationStaging.status}</small><iframe title={`${current?.id} staging SVG`} src={`/api/jobs/${generationStaging.jobId}/staging/${current?.id}/raw`} /></div>
        ) : current?.revision ? (
          <CanvasViewport
            slideId={current.id}
            revision={current.revision}
            tool={scope}
            bindCanvas={bindCanvas}
            onRegion={(value) => { setRegion(value); setScope("region"); setStatus(`已框选区域 ${Math.round(value.width)} × ${Math.round(value.height)}`); }}
          />
        ) : (
          <div className="empty">
            <b>
              {current ? `${current.id} 尚未生成` : "欢迎使用 FastPPT"}
            </b>
            <p>
              {current
                ? "确认规划并生成页面后，SVG 预览会显示在这里。"
                : "当前项目还没有页面。请先输入主题或导入素材。"}
            </p>
          </div>
        )}
      </main>
      <section className="chat"><span className="resize-handle right-handle" onPointerDown={(event) => resize("right", event)} onDoubleClick={() => setRightWidth(360)} aria-label="调整对话栏宽度" />
        <nav>
          {[
            ["job", "对话"],
            ["confirm", "确认"],
            ["history", "版本"],
            ["exports", "导出"],
            ["memory", "记忆"],
            ["sidecar", "附属"],
            ["notes", "讲稿"],
          ].map(([id, label]) => (
            <button key={id} onClick={() => setPanel(id)}>
              {label}
            </button>
          ))}
        </nav>
        {(intake.status === "empty" || project?.stage === "topic_research" || intake.status.endsWith("failed")) && (
          <div className="workspace-intake">
            <IntakeComposer initialTopic={intake.topic} initialSources={intake.sources} onStatus={setStatus} onCreated={(created) => { setIntake(created); setPanel("confirm"); }} />
          </div>
        )}
        {intake.status !== "empty" && panel === "job" && (
          <>
            <div className="messages">
              {messages.map((message) => (
                <p key={message.messageId} className={message.role}>
                  {message.content}
                </p>
              ))}
              {selectedElement && (
                <article>
                  <b>当前选择</b>
                  <small>{selectedElement}</small>
                </article>
              )}
              {jobs.map((job) => (
                <JobCard
                  key={job.jobId}
                  job={job}
                  approve={approve}
                  retry={runAgent}
                />
              ))}
            </div>
            <label>
              会话
              <select
                value={conversation}
                onChange={(event) => {
                  const value = event.target.value;
                  setConversation(value);
                  if (value === "deck" && !["pages", "deck"].includes(scope))
                    setScope("");
                  else if (value === "page" && !scope) setScope("page");
                }}
              >
                <option value="page">本页</option>
                <option value="deck">整套</option>
              </select>
            </label>
            <label>
              Agent
              <select
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
              >
                <option value="codex">Codex</option>
                <option value="claude">Claude</option>
              </select>
            </label>
            <label>
              作用域
              <select
                value={scope}
                onChange={(event) => { const value = event.target.value; setScope(value); if (value === "region") setStatus("请在画布上拖拽框选区域"); }}
              >
                <option value="" disabled>
                  请选择作用域
                </option>
                {conversation === "page" && (
                  <>
                    <option value="page">本页</option>
                    <option value="selection">所选元素</option>
                    <option value="region">框选区域</option>
                  </>
                )}
                <option value="pages">勾选页面</option>
                <option value="deck">整套</option>
              </select>
            </label>
            {scope === "region" && (
              <RegionInputs value={region} onChange={setRegion} />
            )}
            <textarea
              value={intent}
              onChange={(event) => setIntent(event.target.value)}
              placeholder="描述修改意图"
            />
            <button onClick={submit}>{!current?.revision && generationStaging?.slides.includes(current?.id ?? "") ? "修复生成结果并重新检查" : "创建并执行修改作业"}</button>
          </>
        )}
        {intake.status !== "empty" && panel === "confirm" && <Confirmation onStatus={setStatus} />}{" "}
        {intake.status !== "empty" && panel === "history" && (
          <History slide={current} onRestored={refreshSlides} />
        )}{" "}
        {intake.status !== "empty" && panel === "exports" && <ExportHistory />}
        {intake.status !== "empty" && panel === "memory" && <Memory />}
        {intake.status !== "empty" && panel === "sidecar" && <Sidecars />}
        {intake.status !== "empty" && panel === "notes" && <NotesEditor />}
      </section>
      {launcherOpen && project && (
        <ProjectLauncher
          current={project}
          onEnter={() => { setLauncherOpen(false); const url = new URL(window.location.href); url.pathname = `/projects/${encodeURIComponent(project.projectId)}`; window.history.pushState(null, "", `${url.pathname}${url.search}`); }}
        />
      )}
      <CommandPalette commands={commands} />
    </div>
  );
}

function ExportHistory() {
  const [items, setItems] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    api<{ exports: any[] }>("/api/export/history").then((result) => {
      setItems(result.exports);
      setLoaded(true);
    });
  }, []);
  return (
    <div className="cards export-history">
      {loaded && !items.length && (
        <article className="empty"><b>暂无导出记录</b><p>成功或失败的 PPTX 导出会记录在这里。</p></article>
      )}
      {items.map((item) => (
        <article key={item.historyId}>
          <b>{item.status === "completed" ? "导出成功" : "导出失败"}</b>
          <small>{new Date(item.recordedAt ?? item.timestamp).toLocaleString("zh-CN")}</small>
          <small>版本 · <span title={item.deckRevision ?? "未知"}>{item.deckRevision ? item.deckRevision.slice(0, 10) : "未知"}</span></small>
          {item.status === "completed" && item.historyId && <a className="button-link" href={`/api/export/history/${encodeURIComponent(item.historyId)}/download`}>下载此版本</a>}
          {item.status !== "completed" && item.stderr && <pre>{item.stderr}</pre>}
        </article>
      ))}
    </div>
  );
}

function RegionInputs({
  value,
  onChange,
}: {
  value?: Region;
  onChange: (value: Region) => void;
}) {
  const current = value ?? { x: 0, y: 0, width: 100, height: 100 };
  return (
    <div className="region">
      {(["x", "y", "width", "height"] as const).map((key) => (
        <label key={key}>
          {key}
          <input
            type="number"
            min={key === "width" || key === "height" ? 1 : undefined}
            value={current[key]}
            onChange={(event) =>
              onChange({ ...current, [key]: Number(event.target.value) })
            }
          />
        </label>
      ))}
    </div>
  );
}
function JobCard({
  job,
  approve,
  retry,
}: {
  job: Job;
  approve: (id: string) => Promise<void>;
  retry: (id: string) => Promise<void>;
}) {
  const [diff, setDiff] = useState<any>();
  const [compare, setCompare] = useState<any>();
  const loadDiff = () => api<any>(`/api/jobs/${job.jobId}/diff`).then(setDiff);
  const cancel = async () => {
    await api(`/api/jobs/${job.jobId}/cancel`, { method: "POST" });
  };
  const cancelable = [
    "queued",
    "waiting_workflow",
    "awaiting_approval",
    "approved",
    "executing",
    "validating",
    "committing",
    "exporting",
    "summarizing",
    "failed",
  ].includes(job.status);
  const statusLabels: Record<string, string> = { queued: "排队中", waiting_workflow: "等待生成流程", awaiting_approval: "等待批准", approved: "已批准", executing: "Agent 正在修改", validating: "正在检查", committing: "正在提交", exporting: "正在导出", summarizing: "正在整理结果", failed: "执行失败", completed: "已完成", canceling: "正在取消", canceled: "已取消", "generation.progress": "页面已生成，等待整套检查", "validation.failed": "检查失败，可继续修复" };
  return (
    <article>
      <b>{statusLabels[job.status] ?? job.status}</b>
      <small>{job.jobId}</small>
      {job.slide && ["generation.progress", "validation.failed"].includes(job.status) && <iframe className="staging-preview" title={`${job.slide} staging 预览`} src={`/api/jobs/${job.jobId}/staging/${job.slide}/raw?ts=${Date.now()}`} />}
          <button onClick={loadDiff}>查看差异</button>
      {job.status === "awaiting_approval" && (
        <button onClick={() => approve(job.jobId)}>批准并执行</button>
      )}
      {job.status === "failed" && (
        <button onClick={() => retry(job.jobId)}>从 staging 重试</button>
      )}
      {cancelable && <button onClick={cancel}>取消作业</button>}
      {diff?.slides?.map((slide: any) => (
        <details key={slide.slide}>
          <summary>
            {slide.slide} ·{" "}
            {!diff.settled
              ? "Agent 正在处理"
              : slide.available
                ? slide.changed
                  ? "已变化"
                  : "未产生修改"
                : "尚无 staging"}
          </summary>
            {diff.settled && slide.available && (
              <>
                <div className="diff">
                  <pre>{slide.before}</pre>
                  <pre>{slide.after}</pre>
                </div>
                {slide.changed && <button onClick={() => setCompare(slide)}>对照预览</button>}
              </>
            )}
        </details>
      ))}
      {compare && <div className="visual-diff" role="dialog" aria-label="修改前后预览"><header><b>{compare.slide} 修改前后</b><button onClick={() => setCompare(undefined)}>关闭</button></header><div className="visual-diff-grid"><article><small>修改前 · {compare.beforeRevision}</small><iframe title={`${compare.slide} 修改前`} srcDoc={compare.before}/></article><article><small>修改后 · {compare.afterRevision}</small><iframe title={`${compare.slide} 修改后`} srcDoc={compare.after}/></article></div></div>}
    </article>
  );
}
function Confirmation({ onStatus }: { onStatus: (value: string) => void }) {
  const [payload, setPayload] = useState(""),
    [session, setSession] = useState<any>(),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    Promise.all([
      api<any>("/api/workflow/confirm/session"),
      api<any>("/api/workflow/confirm/recommendations"),
    ]).then(
      ([nextSession, recommendations]) => {
        setSession(nextSession);
        setPayload(JSON.stringify(recommendations, null, 2));
      },
      () => { setSession({ current_stage: "studio" }); setPayload("{}"); },
    );
  }, []);
  const submit = async () => {
    setBusy(true);
    try {
      const result = await api<any>("/api/workflow/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload.trim() || "{}",
      });
      onStatus(`确认已提交 · ${result.stage ?? result.status}，正在生成整套…`);
      const generated = await api<any>("/api/workflow/generate-all", {
        method: "POST",
      });
      onStatus(`整套生成完成 · ${generated.slides.length} 页`);
      window.dispatchEvent(
        new CustomEvent("studio:generation-complete", { detail: generated }),
      );
    } catch (error) {
      const message = (error as Error).message;
      onStatus(`确认或生成失败 · ${message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="confirm">
      <PlanningEditor onStatus={onStatus} />
      {session?.current_stage && session.current_stage !== "studio" && <small>{session.current_stage}</small>}
      <button className="primary" disabled={busy} onClick={submit}>
        {busy ? "确认并生成中…" : "确认并生成整套"}
      </button>
    </div>
  );
}
function History({
  slide,
  onRestored,
}: {
  slide?: Slide;
  onRestored: () => Promise<void>;
}) {
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => {
    if (slide)
      Promise.all([api<any>(`/api/slides/${slide.id}/revisions`), api<any>(`/api/slides/${slide.id}/staging-revisions`)]).then(([committed, staging]) => setItems([...committed.revisions, ...staging.revisions].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))));
  }, [slide]);
  const restore = async (item: any) => {
    if (slide && window.confirm(`恢复 ${slide.id} 到${item.label}？`)) {
      await api(`/api/slides/${slide.id}/revisions/${item.id}/restore`, {
        method: "POST",
      });
      await onRestored();
    }
  };
  return (
    <div className="cards">
      {items.map((item) => (
        <article key={item.id}>
          <b>{item.label}</b>
          <small>{new Date(item.createdAt).toLocaleString("zh-CN")}</small>
          {item.kind === "staging" ? <iframe className="staging-preview" title={`${slide?.id} ${item.label}`} src={item.previewUrl}/> : <button onClick={() => restore(item)}>恢复此版本</button>}
        </article>
      ))}
    </div>
  );
}
function Memory() {
  const [items, setItems] = useState<any[]>([]),
    [loaded, setLoaded] = useState(false);
  const refresh = () =>
    api<any>("/api/memory/candidates").then((result) => {
      const latest = new Map<string, any>();
      result.candidates.forEach((item: any) =>
        latest.set(item.candidateId, item),
      );
      setItems([...latest.values()]);
      setLoaded(true);
    });
  useEffect(() => {
    void refresh();
  }, []);
  const decide = async (id: string, decision: string) => {
    await api(`/api/memory/candidates/${id}/${decision}`, { method: "POST" });
    await refresh();
  };
  return (
    <div className="cards">
      {loaded && !items.length && (
        <article className="empty">
          <b>暂无项目记忆</b>
          <p>Agent 修改通过检查并成功提交后，系统会生成可审核的记忆候选。</p>
        </article>
      )}
      {items.map((item) => (
        <article key={item.candidateId}>
          <b>{item.trigger}</b>
          <p>{item.lesson}</p>
          <small>
            {item.scope} · {item.status}
          </small>
          {item.status === "proposed" && (
            <>
              <button onClick={() => decide(item.candidateId, "accept")}>
                接受
              </button>
              <button onClick={() => decide(item.candidateId, "reject")}>
                拒绝
              </button>
            </>
          )}
          {item.status === "accepted" && (
            <button onClick={() => decide(item.candidateId, "withdraw")}>
              撤回
            </button>
          )}
        </article>
      ))}
    </div>
  );
}
function NotesEditor() {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [roster, setRoster] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  useEffect(() => { api<any>("/api/accessories/notes").then((result) => { setRoster(result.roster); setNotes(result.notes); }, (error) => setNotice(error.message)); }, []);
  const save = async () => { try { await api("/api/accessories/notes", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ notes }) }); setNotice("讲稿已保存，当前导出已标记为过期"); } catch (error) { setNotice((error as Error).message); } };
  const generate = async (slide?: string) => { try { await api("/api/accessories/notes/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(slide ? { slide } : {}) }); const result = await api<any>("/api/accessories/notes"); setNotes(result.notes); setNotice(slide ? `${slide} 讲稿已生成` : "全部讲稿已生成"); } catch (error) { setNotice((error as Error).message); } };
  return <div className="cards notes-panel"><div className="notes-actions"><button className="primary" onClick={() => void generate()}>创建全部讲稿</button>{roster.length > 0 && <button onClick={() => void generate(roster[0])}>生成当前页讲稿</button>}</div>{!roster.length && <article className="empty"><b>暂无页面讲稿</b><p>生成页面后可为每页填写讲稿。</p></article>}{roster.map((slide) => <article key={slide}><b>{slide}</b><button onClick={() => void generate(slide)}>生成本页</button><textarea aria-label={`${slide} 讲稿`} value={notes[slide] ?? ""} onChange={(event) => setNotes({ ...notes, [slide]: event.target.value })} placeholder="输入本页讲稿" /></article>)}{roster.length > 0 && <button className="primary" onClick={() => void save()}>保存全部讲稿</button>}{notice && <small className="sidecar-notice">{notice}</small>}</div>;
}

function Sidecars() {
  const [items, setItems] = useState<any[]>([]),
    [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<any>();
  const [content, setContent] = useState("");
  const [revision, setRevision] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    api<any>("/api/sidecars").then((result) => {
      setItems(result.items);
      setLoaded(true);
    });
  }, []);
  const open = async (item: any) => {
    if (item.type !== "file") return setNotice("目录内容请通过对应讲稿或音频工作流管理");
    try {
      const result = await api<any>(`/api/sidecar-content?name=${encodeURIComponent(item.name)}`);
      setSelected({ ...item, editable: result.editable }); setContent(result.content); setRevision(result.revision); setNotice("");
    } catch (error) { setNotice((error as Error).message); }
  };
  const save = async () => {
    if (!selected?.editable) return;
    try {
      const result = await api<any>(`/api/sidecars/${encodeURIComponent(selected.name)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ content, revision }) });
      setRevision(result.revision); setNotice("已保存，当前导出已标记为过期");
    } catch (error) { setNotice((error as Error).message); }
  };
  return (
    <div className="cards sidecar-panel">
      {loaded && !items.length && (
        <article className="empty">
          <b>暂无附属内容</b>
          <p>动画、页面计划、讲稿或音频生成后会显示在这里。</p>
        </article>
      )}
      {items.map((item) => (
        <article key={item.name}>
          <b>{item.name}</b>
          <small>
            {item.type} · {item.updatedAt}
          </small>
          <button onClick={() => void open(item)}>{item.editable ? "查看并编辑" : "查看"}</button>
        </article>
      ))}
      {selected && <section className="sidecar-editor"><header><b>{selected.name}</b><button onClick={() => setSelected(undefined)}>关闭</button></header><textarea value={content} readOnly={!selected.editable} onChange={(event) => setContent(event.target.value)} spellCheck={false}/>{selected.editable && <button className="primary" onClick={() => void save()}>保存 JSON</button>}</section>}
      {notice && <small className="sidecar-notice">{notice}</small>}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
