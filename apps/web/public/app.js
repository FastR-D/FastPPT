const state = {
  projects: [], project: null, pages: [], page: null, documents: [], versions: [],
  facts: [], conflicts: [], assets: [], plans: [], operations: [], jobs: [], usage: [], exports: [],
  selectedPageIds: new Set(), compareVersionIds: new Set(), inspector: "sources", preview: "visual",
  scope: "single", pendingPlan: null, deploymentMode: "local", showArchived: false,
  eventSeq: 0, eventTimer: null, eventPolling: false, selectedImage: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const terminalOperations = new Set(["completed", "partial", "failed", "cancelled", "rolled_back"]);
const terminalExports = new Set(["ready", "degraded", "failed"]);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const shortId = (value) => value ? value.slice(-8) : "-";
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const displayValue = (value) => typeof value === "object" ? JSON.stringify(value, null, 2) : String(value ?? "-");

async function api(path, options = {}) {
  const response = await fetch(`/api/v1${path}`, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("json") ? await response.json() : await response.blob();
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = payload?.error?.code;
    throw error;
  }
  return payload;
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("visible"), 3000);
}

function setSaveState(message = "已保存") {
  $("#save-state").textContent = message;
}

function setProjectControls(enabled) {
  ["#upload-button", "#export-button", "#new-deck-button", "#instruction", "#send-button", "#details-button", "#project-actions-button"]
    .forEach((selector) => { $(selector).disabled = !enabled; });
}

function openInspector(panel = state.inspector) {
  state.inspector = panel;
  syncInspectorTabs();
  renderInspector();
  $("#inspector").classList.add("open");
  $("#drawer-backdrop").classList.add("visible");
}

function closeInspector() {
  $("#inspector").classList.remove("open");
  $("#drawer-backdrop").classList.remove("visible");
}

function syncInspectorTabs() {
  $$(".inspector-tab").forEach((item) => item.classList.toggle("active", item.dataset.panel === state.inspector));
}

async function bootstrap() {
  try {
    const meta = await api("/meta");
    $("#product-version").textContent = meta.version;
    document.title = `FastPPT ${meta.version}`;
    state.deploymentMode = meta.deployment.deployment_mode;
    $("#deployment-mode").textContent = state.deploymentMode.toUpperCase();
    $("#account-button").hidden = state.deploymentMode !== "server";
    try {
      const session = await api("/auth/session");
      if (session.authenticated) await loadProjects();
    } catch (error) {
      if (error.status === 401) $("#login-dialog").showModal();
      else throw error;
    }
  } catch (error) {
    toast(error.message);
  }
}

async function login(event) {
  event.preventDefault();
  try {
    await api("/auth/login", { method: "POST", body: JSON.stringify({ email: $("#login-email").value, password: $("#login-password").value }) });
    $("#login-password").value = "";
    $("#login-dialog").close();
    await loadProjects();
  } catch (error) {
    toast(error.message);
  }
}

async function logout() {
  try {
    await api("/auth/logout", { method: "POST" });
    clearInterval(state.eventTimer);
    Object.assign(state, { projects: [], project: null, pages: [], page: null, documents: [], versions: [] });
    renderProjects();
    renderPages();
    $("#project-name").textContent = "未选择项目";
    setProjectControls(false);
    renderPreview();
    renderInspector();
    $("#login-dialog").showModal();
  } catch (error) {
    toast(error.message);
  }
}

async function loadProjects(selectId = null) {
  const data = await api(`/projects${state.showArchived ? "?archived=1" : ""}`);
  state.projects = state.showArchived ? data.projects.filter((project) => project.status === "archived") : data.projects;
  renderProjects();
  const selected = selectId || (state.projects.some((item) => item.project_id === state.project?.project_id) ? state.project.project_id : state.projects[0]?.project_id);
  if (selected) await selectProject(selected);
  else clearProjectSelection();
}

function clearProjectSelection() {
  state.project = null;
  state.pages = [];
  state.page = null;
  $("#project-name").textContent = state.showArchived ? "没有归档项目" : "未选择项目";
  setProjectControls(false);
  renderPages();
  renderPreview();
  renderInspector();
}

function renderProjects() {
  $("#project-list").innerHTML = state.projects.map((project) => `
    <button class="project-item ${state.project?.project_id === project.project_id ? "active" : ""}" data-project="${project.project_id}">
      <span>${escapeHtml(project.name)}</span><small>${escapeHtml(project.status)}</small>
    </button>`).join("") || `<div class="detail-empty">${state.showArchived ? "暂无归档项目" : "暂无项目"}</div>`;
  $$('[data-project]').forEach((node) => node.addEventListener("click", () => selectProject(node.dataset.project)));
  $("#archived-toggle").textContent = state.showArchived ? "返回活动项目" : "查看归档项目";
}

