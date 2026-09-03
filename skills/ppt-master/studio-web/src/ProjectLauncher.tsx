import { useEffect, useState } from "react";
import "./ProjectLauncher.css";

type ProjectInfo = {
  projectId: string;
  projectName: string;
  projectNote?: string | null;
  createdAt: string;
  updatedAt: string;
  projectRoot: string;
  route: string;
  stage: string;
  capabilities: Record<string, boolean>;
  harnesses: { kind: string; available: boolean; status: string }[];
};

type RecentProject = { projectId: string; name: string; note?: string; path: string; createdAt: string; updatedAt: string };

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `请求失败 (${response.status})`);
  return body;
}

export function ProjectLauncher({ current, onEnter }: { current: ProjectInfo; onEnter: () => void }) {
  const [projects, setProjects] = useState<RecentProject[]>([]);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => { void request<{ projects: RecentProject[] }>("/api/projects").then((result) => setProjects(result.projects), (error) => setNotice(error.message)); }, []);

  const open = async (value: string, action: "open" | "create") => {
    setBusy(true); setNotice(action === "create" ? "正在初始化项目…" : "正在启动项目…");
    try {
      const payload = action === "create" ? { action, name: value, note: note.trim() || undefined } : { action, projectId: value };
      const result = await request<{ url: string }>("/api/projects/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      window.location.assign(result.url);
    } catch (error) { setNotice((error as Error).message); setBusy(false); }
  };

  return <div className="launcher">
    <section className="launcher-panel">
      <header><div><span className="launcher-mark">F</span><div><b>FastPPT</b><small>从主题与素材到可编辑 PPTX</small></div></div><button onClick={onEnter}>进入当前项目</button></header>
      <div className="launcher-grid">
        <article className="current-project"><small>当前项目</small><h1>{current.projectName}</h1><code>ID · {current.projectId}</code>{current.projectNote && <p>{current.projectNote}</p>}<small>最近更新 · {new Date(current.updatedAt).toLocaleString("zh-CN")}</small><small>创建时间 · {new Date(current.createdAt).toLocaleString("zh-CN")}</small><p>{current.route} · {current.stage}</p><button className="primary" onClick={onEnter}>打开工作区</button></article>
        <article className="capabilities"><small>能力检测</small>{Object.entries(current.capabilities).map(([key, available]) => <div key={key}><span>{key}</span><em className={available ? "available" : "unavailable"}>{available ? "可用" : "不可用"}</em></div>)}{current.harnesses.map((harness) => <div key={harness.kind}><span>{harness.kind}</span><em className={harness.available ? "available" : "unavailable"}>{harness.available ? harness.status : "未配置"}</em></div>)}</article>
      </div>
      <section className="recent-projects"><div><div><b>最近项目</b><small>{projects.length} 个可用工作区</small></div><button className="primary" onClick={() => { setName(""); setNote(""); setNotice(""); setCreateOpen(true); }}>＋ 新建演示文稿</button></div><div className="project-cards">{projects.map((project) => <button className="project-card" key={project.projectId} disabled={busy} onClick={() => void open(project.projectId, "open")}><span className="project-icon">F</span><strong>{project.name}</strong><code>ID · {project.projectId}</code>{project.note && <p>{project.note}</p>}<small>最近更新 · {new Date(project.updatedAt).toLocaleString("zh-CN")}</small><small>创建时间 · {new Date(project.createdAt).toLocaleString("zh-CN")}</small><i>→</i></button>)}</div>{!projects.length && <p className="launcher-empty">尚未发现 FastPPT 项目。</p>}</section>
      {notice && <footer>{notice}</footer>}
    </section>
    {createOpen && <div className="launcher-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setCreateOpen(false); }}>
      <form className="launcher-dialog" role="dialog" aria-modal="true" aria-labelledby="create-project-title" onSubmit={(event) => { event.preventDefault(); if (/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(name) && !busy) void open(name, "create"); }}>
        <header><div><h2 id="create-project-title">新建演示文稿</h2><p>创建独立的项目工作区，随后进入演示文稿工作台。</p></div><button type="button" className="dialog-close" aria-label="关闭" disabled={busy} onClick={() => setCreateOpen(false)}>×</button></header>
        <label><span>项目名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：人工智能课程" autoFocus disabled={busy}/><small>名称可以重复；FastPPT 会为每个项目生成唯一 ID。</small></label>
        <label><span>备注（可选）</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录用途、受众或其他说明" maxLength={500} disabled={busy}/></label>
        {notice && <div className="dialog-notice" role="alert">{notice}</div>}
        <footer><button type="button" disabled={busy} onClick={() => setCreateOpen(false)}>取消</button><button className="primary" type="submit" disabled={busy || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(name)}>{busy ? "正在创建…" : "创建并打开"}</button></footer>
      </form>
    </div>}
  </div>;
}
