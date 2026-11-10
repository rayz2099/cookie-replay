import {
  cookieAppliesToHost, cookieKey, cookieUrl, createSnapshot, formatExpiration,
  jwtExpiration, parseSnapshot, planCookie, renameDetails, summarizePlan
} from "./cookie-model.js";

const refs = Object.fromEntries([
  "site-avatar", "site-host", "site-count", "saved-count", "target-host", "cookie-list",
  "cookie-search", "select-all", "selected-count", "snapshot-name", "saved-list", "saved-search",
  "json-input", "preview-panel", "preview-title", "preview-count", "preview-note",
  "preview-list", "import-button", "notice", "save-button", "copy-button"
].map((id) => [id, document.getElementById(id)]));

const state = {
  tab: null,
  storeId: null,
  cookies: [],
  selected: new Set(),
  profiles: [],
  editingCookie: null,
  editingProfile: null,
  snapshot: null,
  planned: [],
  selectedPreview: new Set(),
  existing: [],
  noticeTimer: null
};

function notice(message, error = false) {
  refs.notice.textContent = message;
  refs.notice.classList.toggle("error", error);
  refs.notice.classList.remove("hidden");
  clearTimeout(state.noticeTimer);
  state.noticeTimer = setTimeout(() => refs.notice.classList.add("hidden"), 4400);
}

function button(label, className, handler) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  element.addEventListener("click", handler);
  return element;
}

function showView(view) {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `${view}-view`);
  });
}

// 使用标签页所属 Cookie Store，避免常规窗口与隐身窗口读写错位。
async function readActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:\/\//.test(tab.url)) {
    throw new Error("请先打开 HTTP 或 HTTPS 网站");
  }
  const stores = await chrome.cookies.getAllCookieStores();
  const store = stores.find((item) => item.tabIds.includes(tab.id));
  if (!store) throw new Error("无法识别当前标签页的 Cookie 存储区");
  state.tab = tab;
  state.storeId = store.id;
  const url = new URL(tab.url);
  refs["site-host"].textContent = url.hostname;
  refs["site-avatar"].textContent = url.hostname.charAt(0);
  refs["target-host"].textContent = url.hostname;
}

async function refreshCookies() {
  const url = new URL(state.tab.url);
  const all = await chrome.cookies.getAll({ storeId: state.storeId });
  state.cookies = all.filter((cookie) => cookieAppliesToHost(cookie, url.hostname, url.protocol))
    .sort((a, b) => a.name.localeCompare(b.name) || a.domain.localeCompare(b.domain) || a.path.localeCompare(b.path));
  state.selected = new Set(state.cookies.map((_, index) => index));
  refs["site-count"].textContent = `${state.cookies.length} 项`;
  renderCurrent();
}

function renderCurrent() {
  const query = refs["cookie-search"].value.trim().toLowerCase();
  refs["cookie-list"].replaceChildren();
  const visible = state.cookies.map((cookie, index) => ({ cookie, index }))
    .filter(({ cookie }) => cookie.name.toLowerCase().includes(query));
  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = state.cookies.length ? "没有匹配的 Cookie" : "当前站点没有 Cookie";
    refs["cookie-list"].append(empty);
  }
  for (const { cookie, index } of visible) {
    const row = document.createElement("div");
    row.className = "cookie-row";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = state.selected.has(index);
    check.setAttribute("aria-label", `选择 ${cookie.name}`);
    check.addEventListener("change", () => {
      if (check.checked) state.selected.add(index);
      else state.selected.delete(index);
      renderSelection();
    });
    const main = document.createElement("div");
    main.className = "cookie-main";
    if (state.editingCookie === index) {
      const edit = document.createElement("div");
      edit.className = "inline-edit";
      const input = document.createElement("input");
      input.type = "text";
      input.value = cookie.name;
      input.maxLength = 256;
      input.setAttribute("aria-label", "新 Cookie 名称");
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") run(() => renameCookie(index, input.value));
        if (event.key === "Escape") { state.editingCookie = null; renderCurrent(); }
      });
      edit.append(input, button("保存", "", () => run(() => renameCookie(index, input.value))),
        button("取消", "", () => { state.editingCookie = null; renderCurrent(); }));
      main.append(edit);
      queueMicrotask(() => input.focus());
    } else {
      const name = document.createElement("span");
      name.className = "cookie-name";
      name.textContent = cookie.name;
      main.append(name);
    }
    const meta = document.createElement("span");
    meta.className = "cookie-meta";
    meta.textContent = `${cookie.domain} · ${cookie.path}`;
    main.append(meta);
    main.append(createExpiryLine(cookie));
    if (state.editingCookie !== index) {
      const actions = document.createElement("div");
      actions.className = "row-actions";
      actions.append(
        button("重命名", "", () => {
          if (cookie.partitionKey) { notice("分区 Cookie 暂不支持重命名", true); return; }
          state.editingCookie = index;
          renderCurrent();
        }),
        button("删除", "delete", () => run(() => deleteCookie(index)))
      );
      main.append(actions);
    }
    const tags = document.createElement("span");
    tags.className = "cookie-tags";
    if (cookie.httpOnly) tags.append(tag("HTTP"));
    if (cookie.secure) tags.append(tag("SEC"));
    if (cookie.partitionKey) tags.append(tag("PART", "warning"));
    row.append(check, main, tags);
    refs["cookie-list"].append(row);
  }
  renderSelection();
}