async function fetchProjectData(projectId) {
  const [project, pages, documents, governance, assets, plans, operations, jobs, usage, exports] = await Promise.all([
    api(`/projects/${projectId}`), api(`/projects/${projectId}/pages`), api(`/projects/${projectId}/documents`),
    api(`/projects/${projectId}/facts`), api(`/projects/${projectId}/assets`), api(`/projects/${projectId}/plans`),
    api(`/projects/${projectId}/operations`), api(`/projects/${projectId}/jobs`), api(`/projects/${projectId}/usage`),
    api(`/projects/${projectId}/exports`),
  ]);
  return { project, pages: pages.pages, documents: documents.documents, facts: governance.facts, conflicts: governance.conflicts, assets: assets.assets, plans: plans.plans, operations: operations.operations, jobs: jobs.jobs, usage: usage.usage, exports: exports.exports };
}

async function selectProject(projectId) {
  const previousId = state.project?.project_id;
  const data = await fetchProjectData(projectId);
  Object.assign(state, data);
  state.selectedPageIds = new Set([...state.selectedPageIds].filter((pageId) => state.pages.some((page) => page.page_id === pageId)));
  state.page = state.pages.find((item) => item.page_id === state.page?.page_id) || state.pages[0] || null;
  if (previousId !== projectId) {
    state.eventSeq = 0;
    const events = await api(`/projects/${projectId}/events?afterSeq=0`);
    state.eventSeq = events.events.at(-1)?.seq || 0;
  }
  $("#project-name").textContent = state.project.name;
  setProjectControls(state.project.status !== "archived");
  renderProjects();
  renderPages();
  await selectPage(state.page?.page_id || null, false);
  startEventPolling();
}

async function refreshProjectData({ preservePage = true } = {}) {
  if (!state.project) return;
  const projectId = state.project.project_id;
  const pageId = preservePage ? state.page?.page_id : null;
  const data = await fetchProjectData(projectId);
  if (state.project?.project_id !== projectId) return;
  Object.assign(state, data);
  state.page = state.pages.find((page) => page.page_id === pageId) || state.pages[0] || null;
  state.selectedPageIds = new Set([...state.selectedPageIds].filter((id) => state.pages.some((page) => page.page_id === id)));
  $("#project-name").textContent = state.project.name;
  renderProjects();
  renderPages();
  await selectPage(state.page?.page_id || null, false);
}

function startEventPolling() {
  clearInterval(state.eventTimer);
  state.eventTimer = setInterval(pollEvents, state.deploymentMode === "server" ? 1200 : 2500);
}

async function pollEvents() {
  if (!state.project || state.eventPolling || document.hidden) return;
  state.eventPolling = true;
  const projectId = state.project.project_id;
  try {
    const data = await api(`/projects/${projectId}/events?afterSeq=${state.eventSeq}`);
    if (!data.events.length || state.project?.project_id !== projectId) return;
    state.eventSeq = data.events.at(-1).seq;
    const refreshTypes = new Set(["document.ready", "document.failed", "conflict.detected", "conflict.resolved", "page.version.created", "operation.completed", "operation.failed", "export.completed", "export.failed", "preview.pptx.ready", "plan.cancelled"]);
    if (data.events.some((event) => refreshTypes.has(event.event_type))) await refreshProjectData();
  } catch (error) {
    if (error.status !== 401 && error.status !== 404) console.warn(error);
  } finally {
    state.eventPolling = false;
  }
}

function renderPages() {
  $("#page-list").classList.toggle("multi-mode", state.scope === "multi");
  $("#page-list").innerHTML = state.pages.map((page, index) => `
    <div class="page-row">
      <input class="page-select" data-select-page="${page.page_id}" type="checkbox" aria-label="选择第 ${index + 1} 页" ${state.selectedPageIds.has(page.page_id) ? "checked" : ""}>
      <button class="page-item ${state.page?.page_id === page.page_id ? "active" : ""}" data-page="${page.page_id}">
        <span class="page-number">${index + 1}</span><span class="page-copy"><strong>${escapeHtml(page.page_type)}</strong><span>${escapeHtml(page.version_status)} · ${shortId(page.current_version_id)}</span></span>
      </button>
    </div>`).join("") || '<div class="detail-empty">尚无页面</div>';
  $$('[data-page]').forEach((node) => node.addEventListener("click", () => selectPage(node.dataset.page)));
  $$('[data-select-page]').forEach((node) => node.addEventListener("change", () => {
    if (node.checked) state.selectedPageIds.add(node.dataset.selectPage);
    else state.selectedPageIds.delete(node.dataset.selectPage);
  }));
}

async function selectPage(pageId, renderList = true) {
  state.page = state.pages.find((page) => page.page_id === pageId) || null;
  state.versions = state.page ? (await api(`/projects/${state.project.project_id}/pages/${state.page.page_id}/versions`)).versions : [];
  state.compareVersionIds = new Set([...state.compareVersionIds].filter((id) => state.versions.some((version) => version.version_id === id)));
  if (renderList) renderPages();
  renderPreview();
  renderInspector();
}

