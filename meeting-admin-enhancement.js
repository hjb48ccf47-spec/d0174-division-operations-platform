(function () {
  "use strict";

  const API = "/api/meeting-response";
  const ROOT_ID = "d0174-meeting-admin-enhancement";
  let records = [];
  let activeMonth = "";
  let loading = false;

  const escapeHtml = (value) => String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");

  const monthFromPage = () => {
    const link = document.querySelector('a[href*="/forms/meeting.html"][href*="type=leave"]');
    if (!link) return "";
    try { return new URL(link.href, location.origin).searchParams.get("meeting") || ""; }
    catch { return ""; }
  };

  const status = (message, error) => {
    const node = document.querySelector(`#${ROOT_ID} .meetingPatchStatus`);
    if (!node) return;
    node.textContent = message;
    node.classList.toggle("error", !!error);
  };

  async function api(url, options) {
    const response = await fetch(url, Object.assign({ credentials: "include", cache: "no-store" }, options || {}));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.status === 204 ? {} : response.json();
  }

  const localTime = (iso) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso || "";
    return new Intl.DateTimeFormat("zh-HK", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(date);
  };

  const datetimeValue = (iso) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  function rowHtml(item) {
    const detail = item.type === "leave" ? escapeHtml(item.reason || "未填理由") : escapeHtml(localTime(item.createdAt));
    return `<div class="meetingPatchRow" data-id="${escapeHtml(item.id)}">
      <div class="meetingPatchIdentity"><b>${escapeHtml(item.name)}</b><small>Agent Code ${escapeHtml(item.agentCode)}</small></div>
      <div class="meetingPatchDetail">${detail}</div>
      <div class="meetingPatchActions"><button type="button" data-action="edit">修改</button><button type="button" class="danger" data-action="delete">刪除</button></div>
    </div>`;
  }

  function render() {
    ["leave", "checkin"].forEach((type) => {
      const list = document.querySelector(`#${ROOT_ID} [data-list="${type}"]`);
      const count = document.querySelector(`#${ROOT_ID} [data-count="${type}"]`);
      if (!list || !count) return;
      const items = records.filter((item) => item.type === type);
      count.textContent = `${items.length} 筆`;
      list.innerHTML = items.length ? items.map(rowHtml).join("") : `<p class="meetingPatchEmpty">本月暫無${type === "leave" ? "請假" : "簽到"}記錄</p>`;
    });
  }

  async function load() {
    const month = monthFromPage();
    if (!month || loading) return;
    loading = true;
    status(`正在讀取 ${month} 提交名單…`);
    try {
      const data = await api(`${API}?meeting=${encodeURIComponent(month)}&_=${Date.now()}`);
      activeMonth = month;
      records = Array.isArray(data.items) ? data.items : [];
      render();
      status(`已同步 ${month}：請假 ${records.filter((x) => x.type === "leave").length} 筆，簽到 ${records.filter((x) => x.type === "checkin").length} 筆`);
    } catch (error) {
      status("提交名單讀取失敗，請重新整理後再試。", true);
    } finally { loading = false; }
  }

  function editRow(item, row) {
    row.innerHTML = `<div class="meetingPatchEditor">
      <label>姓名<input data-field="name" value="${escapeHtml(item.name)}"></label>
      <label>Agent Code<input data-field="agentCode" inputmode="numeric" value="${escapeHtml(item.agentCode)}"></label>
      ${item.type === "leave"
        ? `<label class="wide">請假理由<textarea data-field="reason">${escapeHtml(item.reason || "")}</textarea></label>`
        : `<label>簽到時間<input data-field="createdAt" type="datetime-local" value="${escapeHtml(datetimeValue(item.createdAt))}"></label>`}
      <div class="meetingPatchActions"><button type="button" data-action="save">保存修改</button><button type="button" class="secondary" data-action="cancel">取消</button></div>
    </div>`;
  }

  async function saveRow(item, row) {
    const name = row.querySelector('[data-field="name"]').value.trim();
    const agentCode = row.querySelector('[data-field="agentCode"]').value.replace(/\D/g, "");
    if (!name || !agentCode) return status("姓名及 Agent Code 不能留空。", true);
    const next = Object.assign({}, item, { name, agentCode });
    if (item.type === "leave") next.reason = row.querySelector('[data-field="reason"]').value.trim();
    else {
      const value = row.querySelector('[data-field="createdAt"]').value;
      if (!value) return status("請填寫簽到時間。", true);
      next.createdAt = new Date(value).toISOString();
    }
    status("正在保存修改…");
    try {
      await api(API, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      await load();
      status("修改已保存，導出表會使用最新資料。");
    } catch { status("修改保存失敗，請重試。", true); }
  }

  async function deleteRow(item) {
    if (!window.confirm(`確定刪除 ${item.name} 的${item.type === "leave" ? "請假" : "簽到"}記錄？`)) return;
    status("正在刪除記錄…");
    try {
      await api(`${API}?id=${encodeURIComponent(item.id)}`, { method: "DELETE" });
      await load();
      status("記錄已刪除。退出後可由 Agent 重新掃碼填報。 ");
    } catch { status("刪除失敗，請重試。", true); }
  }

  function csvCell(value) { return `"${String(value == null ? "" : value).replace(/"/g, '""')}"`; }
  async function exportCsv(type) {
    status("正在讀取最新資料並導出…");
    try {
      const month = monthFromPage();
      const data = await api(`${API}?meeting=${encodeURIComponent(month)}&_=${Date.now()}`);
      records = Array.isArray(data.items) ? data.items : [];
      render();
      const items = records.filter((item) => item.type === type);
      const header = type === "leave" ? ["序號", "姓名", "Agent Code", "分區", "請假理由"] : ["序號", "姓名", "Agent Code", "分區", "簽到時間"];
      const rows = items.map((item, index) => type === "leave"
        ? [index + 1, item.name, item.agentCode, "分區", item.reason || ""]
        : [index + 1, item.name, item.agentCode, "分區", localTime(item.createdAt)]);
      const csv = "\ufeff" + [header].concat(rows).map((row) => row.map(csvCell).join(",")).join("\r\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `分區${type === "leave" ? "請假" : "簽到"}人員表${month.replace("-", "")}.csv`;
      link.click(); URL.revokeObjectURL(link.href);
      status(`已導出 ${items.length} 筆${type === "leave" ? "請假" : "簽到"}記錄。`);
    } catch { status("導出失敗，請重新讀取後再試。", true); }
  }

  function bindExistingButtons(root) {
    Array.from(root.querySelectorAll("button")).forEach((button) => {
      const text = (button.textContent || "").trim();
      if (button.dataset.meetingPatchBound) return;
      if (text.includes("重新讀取提交名單")) button.addEventListener("click", (event) => { event.preventDefault(); event.stopImmediatePropagation(); load(); }, true);
      else if (text.includes("導出請假表")) button.addEventListener("click", (event) => { event.preventDefault(); event.stopImmediatePropagation(); exportCsv("leave"); }, true);
      else if (text.includes("導出簽到表")) button.addEventListener("click", (event) => { event.preventDefault(); event.stopImmediatePropagation(); exportCsv("checkin"); }, true);
      else return;
      button.dataset.meetingPatchBound = "1";
    });
  }

  function mount() {
    const leaveLink = document.querySelector('a[href*="/forms/meeting.html"][href*="type=leave"]');
    const checkinLink = document.querySelector('a[href*="/forms/meeting.html"][href*="type=checkin"]');
    if (!leaveLink || !checkinLink) return;
    const month = monthFromPage();
    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement("section");
      root.id = ROOT_ID;
      root.innerHTML = `<header><div><small>MONTHLY SUBMISSIONS</small><h3>本月掃碼提交記錄</h3><p>Agent 掃碼後自動出現在這裡；修改或刪除後，導出表同步使用最新資料。</p></div><button type="button" data-action="refresh">重新讀取</button></header>
        <p class="meetingPatchStatus">準備讀取提交名單…</p>
        <div class="meetingPatchGrid">
          <article><h4>請假記錄 <span data-count="leave">0 筆</span></h4><div data-list="leave"></div></article>
          <article><h4>簽到記錄 <span data-count="checkin">0 筆</span></h4><div data-list="checkin"></div></article>
        </div>`;
      const exportButtons = Array.from(document.querySelectorAll("button")).filter((button) => /導出(請假|簽到)表/.test(button.textContent || ""));
      const anchor = exportButtons.length ? exportButtons[exportButtons.length - 1] : checkinLink;
      (anchor.parentElement || checkinLink.parentElement).insertAdjacentElement("afterend", root);
      root.addEventListener("click", (event) => {
        if (!(event.target instanceof Element)) return;
        const button = event.target.closest("button[data-action]"); if (!button) return;
        const action = button.dataset.action;
        if (action === "refresh") return load();
        const row = button.closest(".meetingPatchRow"); if (!row) return;
        const item = records.find((entry) => entry.id === row.dataset.id); if (!item) return;
        if (action === "edit") editRow(item, row);
        else if (action === "cancel") render();
        else if (action === "save") saveRow(item, row);
        else if (action === "delete") deleteRow(item);
      });
    }
    bindExistingButtons(document);
    if (activeMonth !== month) load();
  }

  const D0174_MEETING_KEY = "d0174-business-meeting-v1";
  const d0174MeetingMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
  const d0174MeetingState = () => { try { return JSON.parse(localStorage.getItem(D0174_MEETING_KEY) || "null") || {}; } catch { return {}; } };
  const d0174MeetingUrl = (month, type, token) => `/meeting.html?meeting=${encodeURIComponent(month)}&type=${type}${token ? `&token=${encodeURIComponent(token)}` : ""}`;
  async function d0174MeetingToken(month, type) { try { const data = await api(`/api/meeting-token?meeting=${encodeURIComponent(month)}&_=${Date.now()}`); return data[type] || ""; } catch { return ""; } }
  function d0174MeetingStatus(text, error) { const node = document.querySelector("#d0174-business-meeting .d0174MeetingStatus"); if (!node) return; node.textContent = text; node.classList.toggle("error", !!error); }
  const d0174QrImageUrl = url => `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=${encodeURIComponent(url)}`;
  function d0174RenderQrList(root, type, items) {
    const list = root.querySelector(`[data-d0174-qr-list="${type}"]`); if (!list) return;
    const rows = items.filter(item => item.type === type);
    list.innerHTML = rows.length ? rows.map(item => `<div class="d0174QrPerson"><b>${escapeHtml(item.name || "未命名")}</b><span>${escapeHtml(item.agentCode || "")}</span><small>${escapeHtml(item.submittedAt || item.createdAt || "已提交")}</small></div>`).join("") : `<div class="d0174QrEmpty">目前尚未有${type === "checkin" ? "簽到" : "請假"}記錄</div>`;
  }
  async function d0174RefreshQrLists(root, month) {
    const data = await d0174ReadJson(`/api/meeting-response?meeting=${encodeURIComponent(month)}&_=${Date.now()}`, { items: [] });
    const items = Array.isArray(data.items) ? data.items : [];
    d0174RenderQrList(root, "checkin", items); d0174RenderQrList(root, "leave", items);
  }
  function d0174MeetingExport() {
    const state = d0174MeetingState(), rows = [["月份", "行政總區日期", "D0174分區日期", "會議主題", "備註", "保存時間"], [state.month || "", state.regionDate || "", state.divisionDate || "", state.title || "", state.note || "", state.updatedAt || ""]];
    const csv = "\\ufeff" + rows.map(row => row.map(v => `"${String(v || "").replace(/"/g, '""')}"`).join(",")).join("\\r\\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" }), link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `D0174-月度業務交流會-${state.month || d0174MeetingMonth()}.csv`; link.click(); URL.revokeObjectURL(link.href);
    d0174MeetingStatus("已導出 D0174 會議設定記錄。");
  }
  const D0174_MEMBERS_KEY = "d0174-manual-members-v1";
  const d0174ReadJson = async (url, fallback) => { try { const response = await fetch(url, { credentials: "include", cache: "no-store" }); if (!response.ok) return fallback; return await response.json(); } catch { return fallback; } };
  const d0174LoadMembers = () => { try { const value = JSON.parse(localStorage.getItem(D0174_MEMBERS_KEY) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } };
  const d0174SaveMembers = (members) => localStorage.setItem(D0174_MEMBERS_KEY, JSON.stringify(members));
  const d0174MonthLabel = (month) => { const [y, m] = String(month || d0174MeetingMonth()).split("-"); return `${y}年${Number(m)}月`; };

  function mountD0174Nav() {
    const nav = document.querySelector(".sidebar nav"); if (!nav) return;
    let button = nav.querySelector("[data-d0174-business-nav]");
    if (!button) { button = document.createElement("button"); button.setAttribute("data-d0174-business-nav", "1"); button.innerHTML = `<i>▣</i><span>業務交流會</span>`; nav.appendChild(button); }
    button.dataset.active = document.body?.dataset.d0174StandaloneMeeting === "1" ? "1" : "0";
    if (!button.dataset.d0174Bound) { button.dataset.d0174Bound = "1"; button.addEventListener("click", () => { document.body.dataset.d0174StandaloneMeeting = "1"; mountD0174Meeting(); }); }
    nav.querySelectorAll("button:not([data-d0174-business-nav])").forEach(item => { if (item.dataset.d0174RouteBound) return; item.dataset.d0174RouteBound = "1"; item.addEventListener("click", () => { document.body.dataset.d0174StandaloneMeeting = "0"; const page = document.querySelector(".page"); if (page) Array.from(page.children).forEach(child => { child.style.display = ""; }); document.getElementById("d0174-business-meeting")?.remove(); }); });
  }

  async function mountD0174Overview() {
    if (!document.body || !document.body.innerText.includes("D0174") || !document.body.innerText.includes("今天需要關注什麼")) return;
    const overview = document.querySelector(".managementOverview"); if (!overview) return;
    if (overview.dataset.d0174Custom === "1") return;
    overview.dataset.d0174Custom = "1";
    const month = d0174MeetingMonth();
    overview.innerHTML = `<section class="d0174FocusOverview"><div class="d0174FocusEyebrow">D0174 · VISUAL OVERVIEW</div><h2>可視化總覽</h2><p>只顯示新人入職進度與團隊出勤情況，方便每日跟進。</p><div class="d0174FocusGrid"><article><small>NEW JOINER PIPELINE</small><h3>新人入職進度</h3><div class="d0174FocusMetric" data-focus="new-count">0</div><p data-focus="new-summary">本月尚未建立新人資料。</p><div data-focus="new-list" class="d0174FocusList"></div><button type="button" data-focus-nav="people">查看新人檔案 →</button></article><article><small>TEAM ATTENDANCE</small><h3>團隊出勤情況</h3><div class="d0174FocusMetric" data-focus="attendance-count">0</div><p data-focus="attendance-summary">本月尚未有簽到記錄。</p><div data-focus="attendance-list" class="d0174FocusList"></div><button type="button" data-focus-nav="attendance">查看團隊出勤 →</button></article></div></section>`;
    overview.querySelectorAll("[data-focus-nav]").forEach(button => button.addEventListener("click", () => { const target = button.dataset.focusNav === "people" ? "◉ 人員檔案" : "▦ 團隊出勤"; Array.from(document.querySelectorAll(".sidebar button")).find(item => (item.textContent || "").includes(target))?.click(); }));
    const newcomers = await d0174ReadJson(`/api/newcomers?month=${encodeURIComponent(month)}&_=${Date.now()}`, { records: [] });
    const records = Array.isArray(newcomers.records) ? newcomers.records : [];
    const monthRecords = records.filter(item => String(item.processStartDate || item.joinDate || item.startMonth || "").startsWith(month));
    const manual = d0174LoadMembers();
    const meetings = await d0174ReadJson(`/api/meeting-response?meeting=${encodeURIComponent(month)}&_=${Date.now()}`, { items: [] });
    const submissions = Array.isArray(meetings.items) ? meetings.items : [];
    const checkins = submissions.filter(item => item.type === "checkin");
    const newCount = overview.querySelector('[data-focus="new-count"]'); if (newCount) newCount.textContent = String(monthRecords.length);
    const newSummary = overview.querySelector('[data-focus="new-summary"]'); if (newSummary) newSummary.textContent = monthRecords.length ? `${d0174MonthLabel(month)} 共 ${monthRecords.length} 位新人，按目前節點跟進。` : "本月尚未建立新人資料。";
    const newList = overview.querySelector('[data-focus="new-list"]'); if (newList) newList.innerHTML = monthRecords.slice(0, 8).map(item => `<div><b>${escapeHtml(item.nameZh || item.name || "未命名新人")}</b><span>${escapeHtml(item.currentStep || item.status || "入職辦理中")}</span></div>`).join("") || `<div class="d0174FocusEmpty">等待新人資料</div>`;
    const attCount = overview.querySelector('[data-focus="attendance-count"]'); if (attCount) attCount.textContent = String(checkins.length);
    const attSummary = overview.querySelector('[data-focus="attendance-summary"]'); if (attSummary) attSummary.textContent = checkins.length ? `${d0174MonthLabel(month)} 已有 ${checkins.length} 人完成簽到。` : `本月尚未有簽到記錄${manual.length ? `；目前名單 ${manual.length} 人。` : "。"}`;
    const attList = overview.querySelector('[data-focus="attendance-list"]'); if (attList) attList.innerHTML = checkins.slice(0, 8).map(item => `<div><b>${escapeHtml(item.name || "未命名")}</b><span>已簽到 · ${escapeHtml(item.agentCode || "")}</span></div>`).join("") || `<div class="d0174FocusEmpty">等待簽到資料</div>`;
  }

  function mountD0174Directory() {
    const isDirectory = Array.from(document.querySelectorAll("h2")).some(node => (node.textContent || "").includes("分區團隊通訊錄"));
    if (!isDirectory) { document.getElementById("d0174-manual-directory")?.remove(); return; }
    if (document.getElementById("d0174-manual-directory")) return;
    const page = document.querySelector(".page"); if (!page) return;
    const root = document.createElement("section"); root.id = "d0174-manual-directory";
    root.innerHTML = `<div class="d0174DirectoryHeader"><div><small>D0174 MEMBER ENTRY</small><h2>D0174 人員填寫入口</h2><p>新增或修改 D0174 團隊名單；保存後可供團隊檔案與出勤模組使用。</p></div><button type="button" data-member-action="new">＋ 新增人員</button></div><form class="d0174MemberForm" hidden><input type="hidden" data-member-field="id"><label>姓名<input required data-member-field="name" placeholder="例如：陳大文"></label><label>Agent Code<input data-member-field="code" placeholder="D0174-0001"></label><label>職級／角色<input data-member-field="role" placeholder="例如：FC"></label><label>類別<input data-member-field="category" placeholder="例如：FT／LA"></label><label>直接上線<input data-member-field="manager"></label><label>所屬管理組<input data-member-field="group"></label><label>狀態<select data-member-field="status"><option value="active">在職</option><option value="new">入職中</option><option value="inactive">離職</option></select></label><div class="d0174MemberFormActions"><button type="submit">保存人員</button><button type="button" data-member-action="cancel">取消</button></div></form><div class="d0174MemberList"></div>`;
    page.appendChild(root);
    const form = root.querySelector(".d0174MemberForm"), list = root.querySelector(".d0174MemberList");
    const render = () => { const members = d0174LoadMembers(); list.innerHTML = members.length ? `<table><thead><tr><th>姓名</th><th>Agent Code</th><th>職級</th><th>分組</th><th>狀態</th><th>操作</th></tr></thead><tbody>${members.map(item => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.code)}</td><td>${escapeHtml(item.role)}</td><td>${escapeHtml(item.group)}</td><td>${escapeHtml(item.status === "new" ? "入職中" : item.status === "inactive" ? "離職" : "在職")}</td><td><button type="button" data-member-edit="${escapeHtml(item.id)}">修改</button><button type="button" data-member-delete="${escapeHtml(item.id)}">刪除</button></td></tr>`).join("")}</tbody></table>` : `<div class="d0174DirectoryEmpty">尚未填寫 D0174 人員名單，請新增第一位人員。</div>`; };
    const setForm = item => { form.hidden = false; Object.entries(item || { id: "", name: "", code: "", role: "", category: "", manager: "", group: "", status: "active" }).forEach(([key, value]) => { const field = form.querySelector(`[data-member-field="${key}"]`); if (field) field.value = value || ""; }); };
    root.addEventListener("click", event => { const target = event.target.closest("button"); if (!target) return; if (target.dataset.memberAction === "new") setForm(); if (target.dataset.memberAction === "cancel") form.hidden = true; if (target.dataset.memberEdit) { const item = d0174LoadMembers().find(entry => entry.id === target.dataset.memberEdit); if (item) setForm(item); } if (target.dataset.memberDelete) { d0174SaveMembers(d0174LoadMembers().filter(entry => entry.id !== target.dataset.memberDelete)); render(); } });
    form.addEventListener("submit", event => { event.preventDefault(); const next = {}; form.querySelectorAll("[data-member-field]").forEach(field => { next[field.dataset.memberField] = field.value.trim(); }); const members = d0174LoadMembers(); next.id = next.id || `mem-${Date.now()}`; const index = members.findIndex(item => item.id === next.id); if (index >= 0) members[index] = next; else members.push(next); d0174SaveMembers(members); form.hidden = true; render(); });
    render();
  }

  function mountD0174Meeting() {
    const standalone = document.body?.dataset.d0174StandaloneMeeting === "1";
    if (!standalone) { document.getElementById("d0174-business-meeting")?.remove(); return; }
    let root = document.getElementById("d0174-business-meeting");
    if (!root) {
      root = document.createElement("section"); root.id = "d0174-business-meeting";
      const anchor = document.querySelector(".page") || document.querySelector("main") || document.body; anchor.appendChild(root);
      root.innerHTML = `<div class="d0174StandaloneHeading"><small>BUSINESS EXCHANGE</small><h2>業務交流會</h2><p>獨立管理 D0174 月度業務交流會、簽到及請假；簽到名單會同步到團隊出勤。</p></div><header><div><small>FIXED WORK</small><h3>每週／每月／半年固定工作</h3><p>選擇今天要處理的工作，點入後只顯示該項操作。</p></div></header><button type="button" class="d0174FixedCard" data-d0174-action="open"><i>02</i><span><small>每月1–2日</small><b>業務交流會請假與簽到</b><em>生成二維碼</em></span><strong>開始工作 →</strong></button><div class="d0174MeetingEditor"><div class="d0174MeetingLabel"><small>MONTHLY BUSINESS EXCHANGE</small><h3>月度業務交流會</h3><p>行政總區與 D0174 分區共用同一個月度交流會設定；簽到、請假及出勤統計沿用本會議記錄。</p></div></div><div class="d0174MeetingGrid"><label>會議月份<input data-d0174-field="month" type="month"></label><label>行政總區會議日期<input data-d0174-field="regionDate" type="date"></label><label>D0174 分區會議日期<input data-d0174-field="divisionDate" type="date"></label><label>會議主題<input data-d0174-field="title" value="業務交流會"></label><label class="wide">會議備註／通知<textarea data-d0174-field="note" rows="3" placeholder="填寫會議通知、出席要求或補充事項"></textarea></label></div><div class="d0174MeetingActions"><button type="button" data-d0174-action="save">保存會議設定</button><a data-d0174-action="checkin" target="_blank" rel="noopener">簽到入口</a><a data-d0174-action="leave" target="_blank" rel="noopener">請假入口</a><button type="button" data-d0174-action="export">導出會議記錄</button></div><div class="d0174QrGrid"><article><div class="d0174QrHeading"><b>簽到二維碼</b><span>掃碼填寫出席資料</span></div><img data-d0174-qr-image="checkin" alt="簽到二維碼"><a data-d0174-qr-link="checkin" target="_blank" rel="noopener">開啟簽到入口</a><div class="d0174QrRoster"><strong>簽到人員名單（同步團隊出勤）</strong><div data-d0174-qr-list="checkin">載入中…</div></div></article><article><div class="d0174QrHeading"><b>請假二維碼</b><span>掃碼填寫請假資料</span></div><img data-d0174-qr-image="leave" alt="請假二維碼"><a data-d0174-qr-link="leave" target="_blank" rel="noopener">開啟請假入口</a><div class="d0174QrRoster"><strong>請假人員名單</strong><div data-d0174-qr-list="leave">載入中…</div></div></article></div><p class="d0174MeetingStatus">尚未保存本月會議設定。</p>`;
      root.addEventListener("click", async (event) => { const target = event.target.closest("[data-d0174-action]"); if (!target) return; const state = d0174MeetingState(), month = root.querySelector('[data-d0174-field="month"]').value || d0174MeetingMonth();
        if (target.dataset.d0174Action === "open") { root.querySelector(".d0174MeetingGrid")?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
        if (target.dataset.d0174Action === "save") { const next = { month, regionDate: root.querySelector('[data-d0174-field="regionDate"]').value, divisionDate: root.querySelector('[data-d0174-field="divisionDate"]').value, title: root.querySelector('[data-d0174-field="title"]').value.trim() || "業務交流會", note: root.querySelector('[data-d0174-field="note"]').value.trim(), updatedAt: new Date().toLocaleString("zh-HK") }; localStorage.setItem(D0174_MEETING_KEY, JSON.stringify(next)); d0174MeetingStatus(`已保存 ${month} D0174 月度業務交流會設定。`); }
        if (target.dataset.d0174Action === "export") d0174MeetingExport();
      });
    }
    const page = document.querySelector(".page"); if (page) Array.from(page.children).forEach(child => { if (child !== root) child.style.display = "none"; });
    const state = d0174MeetingState(), month = state.month || d0174MeetingMonth();
    root.querySelector('[data-d0174-field="month"]').value = month; root.querySelector('[data-d0174-field="regionDate"]').value = state.regionDate || ""; root.querySelector('[data-d0174-field="divisionDate"]').value = state.divisionDate || ""; root.querySelector('[data-d0174-field="title"]').value = state.title || "業務交流會"; root.querySelector('[data-d0174-field="note"]').value = state.note || "";
    const checkin = root.querySelector('[data-d0174-action="checkin"]'), leave = root.querySelector('[data-d0174-action="leave"]');
    Promise.all([d0174MeetingToken(month, "checkin"), d0174MeetingToken(month, "leave")]).then(([checkinToken, leaveToken]) => { const checkinUrl = new URL(d0174MeetingUrl(month, "checkin", checkinToken), location.origin).href; const leaveUrl = new URL(d0174MeetingUrl(month, "leave", leaveToken), location.origin).href; checkin.href = checkinUrl; leave.href = leaveUrl; root.querySelector('[data-d0174-qr-link="checkin"]').href = checkinUrl; root.querySelector('[data-d0174-qr-link="leave"]').href = leaveUrl; root.querySelector('[data-d0174-qr-image="checkin"]').src = d0174QrImageUrl(checkinUrl); root.querySelector('[data-d0174-qr-image="leave"]').src = d0174QrImageUrl(leaveUrl); d0174RefreshQrLists(root, month); });
  }

  const style = document.createElement("style");
  style.textContent = `#${ROOT_ID}{margin:22px 0;padding:22px;border:1px solid #ead9db;border-radius:20px;background:#fffafa;color:#263248}#${ROOT_ID} header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:12px}#${ROOT_ID} header small{color:#b52f39;letter-spacing:.15em;font-weight:800}#${ROOT_ID} h3{margin:4px 0;font-size:22px}#${ROOT_ID} header p{margin:0;color:#738095;font-size:13px}#${ROOT_ID} button{border:1px solid #d99ca2;border-radius:10px;background:#fff;color:#a72430;padding:8px 13px;font-weight:700;cursor:pointer}#${ROOT_ID} button:hover{background:#fff0f1}#${ROOT_ID} button.danger{color:#c33;border-color:#edc4c7}#${ROOT_ID} button.secondary{color:#68758a;border-color:#dce1e8}.meetingPatchStatus{margin:12px 0;padding:10px 12px;border-radius:10px;background:#f4f7fb;color:#536176}.meetingPatchStatus.error{background:#fff0f0;color:#b4232d}.meetingPatchGrid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.meetingPatchGrid>article{padding:16px;border:1px solid #e3e7ed;border-radius:15px;background:white}.meetingPatchGrid h4{display:flex;justify-content:space-between;margin:0 0 10px;font-size:17px}.meetingPatchGrid h4 span{color:#b52f39}.meetingPatchRow{display:grid;grid-template-columns:minmax(130px,1fr) minmax(120px,1.4fr) auto;align-items:center;gap:10px;padding:11px 0;border-top:1px solid #edf0f4}.meetingPatchIdentity{display:flex;flex-direction:column}.meetingPatchIdentity small{color:#8994a6}.meetingPatchDetail{font-size:14px;color:#4b586d}.meetingPatchActions{display:flex;gap:7px;justify-content:flex-end}.meetingPatchEditor{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:10px;width:100%}.meetingPatchEditor label{display:flex;flex-direction:column;gap:5px;font-size:12px;color:#68758a}.meetingPatchEditor label.wide{grid-column:1/-1}.meetingPatchEditor input,.meetingPatchEditor textarea{box-sizing:border-box;width:100%;border:1px solid #d7dce5;border-radius:9px;padding:9px;font:inherit;color:#263248;background:#fff}.meetingPatchEditor textarea{min-height:65px;resize:vertical}.meetingPatchEditor .meetingPatchActions{grid-column:1/-1}.meetingPatchEmpty{margin:8px 0;color:#8994a6;font-size:14px}@media(max-width:900px){.meetingPatchGrid{grid-template-columns:1fr}.meetingPatchRow{grid-template-columns:1fr}.meetingPatchActions{justify-content:flex-start}}`;
  document.head.appendChild(style);
  const d0174MeetingStyle = document.createElement("style");
  d0174MeetingStyle.textContent = `#d0174-business-meeting{margin:22px 0;padding:22px;border:1px solid #ead9db;border-radius:20px;background:#fffafa;color:#263248}#d0174-business-meeting header{margin-bottom:14px}#d0174-business-meeting header small{color:#b52f39;letter-spacing:.15em;font-weight:800}#d0174-business-meeting h3{margin:4px 0;font-size:22px}#d0174-business-meeting header p{margin:0;color:#738095;font-size:13px}.d0174MeetingGrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.d0174MeetingGrid label{display:flex;flex-direction:column;gap:6px;font-size:12px;color:#68758a}.d0174MeetingGrid label.wide{grid-column:1/-1}.d0174MeetingGrid input,.d0174MeetingGrid textarea{border:1px solid #d7dce5;border-radius:9px;padding:10px;font:inherit;color:#263248;background:#fff}.d0174MeetingActions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.d0174MeetingActions button,.d0174MeetingActions a{border:1px solid #d99ca2;border-radius:10px;background:#fff;color:#a72430;padding:9px 13px;font-weight:700;cursor:pointer;text-decoration:none}.d0174MeetingActions button:first-child{background:#c72832;color:#fff}.d0174MeetingStatus{margin:12px 0 0;padding:10px 12px;border-radius:10px;background:#f4f7fb;color:#536176}.d0174MeetingStatus.error{background:#fff0f0;color:#b4232d}@media(max-width:900px){.d0174MeetingGrid{grid-template-columns:1fr}.d0174MeetingGrid label.wide{grid-column:auto}}`;
  document.head.appendChild(d0174MeetingStyle);
  const d0174FixedStyle = document.createElement("style");
  d0174FixedStyle.textContent = `#d0174-business-meeting .d0174FixedCard{width:100%;display:grid;grid-template-columns:42px 1fr auto;align-items:center;gap:14px;text-align:left;border:1px solid #e3e7ed;border-radius:15px;background:#fff;padding:16px;margin:12px 0 18px;color:#263248}#d0174-business-meeting .d0174FixedCard:hover{border-color:#c72832;background:#fff7f7}#d0174-business-meeting .d0174FixedCard i{width:36px;height:36px;border-radius:50%;background:#c72832;color:#fff;display:grid;place-items:center;font-style:normal;font-weight:800}#d0174-business-meeting .d0174FixedCard span{display:flex;flex-direction:column;gap:3px}#d0174-business-meeting .d0174FixedCard small{color:#b52f39;font-weight:800}#d0174-business-meeting .d0174FixedCard b{font-size:15px}#d0174-business-meeting .d0174FixedCard em{color:#738095;font-style:normal;font-size:12px}#d0174-business-meeting .d0174FixedCard strong{color:#b52f39;font-size:13px}#d0174-business-meeting .d0174MeetingEditor{border-top:1px solid #ead9db;padding-top:12px;margin-bottom:12px}#d0174-business-meeting .d0174MeetingLabel small{color:#b52f39;letter-spacing:.15em;font-weight:800}#d0174-business-meeting .d0174MeetingLabel h3{margin:4px 0;font-size:20px}#d0174-business-meeting .d0174MeetingLabel p{margin:0;color:#738095;font-size:13px}`;
  document.head.appendChild(d0174FixedStyle);
  const d0174CustomStyle = document.createElement("style");
  d0174CustomStyle.textContent = `#d0174-business-meeting .d0174FixedCard{width:100%;display:grid;grid-template-columns:42px 1fr auto;align-items:center;gap:14px;text-align:left;border:1px solid #e3e7ed;border-radius:15px;background:#fff;padding:16px;margin:12px 0 18px;color:#263248}#d0174-business-meeting .d0174FixedCard:hover{border-color:#c72832;background:#fff7f7}#d0174-business-meeting .d0174FixedCard i{width:36px;height:36px;border-radius:50%;background:#c72832;color:#fff;display:grid;place-items:center;font-style:normal;font-weight:800}#d0174-business-meeting .d0174FixedCard span{display:flex;flex-direction:column;gap:3px}#d0174-business-meeting .d0174FixedCard small{color:#b52f39;font-weight:800}#d0174-business-meeting .d0174FixedCard b{font-size:15px}#d0174-business-meeting .d0174FixedCard em{color:#738095;font-style:normal;font-size:12px}#d0174-business-meeting .d0174FixedCard strong{color:#b52f39;font-size:13px}.d0174FocusOverview{padding:30px;background:#fff;border-radius:18px;border:1px solid #e4e8ee}.d0174FocusEyebrow,.d0174FocusOverview small{color:#b52f39;letter-spacing:.15em;font-weight:800}.d0174FocusOverview h2{margin:6px 0;font-size:28px}.d0174FocusOverview>p{color:#738095}.d0174FocusGrid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:20px}.d0174FocusGrid article{border:1px solid #e1e6ed;border-radius:16px;padding:20px;background:#fffafa}.d0174FocusGrid h3{margin:6px 0;font-size:20px}.d0174FocusMetric{font-size:42px;font-weight:850;color:#b52f39}.d0174FocusGrid p{color:#68758a;min-height:25px}.d0174FocusList{display:grid;gap:7px;margin:12px 0}.d0174FocusList div{display:flex;justify-content:space-between;padding:9px 11px;border-radius:9px;background:#fff;border:1px solid #edf0f4}.d0174FocusList span{color:#738095;font-size:12px}.d0174FocusEmpty{color:#99a1ad!important;justify-content:flex-start!important}.d0174FocusGrid button,.d0174DirectoryHeader button,.d0174MemberForm button,.d0174MemberList button{border:1px solid #d99ca2;border-radius:9px;background:#fff;color:#a72430;padding:8px 12px;font-weight:700;cursor:pointer}.d0174FocusGrid button{margin-top:6px}.sidebar nav button[data-d0174-business-nav]{color:#a72430}.d0174DirectoryHeader{display:flex;justify-content:space-between;align-items:center;gap:15px;margin-top:22px;padding:20px;background:#fffafa;border:1px solid #ead9db;border-radius:16px}.d0174DirectoryHeader small{color:#b52f39;letter-spacing:.15em;font-weight:800}.d0174DirectoryHeader h2{margin:5px 0;font-size:20px}.d0174DirectoryHeader p{margin:0;color:#738095;font-size:12px}.d0174MemberForm{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:10px;padding:18px;background:#fff;border:1px solid #e3e7ed;border-radius:14px}.d0174MemberForm label{display:flex;flex-direction:column;gap:5px;font-size:12px;color:#68758a}.d0174MemberForm input,.d0174MemberForm select{border:1px solid #d7dce5;border-radius:9px;padding:9px;font:inherit}.d0174MemberFormActions{grid-column:1/-1;display:flex;gap:8px}.d0174MemberList{margin-top:10px;background:#fff;border:1px solid #e3e7ed;border-radius:14px;padding:15px}.d0174MemberList table{width:100%;border-collapse:collapse;font-size:12px}.d0174MemberList th,.d0174MemberList td{text-align:left;border-bottom:1px solid #edf0f4;padding:10px}.d0174DirectoryEmpty{color:#8994a6;padding:15px}.d0174MemberList button{margin-right:6px;padding:5px 9px;font-size:11px}@media(max-width:900px){.d0174FocusGrid,.d0174MemberForm{grid-template-columns:1fr}.d0174MemberFormActions{grid-column:auto}}`;
  document.head.appendChild(d0174CustomStyle);
  const d0174QrStyle = document.createElement("style");
  d0174QrStyle.textContent = `#d0174-business-meeting .d0174QrGrid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:18px}#d0174-business-meeting .d0174QrGrid article{border:1px solid #e3e7ed;border-radius:16px;background:#fff;padding:16px;text-align:center}#d0174-business-meeting .d0174QrHeading{display:flex;justify-content:space-between;align-items:baseline;gap:10px;text-align:left}.d0174QrHeading b{font-size:17px}.d0174QrHeading span{font-size:12px;color:#738095}.d0174QrGrid img{display:block;width:220px;height:220px;margin:14px auto 10px;border:1px solid #edf0f4;border-radius:10px}.d0174QrGrid>a{display:inline-block;color:#a72430;font-weight:700;text-decoration:none}.d0174QrRoster{margin-top:16px;border-top:1px solid #edf0f4;padding-top:12px;text-align:left}.d0174QrRoster>strong{font-size:13px;color:#4d586b}.d0174QrPerson{display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:9px 0;border-bottom:1px solid #f0f2f5}.d0174QrPerson span,.d0174QrPerson small{color:#738095;font-size:12px}.d0174QrPerson small{grid-column:1/-1}.d0174QrEmpty{padding:10px 0;color:#99a1ad;font-size:13px}@media(max-width:900px){#d0174-business-meeting .d0174QrGrid{grid-template-columns:1fr}#d0174-business-meeting .d0174QrGrid img{width:190px;height:190px}}`;
  document.head.appendChild(d0174QrStyle);
  const d0174NavStyle = document.createElement("style");
  d0174NavStyle.textContent = `.sidebar nav button[data-d0174-business-nav]{box-sizing:border-box!important;width:calc(100% - 18px)!important;min-height:48px!important;margin:7px 9px!important;padding:8px 14px!important;display:flex!important;align-items:center!important;gap:12px!important;text-align:left!important;color:#536176!important;background:transparent!important;border:0!important;border-left:4px solid transparent!important;border-radius:10px!important;box-shadow:none!important;font:inherit!important;font-size:14px!important;font-weight:600!important;line-height:1.2!important;cursor:pointer!important}.sidebar nav button[data-d0174-business-nav] i{box-sizing:border-box;width:32px;height:32px;display:grid;place-items:center;flex:0 0 32px;border-radius:9px;background:#fff0f1;color:#d6282f;font-style:normal;font-size:16px;font-weight:800}.sidebar nav button[data-d0174-business-nav]:hover{background:#fff3f4!important;color:#b5222b!important}.sidebar nav button[data-d0174-business-nav][data-active="1"]{background:#fde8ea!important;color:#b5222b!important;border-left-color:#e51d2a!important}`;
  document.head.appendChild(d0174NavStyle);
  mount();
  mountD0174Nav();
  mountD0174Overview();
  mountD0174Directory();
  mountD0174Meeting();
  window.setInterval(() => { mount(); mountD0174Nav(); mountD0174Overview(); mountD0174Directory(); mountD0174Meeting(); }, 1200);
})();