function expiryLabel(label, seconds) {
  const value = formatExpiration(seconds);
  const element = document.createElement("span");
  if (!value) return element;
  element.textContent = `${label} · ${value.relative} · ${value.absolute}`;
  element.title = `${label} 过期时间：${value.absolute}`;
  if (value.relative.startsWith("已过期")) element.className = "expired";
  return element;
}

function createExpiryLine(cookie) {
  const expiry = document.createElement("div");
  expiry.className = "expiry-line";
  const jwtExp = jwtExpiration(cookie.value);
  if (jwtExp !== null) expiry.append(expiryLabel("JWT", jwtExp));
  if (!cookie.session && Number.isFinite(cookie.expirationDate)) {
    expiry.append(expiryLabel("Cookie", cookie.expirationDate));
  } else if (jwtExp === null) {
    const session = document.createElement("span");
    session.textContent = "Cookie · 本次会话";
    expiry.append(session);
  }
  return expiry;
}

function renderSelection() {
  refs["selected-count"].textContent = state.selected.size;
  refs["select-all"].checked = Boolean(state.cookies.length) && state.selected.size === state.cookies.length;
  refs["select-all"].indeterminate = state.selected.size > 0 && state.selected.size < state.cookies.length;
  refs["save-button"].disabled = !state.selected.size;
  refs["copy-button"].disabled = !state.selected.size;
}

function tag(text, variant = "") {
  const element = document.createElement("span");
  element.className = `tag ${variant}`;
  element.textContent = text;
  return element;
}

function selectedSnapshot(name = "") {
  const cookies = state.cookies.filter((_, index) => state.selected.has(index));
  return createSnapshot(cookies, state.tab.url, name);
}

async function deleteCookie(index) {
  const cookie = state.cookies[index];
  if (!cookie || !confirm(`删除 ${cookie.name}（${cookie.domain}${cookie.path}）？`)) return;
  const details = { url: cookieUrl(cookie, state.tab.url), name: cookie.name, storeId: state.storeId };
  if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;
  const removed = await chrome.cookies.remove(details);
  if (!removed) throw new Error("未找到要删除的 Cookie，请刷新后重试");
  await refreshCookies();
  notice(`已删除 ${cookie.name}`);
}

// Chrome 没有重命名 API；先写新名称，成功后再删除旧名称以保护原值。
async function renameCookie(index, input) {
  const cookie = state.cookies[index];
  const name = input.trim();
  if (!cookie) throw new Error("Cookie 已变化，请刷新后重试");
  if (!name || /[\u0000-\u001f\u007f;=]/.test(name)) throw new Error("Cookie 名称不能包含控制字符、分号或等号");
  if (name === cookie.name) { state.editingCookie = null; renderCurrent(); return; }
  if (cookie.partitionKey) throw new Error("分区 Cookie 暂不支持重命名");
  const existing = await chrome.cookies.getAll({ name, storeId: state.storeId });
  const newKey = cookieKey({ name, domain: cookie.domain, path: cookie.path });
  if (existing.some((item) => cookieKey(item) === newKey)) throw new Error("同作用域下已存在该名称");
  const details = renameDetails(cookie, name, state.tab.url, state.storeId);
  const created = await chrome.cookies.set(details);
  if (!created) throw new Error("浏览器拒绝创建新名称的 Cookie");
  const removal = { url: cookieUrl(cookie, state.tab.url), name: cookie.name, storeId: state.storeId };
  const removed = await chrome.cookies.remove(removal);
  state.editingCookie = null;
  await refreshCookies();
  if (!removed) throw new Error(`已创建 ${name}，但旧名称 ${cookie.name} 删除失败`);
  notice(`已重命名为 ${name}`);
}

async function copySnapshot(snapshot) {
  await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
  notice(`已复制 ${snapshot.cookies.length} 项 Cookie`);
}