function previewArtifact(page) {
  if (!page) return null;
  if (state.preview === "quick") return page.quick_preview_artifact_id;
  if (state.preview === "visual") return page.visual_preview_artifact_id;
  return page.pptx_render_artifact_id;
}

function renderPreview() {
  const frame = $("#preview-frame");
  const artifact = previewArtifact(state.page);
  if (!state.page) {
    frame.innerHTML = '<div class="empty-state"><strong>项目中还没有页面</strong><span>导入资料或使用逐页录入</span></div>';
    $("#preview-state").textContent = "未选择页面";
    $("#preview-state").className = "status neutral";
  } else if (!artifact) {
    const authoritative = state.preview === "authoritative";
    const sample = state.page.version_status === "previewing";
    frame.innerHTML = `<div class="empty-state"><strong>${sample ? "代表页待确认" : authoritative ? "权威渲染不可用" : "预览尚未生成"}</strong><span>${sample ? "检查视觉预览后在计划面板确认" : authoritative ? "查看导出任务确认当前渲染状态" : "等待对应任务完成"}</span></div>`;
    $("#preview-state").textContent = sample ? "REVIEW" : authoritative ? "DEGRADED" : "PENDING";
    $("#preview-state").className = `status ${authoritative ? "degraded" : "neutral"}`;
  } else {
    frame.innerHTML = `<img alt="第 ${state.page.order_index + 1} 页预览" src="/api/v1/projects/${state.project.project_id}/artifacts/${artifact}">`;
    $("#preview-state").textContent = state.page.version_status === "previewing" ? "SAMPLE" : state.preview === "authoritative" ? "POWERPOINT" : state.preview.toUpperCase();
    $("#preview-state").className = "status ready";
  }
  $("#page-version").textContent = `版本 ${shortId(state.page?.current_version_id)}`;
  $("#editable-level").textContent = `可编辑等级 ${state.page?.editable_level || "-"}`;
  $("#qa-state").textContent = `QA ${state.page?.qa?.render_status || "-"}`;
}

function section(title, content, count = null) {
  return `<section class="detail-section"><div class="detail-heading"><strong>${escapeHtml(title)}</strong>${count === null ? "" : `<span>${count}</span>`}</div>${content}</section>`;
}

function renderSources() {
  const documents = state.documents.map((document) => `<div class="detail-row"><strong>${escapeHtml(document.file_name)}</strong><span>${escapeHtml(document.parse_status)} · ${(document.size_bytes / 1024).toFixed(1)} KB</span><small>${escapeHtml(document.summary || document.error || "等待解析")}</small></div>`).join("") || '<div class="detail-empty">尚未导入资料</div>';
  const assets = state.assets.map((asset) => `<div class="detail-row"><strong>${escapeHtml(asset.file_name)}</strong><span>${escapeHtml(asset.role)}</span><small>${escapeHtml(asset.media_type)} · ${shortId(asset.artifact_id)}</small></div>`).join("") || '<div class="detail-empty">尚未登记图片</div>';
  return section("资料文档", `<div class="detail-list">${documents}</div>`, state.documents.length) + section("图片资源", `<div class="detail-list">${assets}</div>`, state.assets.length);
}

function renderFacts() {
  const conflicts = state.conflicts.filter((item) => item.status === "detected").map((conflict) => `
    <div class="detail-row"><strong>冲突：${escapeHtml(conflict.kind)}</strong><small>${escapeHtml(conflict.conflict_key)}</small>
      ${conflict.facts.map((fact) => `<div class="row-actions"><button class="mini-button primary-action" data-resolve-conflict="${conflict.conflict_id}" data-resolution="prefer" data-fact-id="${fact.fact_id}">采用 ${escapeHtml(fact.value)}</button></div>`).join("")}
      <div class="row-actions"><button class="mini-button" data-resolve-conflict="${conflict.conflict_id}" data-resolution="keep_both">保留两者</button><button class="mini-button danger-action" data-resolve-conflict="${conflict.conflict_id}" data-resolution="ignore">忽略冲突</button></div>
    </div>`).join("") || '<div class="detail-empty">没有待处理冲突</div>';
  const facts = state.facts.map((fact) => `<div class="detail-row fact-row"><span class="fact-copy"><strong>${escapeHtml(fact.value)}</strong><span>${escapeHtml(fact.kind)} · ${escapeHtml(fact.source_locator)}</span><small>置信度 ${Number(fact.confidence).toFixed(2)}</small></span><input class="fact-lock" type="checkbox" data-lock-fact="${fact.fact_id}" aria-label="锁定事实 ${escapeHtml(fact.value)}" ${fact.locked ? "checked" : ""}></div>`).join("") || '<div class="detail-empty">尚未提取事实</div>';
  return section("事实冲突", `<div class="detail-list">${conflicts}</div>`, state.conflicts.filter((item) => item.status === "detected").length) + section("事实锚点", `<div class="detail-list">${facts}</div>`, state.facts.length);
}

