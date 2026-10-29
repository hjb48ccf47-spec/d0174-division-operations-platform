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
  function d0174MeetingExport() {
    const state = d0174MeetingState(), rows = [["月份", "行政總區日期", "D0174分區日期", "會議主題", "備註", "保存時間"], [state.month || "", state.regionDate || "", state.divisionDate || "", state.title || "", state.note || "", state.updatedAt || ""]];
    const csv = "\\ufeff" + rows.map(row => row.map(v => `"${String(v || "").replace(/"/g, '""')}"`).join(",")).join("\\r\\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" }), link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `D0174-月度業務交流會-${state.month || d0174MeetingMonth()}.csv`; link.click(); URL.revokeObjectURL(link.href);
    d0174MeetingStatus("已導出 D0174 會議設定記錄。");
  }
  function mountD0174Meeting() {
    if (!document.body || !document.body.innerText.includes("團隊出勤總覽")) return;
    let root = document.getElementById("d0174-business-meeting");
    if (!root) {
      root = document.createElement("section"); root.id = "d0174-business-meeting";
      const anchor = document.querySelector(".page") || document.querySelector("main") || document.body; anchor.appendChild(root);
      root.innerHTML = `<header><div><small>MONTHLY BUSINESS EXCHANGE</small><h3>月度業務交流會</h3><p>行政總區與 D0174 分區共用同一個月度交流會設定；簽到、請假及出勤統計沿用本會議記錄。</p></div></header><div class="d0174MeetingGrid"><label>會議月份<input data-d0174-field="month" type="month"></label><label>行政總區會議日期<input data-d0174-field="regionDate" type="date"></label><label>D0174 分區會議日期<input data-d0174-field="divisionDate" type="date"></label><label>會議主題<input data-d0174-field="title" value="業務交流會"></label><label class="wide">會議備註／通知<textarea data-d0174-field="note" rows="3" placeholder="填寫會議通知、出席要求或補充事項"></textarea></label></div><div class="d0174MeetingActions"><button type="button" data-d0174-action="save">保存會議設定</button><a data-d0174-action="checkin" target="_blank" rel="noopener">簽到入口</a><a data-d0174-action="leave" target="_blank" rel="noopener">請假入口</a><button type="button" data-d0174-action="export">導出會議記錄</button></div><p class="d0174MeetingStatus">尚未保存本月會議設定。</p>`;
      root.addEventListener("click", async (event) => { const target = event.target.closest("[data-d0174-action]"); if (!target) return; const state = d0174MeetingState(), month = root.querySelector('[data-d0174-field="month"]').value || d0174MeetingMonth();
        if (target.dataset.d0174Action === "save") { const next = { month, regionDate: root.querySelector('[data-d0174-field="regionDate"]').value, divisionDate: root.querySelector('[data-d0174-field="divisionDate"]').value, title: root.querySelector('[data-d0174-field="title"]').value.trim() || "業務交流會", note: root.querySelector('[data-d0174-field="note"]').value.trim(), updatedAt: new Date().toLocaleString("zh-HK") }; localStorage.setItem(D0174_MEETING_KEY, JSON.stringify(next)); d0174MeetingStatus(`已保存 ${month} D0174 月度業務交流會設定。`); }
        if (target.dataset.d0174Action === "export") d0174MeetingExport();
      });
    }
    const state = d0174MeetingState(), month = state.month || d0174MeetingMonth();
    root.querySelector('[data-d0174-field="month"]').value = month; root.querySelector('[data-d0174-field="regionDate"]').value = state.regionDate || ""; root.querySelector('[data-d0174-field="divisionDate"]').value = state.divisionDate || ""; root.querySelector('[data-d0174-field="title"]').value = state.title || "業務交流會"; root.querySelector('[data-d0174-field="note"]').value = state.note || "";
    const checkin = root.querySelector('[data-d0174-action="checkin"]'), leave = root.querySelector('[data-d0174-action="leave"]');
    Promise.all([d0174MeetingToken(month, "checkin"), d0174MeetingToken(month, "leave")]).then(([checkinToken, leaveToken]) => { checkin.href = d0174MeetingUrl(month, "checkin", checkinToken); leave.href = d0174MeetingUrl(month, "leave", leaveToken); });
  }

  const style = document.createElement("style");
  style.textContent = `#${ROOT_ID}{margin:22px 0;padding:22px;border:1px solid #ead9db;border-radius:20px;background:#fffafa;color:#263248}#${ROOT_ID} header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:12px}#${ROOT_ID} header small{color:#b52f39;letter-spacing:.15em;font-weight:800}#${ROOT_ID} h3{margin:4px 0;font-size:22px}#${ROOT_ID} header p{margin:0;color:#738095;font-size:13px}#${ROOT_ID} button{border:1px solid #d99ca2;border-radius:10px;background:#fff;color:#a72430;padding:8px 13px;font-weight:700;cursor:pointer}#${ROOT_ID} button:hover{background:#fff0f1}#${ROOT_ID} button.danger{color:#c33;border-color:#edc4c7}#${ROOT_ID} button.secondary{color:#68758a;border-color:#dce1e8}.meetingPatchStatus{margin:12px 0;padding:10px 12px;border-radius:10px;background:#f4f7fb;color:#536176}.meetingPatchStatus.error{background:#fff0f0;color:#b4232d}.meetingPatchGrid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.meetingPatchGrid>article{padding:16px;border:1px solid #e3e7ed;border-radius:15px;background:white}.meetingPatchGrid h4{display:flex;justify-content:space-between;margin:0 0 10px;font-size:17px}.meetingPatchGrid h4 span{color:#b52f39}.meetingPatchRow{display:grid;grid-template-columns:minmax(130px,1fr) minmax(120px,1.4fr) auto;align-items:center;gap:10px;padding:11px 0;border-top:1px solid #edf0f4}.meetingPatchIdentity{display:flex;flex-direction:column}.meetingPatchIdentity small{color:#8994a6}.meetingPatchDetail{font-size:14px;color:#4b586d}.meetingPatchActions{display:flex;gap:7px;justify-content:flex-end}.meetingPatchEditor{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:10px;width:100%}.meetingPatchEditor label{display:flex;flex-direction:column;gap:5px;font-size:12px;color:#68758a}.meetingPatchEditor label.wide{grid-column:1/-1}.meetingPatchEditor input,.meetingPatchEditor textarea{box-sizing:border-box;width:100%;border:1px solid #d7dce5;border-radius:9px;padding:9px;font:inherit;color:#263248;background:#fff}.meetingPatchEditor textarea{min-height:65px;resize:vertical}.meetingPatchEditor .meetingPatchActions{grid-column:1/-1}.meetingPatchEmpty{margin:8px 0;color:#8994a6;font-size:14px}@media(max-width:900px){.meetingPatchGrid{grid-template-columns:1fr}.meetingPatchRow{grid-template-columns:1fr}.meetingPatchActions{justify-content:flex-start}}`;
  document.head.appendChild(style);
  const d0174MeetingStyle = document.createElement("style");
  d0174MeetingStyle.textContent = `#d0174-business-meeting{margin:22px 0;padding:22px;border:1px solid #ead9db;border-radius:20px;background:#fffafa;color:#263248}#d0174-business-meeting header{margin-bottom:14px}#d0174-business-meeting header small{color:#b52f39;letter-spacing:.15em;font-weight:800}#d0174-business-meeting h3{margin:4px 0;font-size:22px}#d0174-business-meeting header p{margin:0;color:#738095;font-size:13px}.d0174MeetingGrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.d0174MeetingGrid label{display:flex;flex-direction:column;gap:6px;font-size:12px;color:#68758a}.d0174MeetingGrid label.wide{grid-column:1/-1}.d0174MeetingGrid input,.d0174MeetingGrid textarea{border:1px solid #d7dce5;border-radius:9px;padding:10px;font:inherit;color:#263248;background:#fff}.d0174MeetingActions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.d0174MeetingActions button,.d0174MeetingActions a{border:1px solid #d99ca2;border-radius:10px;background:#fff;color:#a72430;padding:9px 13px;font-weight:700;cursor:pointer;text-decoration:none}.d0174MeetingActions button:first-child{background:#c72832;color:#fff}.d0174MeetingStatus{margin:12px 0 0;padding:10px 12px;border-radius:10px;background:#f4f7fb;color:#536176}.d0174MeetingStatus.error{background:#fff0f0;color:#b4232d}@media(max-width:900px){.d0174MeetingGrid{grid-template-columns:1fr}.d0174MeetingGrid label.wide{grid-column:auto}}`;
  document.head.appendChild(d0174MeetingStyle);
  mount();
  mountD0174Meeting();
  window.setInterval(() => { mount(); mountD0174Meeting(); }, 1200);
})();