async function saveSnapshot() {
  const name = refs["snapshot-name"].value.trim();
  if (!name) throw new Error("请填写快照名称");
  if (state.profiles.some((profile) => profile.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("快照名称已存在，请换一个名称");
  }
  const profile = { id: crypto.randomUUID(), name, snapshot: selectedSnapshot(name) };
  const profiles = [profile, ...state.profiles];
  await chrome.storage.local.set({ profiles });
  state.profiles = profiles;
  refs["snapshot-name"].value = "";
  renderSaved();
  notice(`已保存「${name}」`);
}

async function deleteProfile(id) {
  const profile = state.profiles.find((item) => item.id === id);
  if (!profile || !confirm(`删除快照「${profile.name}」？`)) return;
  const profiles = state.profiles.filter((item) => item.id !== id);
  await chrome.storage.local.set({ profiles });
  state.profiles = profiles;
  renderSaved();
  notice("快照已删除");
}

async function renameProfile(id, input) {
  const profile = state.profiles.find((item) => item.id === id);
  const name = input.trim();
  if (!profile) throw new Error("快照已变化，请刷新后重试");
  if (!name) throw new Error("请填写快照名称");
  if (state.profiles.some((item) => item.id !== id && item.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("快照名称已存在");
  }
  const profiles = state.profiles.map((item) => item.id === id
    ? { ...item, name, snapshot: { ...item.snapshot, name } } : item);
  await chrome.storage.local.set({ profiles });
  state.profiles = profiles;
  state.editingProfile = null;
  renderSaved();
  notice(`已重命名为「${name}」`);
}

function renderSaved() {
  refs["saved-count"].textContent = state.profiles.length;
  refs["saved-list"].replaceChildren();
  const query = refs["saved-search"].value.trim().toLowerCase();
  const profiles = state.profiles.filter((profile) =>
    profile.name.toLowerCase().includes(query) || profile.snapshot.source.toLowerCase().includes(query));
  if (!profiles.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = state.profiles.length ? "没有匹配的快照" : "暂无快照";
    refs["saved-list"].append(empty);
  }
  for (const profile of profiles) {
    const row = document.createElement("div");
    row.className = "saved-row";
    const symbol = document.createElement("span");
    symbol.className = "saved-symbol";
    symbol.textContent = profile.name.charAt(0).toUpperCase();
    const info = document.createElement("span");
    info.className = "saved-info";
    if (state.editingProfile === profile.id) {
      const edit = document.createElement("div");
      edit.className = "inline-edit";
      const input = document.createElement("input");
      input.type = "text";
      input.value = profile.name;
      input.maxLength = 48;
      input.setAttribute("aria-label", "新快照名称");
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") run(() => renameProfile(profile.id, input.value));
        if (event.key === "Escape") { state.editingProfile = null; renderSaved(); }
      });
      edit.append(input, button("保存", "", () => run(() => renameProfile(profile.id, input.value))),
        button("取消", "", () => { state.editingProfile = null; renderSaved(); }));
      info.append(edit);
      queueMicrotask(() => input.focus());
    } else {
      const name = document.createElement("strong");
      name.textContent = profile.name;
      info.append(name);
    }
    const meta = document.createElement("small");
    meta.textContent = `${profile.snapshot.source} · ${profile.snapshot.cookies.length} 项 · ${new Date(profile.snapshot.createdAt).toLocaleDateString("zh-CN")}`;
    info.append(meta);
    const actions = document.createElement("span");
    actions.className = "saved-actions";
    actions.append(
      button("导入", "", () => {
        refs["json-input"].value = JSON.stringify(profile.snapshot, null, 2);
        showView("import");
        run(previewImport);
      }),
      button("复制", "", () => run(() => copySnapshot(profile.snapshot))),
      button("重命名", "", () => { state.editingProfile = profile.id; renderSaved(); }),
      button("删除", "delete", () => run(() => deleteProfile(profile.id)))
    );
    if (state.editingProfile !== profile.id) info.append(actions);
    row.append(symbol, info);
    refs["saved-list"].append(row);
  }
}

// 预览与执行共用同一计划，确保展示的冲突处理就是最终写入行为。
async function previewImport() {
  state.snapshot = parseSnapshot(refs["json-input"].value);
  const all = await chrome.cookies.getAll({ storeId: state.storeId });
  const target = new URL(state.tab.url);
  state.existing = all.filter((cookie) => cookieAppliesToHost(cookie, target.hostname, target.protocol));
  state.planned = state.snapshot.cookies.map((cookie) => planCookie(cookie, state.tab.url, state.storeId));
  state.selectedPreview = new Set(state.planned.flatMap((item, index) => item.status === "ready" ? [index] : []));
  refs["preview-panel"].classList.remove("hidden");
  renderPreview();
}