function renderPlans() {
  const content = state.plans.map((plan) => {
    const structured = plan.structured_plan;
    const actions = [];
    if (plan.status === "planned") actions.push(`<button class="mini-button primary-action" data-plan-action="confirm" data-plan-id="${plan.plan_id}">确认计划</button>`);
    if (plan.status === "awaiting_sample_confirmation") actions.push(`<button class="mini-button primary-action" data-plan-action="samples" data-plan-id="${plan.plan_id}">确认代表页</button>`);
    if (["planned", "awaiting_sample_confirmation", "generating_samples", "generating_pages"].includes(plan.status)) actions.push(`<button class="mini-button danger-action" data-plan-action="cancel" data-plan-id="${plan.plan_id}">取消</button>`);
    return `<div class="detail-row"><strong>${escapeHtml(structured.workflowMode)} · ${shortId(plan.plan_id)}</strong><span class="status-line"><span>${structured.pageDrafts?.length || 0} 页</span><span class="${escapeHtml(plan.status)}">${escapeHtml(plan.status)}</span></span><small>${escapeHtml((structured.confirmationReasons || []).join(" · "))}</small>${actions.length ? `<div class="row-actions">${actions.join("")}</div>` : ""}</div>`;
  }).join("") || '<div class="detail-empty">暂无计划</div>';
  return `<div class="detail-list">${content}</div>`;
}

function renderOperations() {
  const operations = state.operations.map((operation) => {
    const actions = [];
    if (["failed", "partial"].includes(operation.status)) actions.push(`<button class="mini-button primary-action" data-operation-action="retry" data-operation-id="${operation.operation_id}">重试</button>`);
    if (["completed", "partial"].includes(operation.status) && operation.result_version_ids.length) actions.push(`<button class="mini-button" data-operation-action="rollback" data-operation-id="${operation.operation_id}">回滚</button>`);
    if (["planned", "confirmed"].includes(operation.status)) actions.push(`<button class="mini-button danger-action" data-operation-action="cancel" data-operation-id="${operation.operation_id}">取消</button>`);
    return `<div class="detail-row"><strong>${shortId(operation.operation_id)}</strong><span class="status-line"><span>${escapeHtml(operation.target_scope)} · ${operation.resolved_page_ids.length} 页</span><span class="${escapeHtml(operation.status)}">${escapeHtml(operation.status)}</span></span><small>${escapeHtml(operation.error?.page_errors ? Object.values(operation.error.page_errors).join("；") : operation.structured_plan?._instruction || "")}</small>${actions.length ? `<div class="row-actions">${actions.join("")}</div>` : ""}</div>`;
  }).join("") || '<div class="detail-empty">暂无编辑操作</div>';
  const jobs = state.jobs.map((job) => `<div class="detail-row"><strong>${escapeHtml(job.kind)} · ${shortId(job.job_id)}</strong><span class="status-line"><span>尝试 ${job.attempts}/${job.max_attempts}</span><span class="${escapeHtml(job.status)}">${escapeHtml(job.status)}</span></span><small>${escapeHtml(job.error || "")}</small>${["failed", "cancelled"].includes(job.status) ? `<div class="row-actions"><button class="mini-button primary-action" data-job-retry="${job.job_id}">重试作业</button></div>` : ""}</div>`).join("") || '<div class="detail-empty">暂无后台作业</div>';
  const exports = state.exports.map((item) => `<div class="detail-row"><strong>PPTX · ${shortId(item.export_id)}</strong><span class="status-line"><span>${item.version_lock.length} 页</span><span class="${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></span><small>${escapeHtml(item.qa?.render_status || item.qa?.error || "等待处理")}</small>${terminalExports.has(item.status) && item.status !== "failed" && item.artifact_id ? `<div class="row-actions"><button class="mini-button primary-action" data-export-download="${item.export_id}">下载</button></div>` : ""}</div>`).join("") || '<div class="detail-empty">暂无导出</div>';
  const usage = state.usage.map((item) => `<div class="detail-row"><strong>${escapeHtml(item.provider)} · ${escapeHtml(item.model)}</strong><span class="status-line"><span>重试 ${item.retry_count}</span><span class="${escapeHtml(item.submission_status)}">${escapeHtml(item.submission_status)}</span></span><small>${escapeHtml(displayValue(item.settled || item.reserved))}</small></div>`).join("") || '<div class="detail-empty">暂无模型用量</div>';
  return section("编辑操作", `<div class="detail-list">${operations}</div>`, state.operations.length) + section("后台作业", `<div class="detail-list">${jobs}</div>`, state.jobs.length) + section("导出", `<div class="detail-list">${exports}</div>`, state.exports.length) + section("模型用量", `<div class="detail-list">${usage}</div>`, state.usage.length);
}

function renderVersions() {
  const versions = state.versions.map((version) => `<div class="detail-row version-row"><input class="compare-select" data-compare-version="${version.version_id}" type="checkbox" aria-label="选择版本 ${shortId(version.version_id)}" ${state.compareVersionIds.has(version.version_id) ? "checked" : ""}><strong>${shortId(version.version_id)}</strong><span>${escapeHtml(version.status)} · ${escapeHtml(version.editable_level)}</span><small>${new Date(version.created_at).toLocaleString()}</small>${version.version_id !== state.page?.current_version_id ? `<button class="version-restore" data-restore-version="${version.version_id}" aria-label="恢复此版本" title="恢复此版本">↶</button>` : '<span class="current-version">当前</span>'}</div>`).join("") || '<div class="detail-empty">选择页面查看版本</div>';
  return `<div class="detail-list">${versions}</div><div class="compare-bar"><small>选择两个版本进行比较</small><button id="compare-versions" class="mini-button primary-action" ${state.compareVersionIds.size === 2 ? "" : "disabled"}>比较版本</button></div>`;
}

function renderQa() {
  const qa = state.page?.qa || {};
  return Object.keys(qa).length ? Object.entries(qa).map(([key, value]) => `<div class="qa-line"><span>${escapeHtml(key)}</span><span>${escapeHtml(displayValue(value))}</span></div>`).join("") : '<div class="detail-empty">暂无 QA 结果</div>';
}

function renderInspector() {
  const root = $("#inspector-content");
  if (!root) return;
  const renderers = { sources: renderSources, facts: renderFacts, plan: renderPlans, operations: renderOperations, versions: renderVersions, qa: renderQa };
  root.innerHTML = (renderers[state.inspector] || renderSources)();
  bindInspectorActions();
}

function bindInspectorActions() {
  $$('[data-restore-version]').forEach((node) => node.addEventListener("click", () => restoreVersion(node.dataset.restoreVersion)));
  $$('[data-lock-fact]').forEach((node) => node.addEventListener("change", () => setFactLock(node.dataset.lockFact, node.checked)));
  $$('[data-resolve-conflict]').forEach((node) => node.addEventListener("click", () => resolveConflict(node.dataset.resolveConflict, node.dataset.resolution, node.dataset.factId)));
  $$('[data-plan-action]').forEach((node) => node.addEventListener("click", () => planAction(node.dataset.planId, node.dataset.planAction)));
  $$('[data-operation-action]').forEach((node) => node.addEventListener("click", () => operationAction(node.dataset.operationId, node.dataset.operationAction)));
  $$('[data-job-retry]').forEach((node) => node.addEventListener("click", () => retryJob(node.dataset.jobRetry)));
  $$('[data-export-download]').forEach((node) => node.addEventListener("click", () => downloadExport(node.dataset.exportDownload)));
  $$('[data-compare-version]').forEach((node) => node.addEventListener("change", () => {
    if (node.checked && state.compareVersionIds.size >= 2) {
      node.checked = false;
      toast("最多选择两个版本");
      return;
    }
    if (node.checked) state.compareVersionIds.add(node.dataset.compareVersion);
    else state.compareVersionIds.delete(node.dataset.compareVersion);
    const compareButton = $("#compare-versions");
    if (compareButton) compareButton.disabled = state.compareVersionIds.size !== 2;
  }));
  $("#compare-versions")?.addEventListener("click", compareVersions);
}

async function restoreVersion(versionId) {
  try {
    await api(`/projects/${state.project.project_id}/pages/${state.page.page_id}/versions/${versionId}/restore`, { method: "POST", body: "{}" });
    await refreshProjectData();
    state.inspector = "versions";
    renderInspector();
    toast("版本已恢复");
  } catch (error) {
    toast(error.message);
  }
}

async function compareVersions() {
  if (state.compareVersionIds.size !== 2 || !state.page) return;
  try {
    const [left, right] = [...state.compareVersionIds];
    const result = await api(`/projects/${state.project.project_id}/pages/${state.page.page_id}/versions?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`);
    const changes = Object.entries(result.changes).map(([key, value]) => `<div class="diff-row"><strong>${escapeHtml(key)}</strong><div class="diff-values"><span>${escapeHtml(displayValue(value.left))}</span><span>${escapeHtml(displayValue(value.right))}</span></div></div>`).join("") || '<div class="detail-empty">两个版本的受控字段没有差异</div>';
    $("#compare-content").innerHTML = `<div class="status-line"><span>${shortId(left)}</span><span>${shortId(right)}</span></div>${changes}`;
    $("#compare-dialog").showModal();
  } catch (error) {
    toast(error.message);
  }
}

async function setFactLock(factId, locked) {
  try {
    await api(`/projects/${state.project.project_id}/facts/${factId}/lock`, { method: "POST", body: JSON.stringify({ locked }) });
    await refreshProjectData();
    toast(locked ? "事实已锁定" : "事实已解锁");
  } catch (error) {
    toast(error.message);
  }
}

async function resolveConflict(conflictId, resolution, factId = null) {
  try {
    await api(`/projects/${state.project.project_id}/conflicts/${conflictId}/resolve`, { method: "POST", body: JSON.stringify({ resolution, fact_ids: factId ? [factId] : [] }) });
    await refreshProjectData();
    toast("事实冲突已处理");
  } catch (error) {
    toast(error.message);
  }
}