function renderPreview() {
  const policy = document.querySelector('input[name="policy"]:checked').value;
  const plan = summarizePlan(state.planned, state.existing, policy, state.selectedPreview);
  refs["preview-title"].textContent = state.snapshot.name || "导入预览";
  refs["preview-count"].textContent = `${plan.length} 项`;
  const unsupported = plan.filter((item) => item.status !== "ready").length;
  const skipped = plan.filter((item, index) => state.selectedPreview.has(index) && item.action === "skip").length;
  const changed = plan.filter((item, index) => state.selectedPreview.has(index) && item.changes?.length).length;
  refs["preview-note"].textContent = `域名映射到 ${new URL(state.tab.url).hostname}；${changed} 项属性变化，${skipped} 项同名跳过，${unsupported} 项不支持。`;
  refs["preview-list"].replaceChildren();
  for (const [index, item] of plan.entries()) {
    const row = document.createElement("label");
    row.className = "preview-row";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.disabled = item.status !== "ready";
    check.checked = state.selectedPreview.has(index);
    check.setAttribute("aria-label", `导入 ${item.cookie.name}`);
    check.addEventListener("change", () => {
      if (check.checked) state.selectedPreview.add(index);
      else state.selectedPreview.delete(index);
      renderPreview();
    });
    const main = document.createElement("span");
    main.className = "cookie-main";
    const name = document.createElement("span");
    name.className = "cookie-name";
    name.textContent = item.cookie.name;
    const detail = document.createElement("span");
    detail.className = "cookie-meta";
    detail.textContent = item.reason || (item.changes.length ? item.changes.join(" · ") : item.cookie.path);
    main.append(name, detail, createExpiryLine(item.cookie));
    const status = item.status !== "ready" ? tag("不支持", "danger")
      : item.action === "skip" ? tag("跳过", "warning")
        : item.conflict ? tag("覆盖", "warning") : tag("新增");
    row.append(check, main, status);
    refs["preview-list"].append(row);
  }
  const writable = plan.some((item, index) => state.selectedPreview.has(index) && item.action === "write");
  refs["import-button"].disabled = !writable;
  refs["import-button"].textContent = `导入 ${plan.filter((item, index) => state.selectedPreview.has(index) && item.action === "write").length} 项到当前站点`;
}

async function importCookies() {
  const policy = document.querySelector('input[name="policy"]:checked').value;
  const plan = summarizePlan(state.planned, state.existing, policy, state.selectedPreview);
  let written = 0;
  const failures = [];
  for (const [index, item] of plan.entries()) {
    if (!state.selectedPreview.has(index) || item.action !== "write") continue;
    try {
      const result = await chrome.cookies.set(item.details);
      if (!result) throw new Error("浏览器拒绝写入");
      written++;
    } catch (error) {
      failures.push(`${item.cookie.name}: ${error.message}`);
    }
  }
  await refreshCookies();
  if (failures.length) {
    notice(`成功 ${written} 项，失败 ${failures.length} 项：${failures.slice(0, 2).join("；")}`, true);
  } else {
    notice(`已导入 ${written} 项 Cookie`);
  }
  if (written) {
    await previewImport();
  }
}

async function run(operation) {
  try {
    await operation();
  } catch (error) {
    notice(error.message || String(error), true);
  }
}

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => showView(tab.dataset.view)));
document.getElementById("refresh-button").addEventListener("click", () => run(refreshCookies));
refs["cookie-search"].addEventListener("input", renderCurrent);
refs["saved-search"].addEventListener("input", renderSaved);
refs["select-all"].addEventListener("change", (event) => {
  state.selected = event.target.checked ? new Set(state.cookies.map((_, index) => index)) : new Set();
  renderCurrent();
});
refs["save-button"].addEventListener("click", () => run(saveSnapshot));
refs["copy-button"].addEventListener("click", () => run(() => copySnapshot(selectedSnapshot())));
document.getElementById("paste-button").addEventListener("click", () => run(async () => {
  refs["json-input"].value = await navigator.clipboard.readText();
  await previewImport();
}));
document.getElementById("preview-button").addEventListener("click", () => run(previewImport));
document.querySelectorAll('input[name="policy"]').forEach((input) => input.addEventListener("change", () => {
  if (state.snapshot) renderPreview();
}));
refs["json-input"].addEventListener("input", () => {
  state.snapshot = null;
  refs["preview-panel"].classList.add("hidden");
});
refs["import-button"].addEventListener("click", () => run(importCookies));

await run(async () => {
  await readActiveTab();
  const stored = await chrome.storage.local.get({ profiles: [] });
  state.profiles = stored.profiles;
  renderSaved();
  await refreshCookies();
});