function parsePageDrafts(value) {
  return value.split(/\n\s*---\s*\n/g).map((block, index) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    return { title: lines.shift() || `Page ${index + 1}`, body: lines.join("\n"), page_type: index === 0 ? "cover" : "content" };
  }).filter((item) => item.title || item.body);
}

function openConfirmation(pending) {
  state.pendingPlan = pending;
  const structured = pending.structured_plan || {};
  const sample = pending.kind === "sample";
  const operation = pending.kind === "operation";
  $("#confirm-title").textContent = sample ? "确认代表页" : operation ? "确认编辑操作" : "确认生成计划";
  $("#confirm-plan").textContent = sample ? "代表页通过，生成全部页面" : operation ? "确认并执行" : "生成代表页";
  $("#cancel-plan").textContent = sample ? "退回并取消计划" : "取消计划";
  $("#confirm-summary").innerHTML = `<div class="confirm-grid"><span>工作流</span><span>${escapeHtml(structured.workflowMode || "-")}</span><span>页面数量</span><span>${structured.pageDrafts?.length || structured.affectedPageIds?.length || 0}</span><span>当前阶段</span><span>${sample ? "代表页视觉确认" : operation ? "编辑执行确认" : "计划确认"}</span><span>预计成本</span><span>${escapeHtml(structured.estimatedUsage?.amount ?? "unknown")}</span><span>确认原因</span><span>${escapeHtml((structured.confirmationReasons || []).join("、"))}</span></div>`;
  $("#confirm-dialog").showModal();
}

function planAction(planId, action) {
  const plan = state.plans.find((item) => item.plan_id === planId);
  if (!plan) return;
  if (action === "cancel") {
    state.pendingPlan = { kind: "plan", id: planId, structured_plan: plan.structured_plan };
    cancelPending();
    return;
  }
  openConfirmation({ kind: action === "samples" ? "sample" : "plan", id: planId, structured_plan: plan.structured_plan });
}

async function createProject(event) {
  event.preventDefault();
  try {
    const project = await api("/projects", { method: "POST", body: JSON.stringify({ name: $("#new-project-name").value }) });
    $("#project-dialog").close();
    $("#new-project-name").value = "";
    await loadProjects(project.project_id);
  } catch (error) {
    toast(error.message);
  }
}

async function createDeckPlan(event) {
  event.preventDefault();
  try {
    setSaveState("正在生成计划");
    const session = await api(`/projects/${state.project.project_id}/sessions`, { method: "POST", body: JSON.stringify({ workflow_mode: "page_entry", source_document_ids: [] }) });
    const plan = await api(`/projects/${state.project.project_id}/plans`, { method: "POST", body: JSON.stringify({ session_id: session.session_id, page_drafts: parsePageDrafts($("#deck-pages").value) }) });
    $("#deck-dialog").close();
    $("#deck-pages").value = "";
    await refreshProjectData();
    openConfirmation({ kind: "plan", id: plan.plan_id, structured_plan: plan.structured_plan });
  } catch (error) {
    toast(error.message);
  } finally {
    setSaveState();
  }
}

async function confirmPending() {
  const pending = state.pendingPlan;
  if (!pending) return;
  const button = $("#confirm-plan");
  button.disabled = true;
  try {
    if (pending.kind === "operation") {
      const result = await api(`/projects/${state.project.project_id}/operations/${pending.id}/confirm`, { method: "POST", body: "{}" });
      $("#confirm-dialog").close();
      state.pendingPlan = null;
      const completed = terminalOperations.has(result.status) ? result : await pollOperation(pending.id);
      await refreshProjectData();
      toast(completed.status === "completed" ? "编辑操作已完成" : `编辑操作状态：${completed.status}`);
    } else if (pending.kind === "sample") {
      setSaveState("正在生成全部页面");
      await api(`/projects/${state.project.project_id}/plans/${pending.id}/samples/confirm`, { method: "POST", body: "{}" });
      $("#confirm-dialog").close();
      state.pendingPlan = null;
      await refreshProjectData();
      toast("代表页已确认，全部页面已生成");
    } else {
      setSaveState("正在生成代表页");
      const result = await api(`/projects/${state.project.project_id}/plans/${pending.id}/confirm`, { method: "POST", body: "{}" });
      $("#confirm-dialog").close();
      state.pendingPlan = null;
      await refreshProjectData({ preservePage: false });
      state.inspector = "plan";
      syncInspectorTabs();
      renderInspector();
      if (result.status === "awaiting_sample_confirmation") toast("代表页已生成，请检查视觉预览后确认");
    }
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    setSaveState();
  }
}

async function cancelPending() {
  const pending = state.pendingPlan;
  if (!pending) return;
  try {
    const kind = pending.kind === "operation" ? "operations" : "plans";
    await api(`/projects/${state.project.project_id}/${kind}/${pending.id}/cancel`, { method: "POST", body: "{}" });
    $("#confirm-dialog").close();
    state.pendingPlan = null;
    await refreshProjectData();
    toast("计划已取消");
  } catch (error) {
    toast(error.message);
  }
}

async function fileBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  return btoa(binary);
}

async function uploadDocument(file) {
  if (!file || !state.project) return;
  try {
    setSaveState("正在导入资料");
    const documentRecord = await api(`/projects/${state.project.project_id}/documents`, { method: "POST", body: JSON.stringify({ file_name: file.name, content_base64: await fileBase64(file) }) });
    if (["queued", "parsing"].includes(documentRecord.parse_status)) await pollDocument(documentRecord.document_id);
    await refreshProjectData();
    toast(documentRecord.parse_status === "blocked" ? "资料已导入，请先处理事实冲突" : "资料已导入");
  } catch (error) {
    toast(error.message);
  } finally {
    $("#file-input").value = "";
    setSaveState();
  }
}

async function uploadImage(event) {
  event.preventDefault();
  const file = state.selectedImage;
  if (!file || !state.project) return;
  try {
    setSaveState("正在上传图片");
    await api(`/projects/${state.project.project_id}/assets`, { method: "POST", body: JSON.stringify({ file_name: file.name, role: $("#image-role").value, media_type: file.type, content_base64: await fileBase64(file) }) });
    $("#image-dialog").close();
    state.selectedImage = null;
    $("#image-input").value = "";
    await refreshProjectData();
    state.inspector = "sources";
    renderInspector();
    toast("图片已登记，可用于页面生成和修改");
  } catch (error) {
    toast(error.message);
  } finally {
    setSaveState();
  }
}

async function pollDocument(documentId) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const documents = (await api(`/projects/${state.project.project_id}/documents`)).documents;
    const documentRecord = documents.find((item) => item.document_id === documentId);
    if (documentRecord && ["ready", "warning", "blocked", "failed"].includes(documentRecord.parse_status)) return documentRecord;
    await sleep(1000);
  }
  throw new Error("资料解析等待超时，请在任务面板检查状态");
}

async function exportDeck() {
  if (!state.project) return;
  const button = $("#export-button");
  button.disabled = true;
  try {
    setSaveState("正在导出");
    const created = await api(`/projects/${state.project.project_id}/exports`, { method: "POST", body: "{}" });
    const completed = terminalExports.has(created.status) ? created : await pollExport(created.export_id);
    await refreshProjectData();
    if (completed.status === "failed") throw new Error(completed.qa?.error || completed.qa?.render_error || "导出失败");
    if (!completed.artifact_id) throw new Error("导出完成但文件尚未发布");
    downloadExport(completed.export_id);
    toast(completed.status === "degraded" ? "PPTX 已导出，权威渲染明确降级" : "PPTX 已通过检查并开始下载");
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    setSaveState();
  }
}

async function pollExport(exportId) {
  for (let attempt = 0; attempt < 900; attempt += 1) {
    const value = await api(`/projects/${state.project.project_id}/exports/${exportId}`);
    setSaveState(`导出状态：${value.status}`);
    if (terminalExports.has(value.status)) return value;
    await sleep(1000);
  }
  throw new Error("导出等待超时，请在任务面板检查状态");
}

function downloadExport(exportId) {
  window.location.assign(`/api/v1/projects/${state.project.project_id}/exports/${exportId}/download`);
}

async function sendInstruction() {
  const instruction = $("#instruction").value.trim();
  if (!instruction || !state.page) return;
  const pageIds = state.scope === "global" ? state.pages.map((page) => page.page_id) : state.scope === "multi" ? [...state.selectedPageIds] : [state.page.page_id];
  if (state.scope === "multi" && !pageIds.length) {
    toast("请先勾选页面");
    return;
  }
  const button = $("#send-button");
  button.disabled = true;
  try {
    setSaveState("正在规划修改");
    const operation = await api(`/projects/${state.project.project_id}/operations`, { method: "POST", body: JSON.stringify({ instruction, target_scope: state.scope, page_ids: pageIds, workflow_mode: "pptx_improve" }) });
    $("#instruction").value = "";
    await refreshProjectData();
    if (operation.confirmation_required) {
      openConfirmation({ kind: "operation", id: operation.operation_id, structured_plan: operation.structured_plan });
    } else {
      const completed = terminalOperations.has(operation.status) ? operation : await pollOperation(operation.operation_id);
      await refreshProjectData();
      toast(completed.status === "completed" ? "页面修改已生成新版本" : `编辑操作状态：${completed.status}`);
    }
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    setSaveState();
  }
}

async function pollOperation(operationId) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const value = await api(`/projects/${state.project.project_id}/operations/${operationId}`);
    setSaveState(`编辑状态：${value.status}`);
    if (terminalOperations.has(value.status)) return value;
    await sleep(1000);
  }
  throw new Error("编辑操作等待超时，请在任务面板检查状态");
}

async function operationAction(operationId, action) {
  try {
    setSaveState(`正在${action === "rollback" ? "回滚" : action === "retry" ? "重试" : "取消"}`);
    const result = await api(`/projects/${state.project.project_id}/operations/${operationId}/${action}`, { method: "POST", body: "{}" });
    if (action === "retry" && !terminalOperations.has(result.status)) await pollOperation(operationId);
    await refreshProjectData();
    toast(action === "rollback" ? "操作已回滚" : action === "retry" ? "操作重试已处理" : "操作已取消");
  } catch (error) {
    toast(error.message);
  } finally {
    setSaveState();
  }
}

async function retryJob(jobId) {
  try {
    await api(`/projects/${state.project.project_id}/jobs/${jobId}/retry`, { method: "POST", body: "{}" });
    await refreshProjectData();
    toast("作业已重新排队");
  } catch (error) {
    toast(error.message);
  }
}

function openProjectActions() {
  if (!state.project) return;
  $("#rename-project-name").value = state.project.name;
  const archived = state.project.status === "archived";
  $("#archive-project").textContent = archived ? "恢复项目" : "归档项目";
  $("#rename-project").disabled = archived;
  $("#copy-project").disabled = archived;
  $("#project-actions-dialog").showModal();
}

async function renameProject() {
  try {
    const value = $("#rename-project-name").value.trim();
    const updated = await api(`/projects/${state.project.project_id}`, { method: "PATCH", body: JSON.stringify({ name: value }) });
    $("#project-actions-dialog").close();
    await loadProjects(updated.project_id);
    toast("项目已重命名");
  } catch (error) {
    toast(error.message);
  }
}

async function copyProject() {
  try {
    setSaveState("正在复制项目");
    const copied = await api(`/projects/${state.project.project_id}/copy`, { method: "POST", body: "{}" });
    $("#project-actions-dialog").close();
    await loadProjects(copied.project_id);
    toast("项目副本已创建");
  } catch (error) {
    toast(error.message);
  } finally {
    setSaveState();
  }
}

async function archiveOrRestoreProject() {
  try {
    const archived = state.project.status === "archived";
    await api(`/projects/${state.project.project_id}/${archived ? "restore" : "archive"}`, { method: "POST", body: "{}" });
    $("#project-actions-dialog").close();
    await loadProjects();
    toast(archived ? "项目已恢复" : "项目已归档");
  } catch (error) {
    toast(error.message);
  }
}

$("#new-project-button").addEventListener("click", () => $("#project-dialog").showModal());
$("#project-form").addEventListener("submit", createProject);
$("#login-form").addEventListener("submit", login);
$("#account-button").addEventListener("click", logout);
$("#new-deck-button").addEventListener("click", () => $("#deck-dialog").showModal());
$("#deck-form").addEventListener("submit", createDeckPlan);
$("#upload-button").addEventListener("click", () => $("#import-dialog").showModal());
$("#choose-document").addEventListener("click", () => { $("#import-dialog").close(); $("#file-input").click(); });
$("#choose-image").addEventListener("click", () => { $("#import-dialog").close(); $("#image-input").click(); });
$("#file-input").addEventListener("change", (event) => uploadDocument(event.target.files[0]));
$("#image-input").addEventListener("change", (event) => {
  state.selectedImage = event.target.files[0] || null;
  if (!state.selectedImage) return;
  $("#selected-image-name").textContent = `${state.selectedImage.name} · ${(state.selectedImage.size / 1024).toFixed(1)} KB`;
  $("#image-dialog").showModal();
});
$("#image-form").addEventListener("submit", uploadImage);
$("#export-button").addEventListener("click", exportDeck);
$("#send-button").addEventListener("click", sendInstruction);
$("#close-confirm").addEventListener("click", () => $("#confirm-dialog").close());
$("#confirm-plan").addEventListener("click", confirmPending);
$("#cancel-plan").addEventListener("click", cancelPending);
$("#details-button").addEventListener("click", () => openInspector());
$("#inspector-close").addEventListener("click", closeInspector);
$("#drawer-backdrop").addEventListener("click", closeInspector);
$("#project-actions-button").addEventListener("click", openProjectActions);
$("#rename-project").addEventListener("click", renameProject);
$("#copy-project").addEventListener("click", copyProject);
$("#archive-project").addEventListener("click", archiveOrRestoreProject);
$("#archived-toggle").addEventListener("click", async () => { state.showArchived = !state.showArchived; await loadProjects(); });
$$('[data-close-dialog]').forEach((node) => node.addEventListener("click", () => $(`#${node.dataset.closeDialog}`).close()));
$$('.preview-tab').forEach((node) => node.addEventListener("click", () => { $$('.preview-tab').forEach((item) => item.classList.toggle("active", item === node)); state.preview = node.dataset.preview; renderPreview(); }));
$$('.inspector-tab').forEach((node) => node.addEventListener("click", () => { state.inspector = node.dataset.panel; syncInspectorTabs(); renderInspector(); }));
$$('.scope').forEach((node) => node.addEventListener("click", () => { $$('.scope').forEach((item) => item.classList.toggle("active", item === node)); state.scope = node.dataset.scope; renderPages(); }));

bootstrap();
