(() => {
  "use strict";

  const STORE_KEY = "pair-journal-prototype-v5";
  const PASSWORDS = { me: "solarized", partner: "bluebird" };
  const VIEW_TITLES = {
    today: "今天，继续并肩",
    timeline: "我们的时间线",
    insights: "每周回望",
    stars: "属于彼此的 Stars"
  };
  const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clone = (value) => JSON.parse(JSON.stringify(value));

  function localISO(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function parseISO(value) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(date, amount) {
    const next = new Date(date);
    next.setDate(next.getDate() + amount);
    return next;
  }

  function startOfWeek(date) {
    const result = new Date(date);
    const day = result.getDay();
    result.setDate(result.getDate() - (day === 0 ? 6 : day - 1));
    result.setHours(0, 0, 0, 0);
    return result;
  }

  function shortDate(value) {
    const date = typeof value === "string" ? parseISO(value) : value;
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function fullDate(value) {
    const date = typeof value === "string" ? parseISO(value) : value;
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 · ${WEEKDAYS[date.getDay()]}`;
  }

  function logKey(roomId, roleId, date) {
    return `${roomId}|${roleId}|${date}`;
  }

  function walletKey(roomId, roleId) {
    return `${roomId}|${roleId}`;
  }

  function emptyLog() {
    return {
      growthText: "",
      lifeText: "",
      growthScore: 0,
      lifeScore: 0,
      images: [],
      updatedAt: null
    };
  }

  function defaultState() {
    const now = new Date();
    const today = localISO(now);
    const roles = {
      me: { id: "me", name: "我", initials: "我", avatar: "" },
      partner: { id: "partner", name: "搭档", initials: "友", avatar: "" }
    };
    const rooms = {
      pair: { id: "pair", name: "我们的日常", members: ["me", "partner"] }
    };
    const state = {
      version: 5,
      theme: "light",
      sessionRole: null,
      roles,
      rooms,
      logs: {},
      drafts: {},
      wallets: {
        "pair|me": { points: 78, stars: 1 },
        "pair|partner": { points: 42, stars: 1 }
      },
      wishes: [
        { id: "wish-1", roomId: "pair", from: "partner", to: "me", text: "一起去喝那家新开的咖啡", status: "done", createdAt: localISO(addDays(now, -8)) },
        { id: "wish-2", roomId: "pair", from: "me", to: "partner", text: "周末陪我散步一小时", status: "pending", createdAt: localISO(addDays(now, -1)) }
      ],
      reactions: {},
      backgrounds: { me: "", partner: "" }
    };

    seedActivity(state, now);

    const researchText = [
      "### change-agent",
      "- [x] 冻结一版代码，以支持后续的训练",
      "- [x] 构建“数据—训练—评测”的迭代流程",
      "",
      "`codex resume 019fb636-b283-71a2-9a50-77d4565c7289`",
      "",
      "### Prefix-GRPO",
      "- [x] 查看运行结果，确定下一步测试方向",
      "- [x] 参考 ARPO，检查中间状态能否产生可学习信号",
      "- [x] 开启 B 阶段训练",
      "",
      "### 杂活",
      "- [x] 调整账户额度",
      "- [ ] 配置 cc switch（暂缓）"
    ].join("\n");

    state.logs[logKey("pair", "me", today)] = {
      growthText: researchText,
      lifeText: "傍晚散步 30 分钟，顺便听完一期播客。",
      growthScore: 5,
      lifeScore: 2,
      images: [],
      updatedAt: "21:18"
    };
    state.logs[logKey("pair", "partner", today)] = {
      growthText: "背单词、看两节课、整理笔记",
      lifeText: "买花，晚上看了一集纪录片。",
      growthScore: 3,
      lifeScore: 3,
      images: [],
      updatedAt: "20:46"
    };
    const sampleDays = [
      {
        offset: -1,
        meGrowth: "### Prefix-GRPO\n- [x] 检查 rollout 日志\n- [x] 整理实验对比表",
        meLife: "晚饭后散步。",
        partnerGrowth: "复习、写作业",
        partnerLife: "羽毛球"
      },
      {
        offset: -2,
        meGrowth: "### change-agent\n- [x] 修复评测脚本\n- [ ] 补充 README",
        meLife: "和朋友聊了很久。",
        partnerGrowth: "阅读论文、整理笔记",
        partnerLife: "散步"
      },
      {
        offset: -4,
        meGrowth: "集中完成一轮数据清洗和 sanity check。",
        meLife: "看了一部老电影。",
        partnerGrowth: "背单词",
        partnerLife: "逛超市、收拾房间"
      },
      {
        offset: -6,
        meGrowth: "规划下一阶段实验矩阵。",
        meLife: "跑步 5km。",
        partnerGrowth: "课程作业",
        partnerLife: "做甜品"
      }
    ];

    sampleDays.forEach((sample, index) => {
      const date = localISO(addDays(now, sample.offset));
      const meScore = Math.max(2, 4 - (index % 2));
      const lifeScore = 2 + (index % 2);
      state.logs[logKey("pair", "me", date)] = {
        growthText: sample.meGrowth,
        lifeText: sample.meLife,
        growthScore: meScore,
        lifeScore,
        images: [],
        updatedAt: "22:10"
      };
      state.logs[logKey("pair", "partner", date)] = {
        growthText: sample.partnerGrowth,
        lifeText: sample.partnerLife,
        growthScore: 2 + ((index + 1) % 3),
        lifeScore: 2 + (index % 3),
        images: [],
        updatedAt: "21:04"
      };
    });
    return state;
  }

  function seedActivity(state, now) {
    Object.values(state.rooms).forEach((room) => {
      room.members.forEach((roleId, memberIndex) => {
        for (let offset = -111; offset <= -7; offset += 1) {
          const day = addDays(now, offset);
          const wave = Math.abs(Math.sin((offset * 1.73) + memberIndex));
          const rest = Math.abs(Math.cos((offset * 1.21) + memberIndex * 2));
          const weekday = day.getDay();
          const growthScore = weekday === 0 ? Math.round(wave * 2) : Math.round(wave * 5);
          const lifeScore = Math.round(rest * (weekday === 0 || weekday === 6 ? 5 : 3));
          if (growthScore + lifeScore === 0) continue;
          state.logs[logKey(room.id, roleId, localISO(day))] = {
            growthText: "",
            lifeText: "",
            growthScore,
            lifeScore,
            images: [],
            updatedAt: null
          };
        }
      });
    });
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return defaultState();
      const saved = JSON.parse(raw);
      if (!saved || saved.version !== 5) return defaultState();
      return saved;
    } catch (error) {
      console.warn("Could not load prototype data", error);
      return defaultState();
    }
  }

  if (new URLSearchParams(window.location.search).has("reset-demo")) {
    localStorage.removeItem(STORE_KEY);
    window.history.replaceState({}, "", window.location.pathname);
  }

  let state = loadState();
  let currentView = "today";
  let timelineFilter = "all";
  let insightPerson = "me";
  let editorMode = "edit";
  let draft = emptyLog();
  let draftTimer = null;
  let toastTimer = null;
  let cloudSession = false;
  let refreshTimer = null;
  let remoteRefreshInFlight = false;

  // The local snapshot is useful for the offline prototype, but must never be
  // treated as an authentication mechanism on a deployed site.  Only the
  // explicitly local hosts may use the demo fallback.
  const localPreviewHost = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);
  const canUseLocalFallback = () => window.location.protocol === "file:"
    || localPreviewHost.has(window.location.hostname);

  class ApiError extends Error {
    constructor(message, status = 0, code = "API_ERROR") {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.code = code;
    }
  }

  async function apiRequest(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    let body = null;
    try { body = await response.json(); } catch { /* empty response */ }
    if (!response.ok || !body?.ok) {
      throw new ApiError(body?.error?.message || `请求失败（${response.status}）`, response.status, body?.error?.code);
    }
    return body;
  }

  function mergeRemoteState(remote, roleId = state.sessionRole) {
    if (!remote || typeof remote !== "object") return false;
    const localDrafts = state?.drafts || {};
    state = {
      ...remote,
      theme: remote.theme === "dark" ? "dark" : remote.theme === "light" ? "light" : (state?.theme || "light"),
      drafts: { ...localDrafts, ...(remote.drafts || {}) },
      sessionRole: roleId || remote.sessionRole,
    };
    applyTheme();
    return true;
  }

  function isNetworkFailure(error) {
    return !(error instanceof ApiError) || !error.status || error.status >= 500;
  }

  function isEditorFocused() {
    const active = document.activeElement;
    return active?.id === "growth-text"
      || active?.id === "life-text"
      || Boolean(active?.closest?.("#editor-compose"));
  }

  function hasUnsavedTodayDraft() {
    if (!state.sessionRole || !draft) return false;
    const key = logKey(currentRoomId(), state.sessionRole, localISO());
    const saved = state.logs[key] || emptyLog();
    return ["growthText", "lifeText", "growthScore", "lifeScore", "images"]
      .some((field) => {
        if (field === "images") {
          return JSON.stringify(draft.images || []) !== JSON.stringify(saved.images || []);
        }
        return (draft[field] || 0) !== (saved[field] || 0);
      });
  }

  // Polling should keep the partner's view current without replacing a
  // textarea that the current user is typing in.  A full render replaces the
  // textarea nodes, which moves the caret (and can look like a page refresh).
  function renderRemoteWhileEditing() {
    renderChrome();
    renderPairSummary();
    renderEditorIdentity();
    renderPartnerPanel();
    if (currentView === "timeline") renderTimeline();
    if (currentView === "insights") renderInsights();
    if (currentView === "stars") renderStars();
    applyBackground();
  }

  async function refreshRemote({ silent = true } = {}) {
    if (!cloudSession || remoteRefreshInFlight) return false;
    remoteRefreshInFlight = true;
    // Preserve the in-memory keystrokes even if the 350ms local draft timer
    // has not fired before a poll/focus refresh starts.
    if (state.sessionRole && draft) {
      const key = logKey(currentRoomId(), state.sessionRole, localISO());
      const saved = state.logs[key] || emptyLog();
      const changed = ["growthText", "lifeText", "growthScore", "lifeScore", "images"]
        .some((field) => field === "images"
          ? JSON.stringify(draft.images || []) !== JSON.stringify(saved.images || [])
          : (draft[field] || 0) !== (saved[field] || 0));
      if (changed) state.drafts[key] = clone(draft);
    }
    try {
      const response = await apiRequest("/api/bootstrap", { method: "GET", headers: {} });
      mergeRemoteState(response.state, response.role || response.roleId || state.sessionRole);
      // Typing can continue while the request is in flight. Preserve that
      // latest in-memory draft against the freshly fetched log as well.
      if (state.sessionRole && draft && hasUnsavedTodayDraft()) {
        state.drafts[logKey(currentRoomId(), state.sessionRole, localISO())] = clone(draft);
      }
      persist();
      const preserveEditor = currentView === "today"
        && (isEditorFocused() || editorMode === "preview" || hasUnsavedTodayDraft());
      if (preserveEditor) renderRemoteWhileEditing();
      else renderApp();
      return true;
    } catch (error) {
      if (error.status === 401) {
        cloudSession = false;
        stopRemoteRefresh();
      }
      if (!silent) showToast(error.message || "同步失败");
      return false;
    } finally {
      remoteRefreshInFlight = false;
    }
  }

  function startRemoteRefresh() {
    stopRemoteRefresh();
    refreshTimer = window.setInterval(() => refreshRemote(), 20000);
  }

  function stopRemoteRefresh() {
    if (refreshTimer) window.clearInterval(refreshTimer);
    refreshTimer = null;
  }

  async function sendCommand(type, payload, { silent = false } = {}) {
    if (!cloudSession) return null;
    try {
      const response = await apiRequest("/api/command", {
        method: "POST",
        body: JSON.stringify({ type, payload }),
      });
      mergeRemoteState(response.state, state.sessionRole);
      persist();
      return response;
    } catch (error) {
      // A failed cloud command must not silently mutate a stale local copy.
      // Keep the session alive for transient server errors and let the user
      // retry; local fallback is reserved for the standalone preview.
      if (error.status === 401) {
        cloudSession = false;
        stopRemoteRefresh();
      }
      if (!silent) showToast(error.message || "同步失败，请稍后重试");
      return null;
    }
  }

  function persist() {
    try {
      // Do not cache the shared journal or signed media URLs on a public host.
      // Only the harmless preferences and unsaved drafts survive a reload;
      // authenticated data is fetched again through the HttpOnly session.
      const value = canUseLocalFallback()
        ? state
        : { version: 5, theme: state.theme || "light", sessionRole: null, drafts: state.drafts || {} };
      localStorage.setItem(STORE_KEY, JSON.stringify(value));
    } catch (error) {
      showToast("存储空间不足，请删除较大的图片后重试");
      console.warn("Could not persist prototype data", error);
    }
  }

  function currentRole() {
    return state.roles[state.sessionRole];
  }

  function currentRoomId() {
    return "pair";
  }

  function currentRoom() {
    return state.rooms[currentRoomId()];
  }

  function partnerId(roleId = state.sessionRole, room = currentRoom()) {
    return room.members.find((id) => id !== roleId);
  }

  function getLog(roomId, roleId, date = localISO()) {
    return state.logs[logKey(roomId, roleId, date)] || emptyLog();
  }

  function getWallet(roomId, roleId) {
    const key = walletKey(roomId, roleId);
    if (!state.wallets[key]) state.wallets[key] = { points: 0, stars: 0 };
    return state.wallets[key];
  }

  function setAvatar(element, roleId) {
    const role = state.roles[roleId];
    if (!element || !role) return;
    element.textContent = role.avatar ? "" : role.initials;
    element.style.backgroundImage = role.avatar ? `url("${role.avatar}")` : "";
    element.setAttribute("aria-label", role.name);
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2200);
  }

  function applyTheme() {
    document.documentElement.dataset.theme = state.theme;
    const themeColor = state.theme === "dark" ? "#002b36" : "#fdf6e3";
    $("meta[name='theme-color']").setAttribute("content", themeColor);
    $("#theme-toggle").textContent = state.theme === "dark" ? "☀" : "◐";
    $("#dialog-theme-toggle").textContent = state.theme === "dark" ? "切换到明亮" : "切换到深色";
  }

  function toggleTheme() {
    state.theme = state.theme === "dark" ? "light" : "dark";
    applyTheme();
    persist();
    if (cloudSession) {
      sendCommand("update_theme", { theme: state.theme }, { silent: true }).then((response) => {
        if (!response && cloudSession) refreshRemote({ silent: true });
      });
    }
  }

  function openSettings() {
    const input = $("#display-name");
    const error = $("#display-name-error");
    if (input && state.sessionRole) input.value = currentRole().name || "";
    if (error) error.textContent = "";
    $("#settings-dialog").showModal();
  }

  function normalizedDisplayName(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  async function saveDisplayName() {
    const input = $("#display-name");
    const error = $("#display-name-error");
    const button = $("#save-display-name");
    const name = normalizedDisplayName(input.value);
    const length = Array.from(name).length;
    error.textContent = "";

    if (!name) {
      error.textContent = "名字不能为空。";
      input.focus();
      return;
    }
    if (length > 16) {
      error.textContent = "名字最多 16 个字。";
      input.focus();
      return;
    }

    button.disabled = true;
    button.textContent = "保存中…";
    try {
      if (cloudSession) {
        const response = await sendCommand("update_name", { name }, { silent: true });
        if (response) {
          renderApp();
          input.value = currentRole().name || name;
          showToast("名字已同步给对方");
          return;
        }
        error.textContent = "暂时无法保存，请稍后重试。";
        return;
      }

      if (!canUseLocalFallback()) {
        error.textContent = "请重新登录后再试。";
        return;
      }
      const role = currentRole();
      role.name = name;
      if (!role.avatar) role.initials = Array.from(name)[0] || role.initials;
      persist();
      renderApp();
      input.value = name;
      showToast("名字已保存");
    } finally {
      button.disabled = false;
      button.textContent = "保存名字";
    }
  }

  function renderLoginPreview() {
    const grid = $("#login-preview-grid");
    grid.innerHTML = "";
    for (let i = 0; i < 70; i += 1) {
      const cell = document.createElement("i");
      const value = (i * 7 + i * i) % 9;
      if (value > 3) cell.className = `on-${Math.min(3, Math.ceil(value / 3))}`;
      grid.appendChild(cell);
    }
    const start = startOfWeek(new Date());
    const end = addDays(start, 6);
    $("#login-week-range").textContent = `${start.getMonth() + 1}.${start.getDate()}—${end.getMonth() + 1}.${end.getDate()}`;
  }

  function enterApp(roleId) {
    state.sessionRole = roleId;
    persist();
    $("#login-screen").classList.add("is-hidden");
    $("#app-shell").classList.remove("is-hidden");
    currentView = "today";
    insightPerson = roleId;
    renderApp();
    if (cloudSession) startRemoteRefresh();
  }

  async function login(roleId) {
    // roleId is supplied by the local demo fallback; the hosted build identifies it server-side.
    try {
      const response = await apiRequest("/api/login", {
        method: "POST",
        body: JSON.stringify({ password: $("#password").value }),
      });
      cloudSession = true;
      mergeRemoteState(response.state, response.role || response.roleId || roleId);
      enterApp(state.sessionRole);
      return;
    } catch (error) {
      // A wrong password is a real authentication failure, even when the
      // entered value happens to match an old local demo password.
      if (error.status === 401) {
        $("#login-error").textContent = error.message || "密码不对，请再试一次。";
        $("#password").select();
        return;
      }
      cloudSession = false;
      // Never fall back to browser-only data on a public deployment.  That
      // would make a stale localStorage snapshot look like a shared login.
      if (!canUseLocalFallback() || !roleId) {
        $("#login-error").textContent = canUseLocalFallback() && !roleId
          ? "密码不对，再看一眼本机预览密码。"
          : (error.message || "共享空间暂时不可用，请稍后重试。");
        return;
      }
      enterApp(roleId);
    }
  }

  async function logout() {
    if (cloudSession) {
      try { await apiRequest("/api/logout", { method: "POST", body: "{}" }); } catch { /* local logout still applies */ }
    }
    cloudSession = false;
    stopRemoteRefresh();
    state.sessionRole = null;
    persist();
    if (!canUseLocalFallback()) {
      window.location.reload();
      return;
    }
    $("#app-shell").classList.add("is-hidden");
    $("#login-screen").classList.remove("is-hidden");
    $("#password").value = "";
    $("#login-error").textContent = "";
    $("#password").focus();
  }

  function renderApp() {
    if (!state.sessionRole) return;
    renderChrome();
    loadTodayDraft();
    renderToday();
    renderTimeline();
    renderInsights();
    renderStars();
    applyBackground();
    navigate(currentView, false);
  }

  function renderChrome() {
    const role = currentRole();
    const room = currentRoom();
    $("#space-kicker").textContent = room.name;
    $("#sidebar-name").textContent = role.name;
    setAvatar($("#sidebar-avatar"), role.id);
    setAvatar($("#topbar-avatar"), role.id);
    $("#today-label").textContent = fullDate(new Date());
    $("#view-title").textContent = VIEW_TITLES[currentView];
  }

  function loadTodayDraft() {
    const roomId = currentRoomId();
    const roleId = state.sessionRole;
    const key = logKey(roomId, roleId, localISO());
    const savedDraft = state.drafts[key];
    draft = clone(savedDraft || getLog(roomId, roleId));
    draft.images = draft.images || [];
  }

  function renderEditorIdentity() {
    const roleId = state.sessionRole;
    if (!roleId || !state.roles[roleId]) return;
    setAvatar($("#editor-avatar"), roleId);
    $("#editor-name").textContent = state.roles[roleId].name;
  }

  function renderPartnerPanel() {
    const room = currentRoom();
    const partner = partnerId();
    const partnerLog = getLog(room.id, partner);
    setAvatar($("#partner-avatar"), partner);
    $("#partner-name").textContent = state.roles[partner].name;
    $("#partner-update").textContent = partnerLog.updatedAt ? `更新于 ${partnerLog.updatedAt}` : "今天还没有记录";
    const partnerContent = $("#partner-content");
    const hasPartnerContent = partnerLog.growthText || partnerLog.lifeText;
    partnerContent.classList.toggle("empty-journal", !hasPartnerContent);
    partnerContent.innerHTML = hasPartnerContent
      ? renderLogHTML(partnerLog)
      : `<div><strong>还在生活中</strong><p>对方记录后，会出现在这里。</p></div>`;
    renderReaction(partner);
  }

  function renderToday({ preserveEditor = false } = {}) {
    renderPairSummary();
    renderEditorIdentity();
    if (!preserveEditor) {
      $("#growth-text").value = draft.growthText || "";
      $("#life-text").value = draft.lifeText || "";
      renderScorePicker($("#growth-score"), "growthScore", draft.growthScore || 0);
      renderScorePicker($("#life-score"), "lifeScore", draft.lifeScore || 0);
    }
    renderPartnerPanel();
    if (!preserveEditor) setEditorMode(editorMode, { saveDraft: false });
  }

  function setEditorMode(mode, { saveDraft = true } = {}) {
    editorMode = mode === "preview" ? "preview" : "edit";
    if (editorMode === "preview") {
      draft.growthText = $("#growth-text").value;
      draft.lifeText = $("#life-text").value;
      const html = renderLogHTML(draft);
      const preview = $("#editor-preview");
      preview.classList.toggle("empty-journal", !html);
      preview.innerHTML = html || `<div><strong>还没有可预览的内容</strong><p>返回编辑，写下一点今天发生的事。</p></div>`;
      if (saveDraft) scheduleDraftSave();
    }
    $("#editor-compose").classList.toggle("is-hidden", editorMode === "preview");
    $("#editor-preview").classList.toggle("is-hidden", editorMode !== "preview");
    $$("#editor-mode-toggle button").forEach((button) => {
      const active = button.dataset.mode === editorMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function renderPairSummary() {
    const room = currentRoom();
    const container = $("#pair-summary");
    const orderedMembers = [state.sessionRole, partnerId(state.sessionRole, room)]
      .filter((roleId, index, members) => roleId && members.indexOf(roleId) === index);
    container.innerHTML = orderedMembers.map((roleId) => {
      const role = state.roles[roleId];
      const wallet = getWallet(room.id, roleId);
      return `
        <article class="progress-card">
          <span class="avatar" data-avatar="${roleId}"></span>
          <div class="progress-copy">
            <div><strong>${escapeHTML(role.name)}</strong><span>${wallet.points}/100</span></div>
            <div class="progress-track"><i style="width:${wallet.points}%"></i></div>
          </div>
          <div class="progress-meta"><strong>${wallet.stars} ★</strong><small>可用</small></div>
        </article>`;
    }).join("");
    $$('[data-avatar]', container).forEach((element) => setAvatar(element, element.dataset.avatar));
  }

  function renderScorePicker(container, field, selected) {
    container.innerHTML = "";
    for (let value = 0; value <= 5; value += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `score-button${selected === value ? " is-active" : ""}`;
      button.textContent = value;
      button.setAttribute("aria-label", `${value} 分`);
      button.setAttribute("aria-pressed", selected === value ? "true" : "false");
      button.addEventListener("click", () => {
        draft[field] = value;
        renderScorePicker(container, field, value);
        scheduleDraftSave();
      });
      container.appendChild(button);
    }
  }

  function scheduleDraftSave() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      const key = logKey(currentRoomId(), state.sessionRole, localISO());
      // A save can finish before this debounce fires. Do not resurrect a
      // draft that is already identical to the committed log.
      if (hasUnsavedTodayDraft()) state.drafts[key] = clone(draft);
      else delete state.drafts[key];
      persist();
      draftTimer = null;
    }, 350);
  }

  function applyScoreDelta(roomId, roleId, delta) {
    const wallet = getWallet(roomId, roleId);
    if (delta > 0) {
      wallet.points += delta;
      while (wallet.points >= 100) {
        wallet.points -= 100;
        wallet.stars += 1;
        showToast("满 100 分，获得了一颗新的 Star ★");
      }
    } else if (delta < 0) {
      wallet.points = Math.max(0, wallet.points + delta);
    }
  }

  async function saveToday() {
    clearTimeout(draftTimer);
    draftTimer = null;
    draft.growthText = $("#growth-text").value.trim();
    draft.lifeText = $("#life-text").value.trim();
    draft.updatedAt = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
    const today = localISO();
    const roomId = currentRoomId();
    const key = logKey(roomId, state.sessionRole, today);
    const previous = state.logs[key] || emptyLog();
    const oldScore = (previous.growthScore || 0) + (previous.lifeScore || 0);
    const newScore = (draft.growthScore || 0) + (draft.lifeScore || 0);
    if (cloudSession) {
      const response = await sendCommand("save_log", {
        date: today,
        growthText: draft.growthText,
        lifeText: draft.lifeText,
        growthScore: draft.growthScore || 0,
        lifeScore: draft.lifeScore || 0,
        images: draft.images || [],
      });
      if (response) {
        delete state.drafts[key];
      } else {
        return;
      }
    }
    if (!cloudSession) {
      state.logs[key] = clone(draft);
      delete state.drafts[key];
      applyScoreDelta(roomId, state.sessionRole, newScore - oldScore);
      persist();
    }
    renderToday();
    renderTimeline();
    renderInsights();
    renderStars();
    showToast(cloudSession ? "今日记录已同步" : "今日记录已保存");
  }

  function renderReaction(targetRoleId) {
    const key = `${currentRoomId()}|${targetRoleId}|${localISO()}`;
    const record = state.reactions[key] || { count: 0, by: [] };
    const active = record.by.includes(state.sessionRole);
    $("#reaction-count").textContent = record.count;
    $("#reaction-button").classList.toggle("is-active", active);
    $("#reaction-button").firstChild.textContent = active ? "♥ " : "♡ ";
    $("#reaction-button").onclick = async () => {
      if (cloudSession) {
        const response = await sendCommand("toggle_reaction", { targetRoleId, date: localISO() });
        if (response) {
          renderToday();
          return;
        }
        return;
      }
      if (active) {
        record.by = record.by.filter((id) => id !== state.sessionRole);
        record.count = Math.max(0, record.count - 1);
      } else {
        record.by.push(state.sessionRole);
        record.count += 1;
      }
      state.reactions[key] = record;
      persist();
      renderReaction(targetRoleId);
    };
  }

  function escapeHTML(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function inlineMarkdown(value) {
    return escapeHTML(value).replace(/`([^`]+)`/g, "<code>$1</code>");
  }

  function markdownToHTML(text) {
    if (!text) return "";
    return text.split(/\r?\n/).map((line) => {
      const heading = line.match(/^#{1,4}\s+(.+)$/);
      if (heading) return `<h3>${inlineMarkdown(heading[1])}</h3>`;
      const task = line.match(/^\s*-\s*\[([xX ])\]\s+(.+)$/);
      if (task) {
        const done = task[1].toLowerCase() === "x";
        return `<div class="task-line${done ? " is-done" : ""}"><span class="task-box">${done ? "✓" : ""}</span><span class="task-copy">${inlineMarkdown(task[2])}</span></div>`;
      }
      const bullet = line.match(/^\s*-\s+(.+)$/);
      if (bullet) return `<p>•&nbsp; ${inlineMarkdown(bullet[1])}</p>`;
      if (!line.trim()) return `<div class="journal-gap"></div>`;
      return `<p>${inlineMarkdown(line)}</p>`;
    }).join("");
  }

  function renderLogHTML(log, filter = "all") {
    const parts = [];
    if ((filter === "all" || filter === "growth") && (log.growthText || log.growthScore)) {
      parts.push(`
        <section class="journal-section">
          <div class="journal-section-title"><strong>学习与工作</strong><small>${log.growthScore || 0}/5</small></div>
          ${markdownToHTML(log.growthText)}
        </section>`);
    }
    if ((filter === "all" || filter === "life") && (log.lifeText || log.lifeScore)) {
      parts.push(`
        <section class="journal-section">
          <div class="journal-section-title"><strong>生活与娱乐</strong><small>${log.lifeScore || 0}/5</small></div>
          ${markdownToHTML(log.lifeText)}
        </section>`);
    }
    if (filter === "all") {
      (log.images || []).forEach((src, index) => {
        parts.push(`<img class="journal-photo" src="${escapeHTML(src)}" alt="记录图片 ${index + 1}">`);
      });
    }
    return parts.join("");
  }

  function stripMarkdown(text) {
    return String(text || "")
      .replace(/^#{1,4}\s+/gm, "")
      .replace(/^\s*-\s*\[[xX ]\]\s+/gm, "")
      .replace(/^\s*-\s+/gm, "")
      .replace(/`/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function renderTimeline() {
    const room = currentRoom();
    const container = $("#timeline-list");
    const allDates = new Set();
    Object.entries(state.logs).forEach(([key, log]) => {
      const [roomId, roleId, date] = key.split("|");
      if (roomId !== room.id || !room.members.includes(roleId)) return;
      const visibleText = timelineFilter === "growth" ? log.growthText : timelineFilter === "life" ? log.lifeText : `${log.growthText || ""}${log.lifeText || ""}`;
      if (visibleText && parseISO(date) <= new Date()) allDates.add(date);
    });
    const dates = [...allDates].sort().reverse().slice(0, 12);
    if (!dates.length) {
      container.innerHTML = `<div class="empty-state">这个筛选条件下还没有共同记录。</div>`;
      return;
    }
    container.innerHTML = dates.map((date) => {
      const dateObj = parseISO(date);
      const people = room.members.map((roleId) => {
        const role = state.roles[roleId];
        const log = getLog(room.id, roleId, date);
        const source = timelineFilter === "growth" ? log.growthText : timelineFilter === "life" ? log.lifeText : `${log.growthText || ""} ${log.lifeText || ""}`;
        const snippet = stripMarkdown(source);
        return `
          <div class="timeline-person">
            <header><span class="avatar" data-avatar="${roleId}"></span><strong>${escapeHTML(role.name)}</strong></header>
            <div class="timeline-snippet">${snippet ? escapeHTML(snippet.slice(0, 160)) + (snippet.length > 160 ? "…" : "") : "这一天没有留下文字。"}</div>
            <div class="timeline-scores">
              <span class="score-tag">学习 ${log.growthScore || 0}</span>
              <span class="score-tag life">生活 ${log.lifeScore || 0}</span>
            </div>
          </div>`;
      }).join("");
      return `
        <section class="timeline-day">
          <div class="timeline-date"><strong>${dateObj.getDate()}</strong><span>${dateObj.getMonth() + 1}月 · ${WEEKDAYS[dateObj.getDay()]}</span></div>
          <article class="timeline-entry">${people}</article>
        </section>`;
    }).join("");
    $$('[data-avatar]', container).forEach((element) => setAvatar(element, element.dataset.avatar));
  }

  function logsForRange(roomId, roleId, start, days) {
    return Array.from({ length: days }, (_, index) => {
      const date = addDays(start, index);
      return { date, log: getLog(roomId, roleId, localISO(date)) };
    });
  }

  function calculateStreak(roomId, roleId) {
    let streak = 0;
    for (let offset = 0; offset > -365; offset -= 1) {
      const log = getLog(roomId, roleId, localISO(addDays(new Date(), offset)));
      if ((log.growthScore || 0) + (log.lifeScore || 0) > 0) streak += 1;
      else if (offset === 0) continue;
      else break;
    }
    return streak;
  }

  function countDoneTasks(logs) {
    return logs.reduce((total, item) => {
      const content = `${item.log.growthText || ""}\n${item.log.lifeText || ""}`;
      return total + (content.match(/^\s*-\s*\[[xX]\]/gm) || []).length;
    }, 0);
  }

  function renderInsights() {
    const room = currentRoom();
    if (!room.members.includes(insightPerson)) insightPerson = state.sessionRole;
    const tabs = $("#insight-person-tabs");
    tabs.innerHTML = "";
    room.members.forEach((roleId) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = insightPerson === roleId ? "is-active" : "";
      button.textContent = state.roles[roleId].name;
      button.addEventListener("click", () => {
        insightPerson = roleId;
        renderInsights();
      });
      tabs.appendChild(button);
    });

    const weekStart = startOfWeek(new Date());
    const thisWeek = logsForRange(room.id, insightPerson, weekStart, 7);
    const previousWeek = logsForRange(room.id, insightPerson, addDays(weekStart, -7), 7);
    const growth = thisWeek.reduce((sum, item) => sum + (item.log.growthScore || 0), 0);
    const life = thisWeek.reduce((sum, item) => sum + (item.log.lifeScore || 0), 0);
    const total = growth + life;
    const previousTotal = previousWeek.reduce((sum, item) => sum + (item.log.growthScore || 0) + (item.log.lifeScore || 0), 0);
    const delta = total - previousTotal;
    const done = countDoneTasks(thisWeek);
    const stats = [
      { label: "本周总分", value: total, unit: "分", note: `${delta >= 0 ? "+" : ""}${delta} 较上周` },
      { label: "学习与工作", value: growth, unit: "/35", note: "按每日自评分累计" },
      { label: "生活与娱乐", value: life, unit: "/35", note: "保持自己的节奏" },
      { label: "连续记录", value: calculateStreak(room.id, insightPerson), unit: "天", note: done ? `本周完成 ${done} 项` : "不按任务条数计分" }
    ];
    $("#insight-stats").innerHTML = stats.map((stat) => `
      <article class="stat-card"><span>${stat.label}</span><strong>${stat.value}</strong><small>${stat.unit}</small><em>${stat.note}</em></article>
    `).join("");

    const heatStart = addDays(weekStart, -15 * 7);
    renderHeatmap($("#growth-heatmap"), room.id, insightPerson, heatStart, "growthScore");
    renderHeatmap($("#life-heatmap"), room.id, insightPerson, heatStart, "lifeScore");
    renderWeeklyChart(thisWeek);
    const weekEnd = addDays(weekStart, 6);
    $("#weekly-caption").textContent = `${shortDate(weekStart)}—${shortDate(weekEnd)} · 每日上限 10 分`;
  }

  function renderHeatmap(container, roomId, roleId, start, field) {
    const grid = document.createElement("div");
    grid.className = "heatmap-grid";
    const entries = logsForRange(roomId, roleId, start, 112);
    for (let weekIndex = 0; weekIndex < 16; weekIndex += 1) {
      const week = document.createElement("div");
      week.className = "heat-week";
      entries.slice(weekIndex * 7, weekIndex * 7 + 7).forEach(({ date, log }) => {
        const value = Number(log[field] || 0);
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "heat-cell";
        cell.dataset.level = String(Math.max(0, Math.min(5, value)));
        cell.title = `${fullDate(date)} · ${value}/5`;
        cell.setAttribute("aria-label", cell.title);
        cell.addEventListener("click", () => showToast(`${shortDate(date)}：${field === "growthScore" ? "学习工作" : "生活娱乐"} ${value}/5`));
        week.appendChild(cell);
      });
      grid.appendChild(week);
    }
    container.replaceChildren(grid);
  }

  function renderWeeklyChart(items) {
    const chart = $("#weekly-chart");
    chart.innerHTML = items.map(({ date, log }) => {
      const growth = Number(log.growthScore || 0);
      const life = Number(log.lifeScore || 0);
      const total = growth + life;
      const isToday = localISO(date) === localISO();
      return `
        <div class="week-column${isToday ? " is-today" : ""}">
          <div class="bar-stage">
            <strong class="week-total">${total || "—"}</strong>
            <div class="bar-stack" aria-label="${shortDate(date)}，学习工作 ${growth} 分，生活娱乐 ${life} 分，总计 ${total} 分" title="学习 ${growth} · 生活 ${life}">
              <i class="week-bar life" style="height:${life * 13}px"></i>
              <i class="week-bar growth" style="height:${growth * 13}px"></i>
            </div>
          </div>
          <small>${WEEKDAYS[date.getDay()].slice(1)}</small>
          <span class="week-date">${date.getMonth() + 1}/${date.getDate()}</span>
        </div>`;
    }).join("");
  }

  function renderStars() {
    const room = currentRoom();
    const walletGrid = $("#wallet-grid");
    walletGrid.innerHTML = room.members.map((roleId) => {
      const role = state.roles[roleId];
      const wallet = getWallet(room.id, roleId);
      return `
        <article class="wallet-card">
          <span class="avatar" data-avatar="${roleId}"></span>
          <div class="wallet-copy">
            <div><span>${escapeHTML(role.name)} 的关系钱包</span><strong>${wallet.stars} ★</strong></div>
            <div class="progress-track"><i style="width:${wallet.points}%"></i></div>
            <small>${wallet.points}/100 · 再得 ${100 - wallet.points} 分获得下一颗</small>
          </div>
        </article>`;
    }).join("");
    $$('[data-avatar]', walletGrid).forEach((element) => setAvatar(element, element.dataset.avatar));
    renderWishes();
  }

  function renderWishes() {
    const roomId = currentRoomId();
    const list = $("#wish-list");
    const wishes = state.wishes.filter((wish) => wish.roomId === roomId).slice().reverse();
    if (!wishes.length) {
      list.innerHTML = `<div class="empty-state">第一颗 Star，可以兑换一件很小但很具体的事。</div>`;
      return;
    }
    const statusText = { pending: "待回应", accepted: "已接受", done: "已完成" };
    list.innerHTML = "";
    wishes.forEach((wish) => {
      const item = document.createElement("div");
      item.className = "wish-item";
      const actionable = wish.to === state.sessionRole && wish.status !== "done";
      const nextLabel = wish.status === "pending" ? "接受愿望" : wish.status === "accepted" ? "标记完成" : "已完成";
      item.innerHTML = `
        <span class="wish-star">★</span>
        <div class="wish-copy">
          <strong>${escapeHTML(wish.text)}</strong>
          <small>${escapeHTML(state.roles[wish.from].name)} → ${escapeHTML(state.roles[wish.to].name)} · ${shortDate(wish.createdAt)}</small>
        </div>
        <button type="button" class="wish-status${wish.status === "done" ? " done" : ""}" ${actionable ? "" : "disabled"}>${actionable ? nextLabel : statusText[wish.status]}</button>
      `;
      const button = $(".wish-status", item);
      if (actionable) {
        button.addEventListener("click", async () => {
          const nextStatus = wish.status === "pending" ? "accepted" : "done";
          if (cloudSession) {
            const response = await sendCommand("update_wish", { wishId: wish.id, status: nextStatus });
            if (response) {
              renderStars();
              showToast(nextStatus === "accepted" ? "已接受这个愿望" : "愿望完成，真好 ★");
              return;
            }
            return;
          }
          wish.status = nextStatus;
          persist();
          renderWishes();
          showToast(wish.status === "accepted" ? "已接受这个愿望" : "愿望完成，真好 ★");
        });
      }
      list.appendChild(item);
    });
  }

  async function createWish(event) {
    event.preventDefault();
    const text = $("#wish-text").value.trim();
    const error = $("#wish-error");
    error.textContent = "";
    if (!text) {
      error.textContent = "请先写下一个具体的小愿望。";
      return;
    }
    if (cloudSession) {
      const response = await sendCommand("create_wish", { text });
      if (response) {
        $("#wish-text").value = "";
        renderStars();
        showToast("已使用 1 颗 Star 发出愿望");
        return;
      }
      return;
    }
    const wallet = getWallet(currentRoomId(), state.sessionRole);
    if (wallet.stars < 1) {
      error.textContent = "这段关系中还没有可用的 Star。";
      return;
    }
    wallet.stars -= 1;
    state.wishes.push({
      id: `wish-${Date.now()}`,
      roomId: currentRoomId(),
      from: state.sessionRole,
      to: partnerId(),
      text,
      status: "pending",
      createdAt: localISO()
    });
    $("#wish-text").value = "";
    persist();
    renderStars();
    showToast("已使用 1 颗 Star 发出愿望");
  }

  function navigate(view, shouldScroll = true) {
    currentView = view;
    $$(".view").forEach((element) => element.classList.toggle("is-active", element.id === `view-${view}`));
    $$('[data-view]').forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
    $("#view-title").textContent = VIEW_TITLES[view];
    if (view === "timeline") renderTimeline();
    if (view === "insights") renderInsights();
    if (view === "stars") renderStars();
    if (shouldScroll) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function fileToDataURL(file, maxWidth, maxHeight, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const image = new Image();
        image.onerror = reject;
        image.onload = () => {
          const ratio = Math.min(1, maxWidth / image.width, maxHeight / image.height);
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.width * ratio));
          canvas.height = Math.max(1, Math.round(image.height * ratio));
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function applyBackground() {
    const source = state.backgrounds[state.sessionRole] || "";
    $("#app-shell").style.backgroundImage = source ? `url("${source}")` : "";
  }

  async function handleImageUpload(input, kind) {
    const file = input.files && input.files[0];
    if (!file) return;
    let dataUrl = "";
    try {
      dataUrl = await fileToDataURL(file, kind === "avatar" ? 320 : 1600, kind === "avatar" ? 320 : 1000, kind === "avatar" ? 0.84 : 0.76);
      if (cloudSession) {
        const response = await apiRequest("/api/media", {
          method: "POST",
          body: JSON.stringify({ kind, dataUrl }),
        });
        mergeRemoteState(response.state, state.sessionRole);
        persist();
        renderApp();
        showToast(kind === "avatar" ? "头像已更新" : "背景已更新");
        return;
      }
      if (kind === "avatar") {
        state.roles[state.sessionRole].avatar = dataUrl;
        persist();
        renderApp();
        showToast("头像已更新");
      } else if (kind === "background") {
        state.backgrounds[state.sessionRole] = dataUrl;
        persist();
        applyBackground();
        showToast("背景已更新");
      }
    } catch (error) {
      console.warn("Image upload failed", error);
      if (cloudSession && error.status === 401) {
        cloudSession = false;
        stopRemoteRefresh();
      }
      if (!cloudSession && canUseLocalFallback() && dataUrl) {
        if (kind === "avatar") state.roles[state.sessionRole].avatar = dataUrl;
        if (kind === "background") state.backgrounds[state.sessionRole] = dataUrl;
        persist();
        if (kind === "avatar") renderApp(); else applyBackground();
        showToast(kind === "avatar" ? "头像已保存到本机" : "背景已保存到本机");
        return;
      }
      showToast("图片处理失败，请换一张较小的图片");
    } finally {
      input.value = "";
    }
  }

  function bindEvents() {
    $("#login-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const entered = $("#password").value;
      const match = Object.entries(PASSWORDS).find(([, password]) => password === entered);
      login(match?.[0]);
    });
    $("#logout-button").addEventListener("click", logout);
    $$('[data-view]').forEach((button) => button.addEventListener("click", () => navigate(button.dataset.view)));
    $("#theme-toggle").addEventListener("click", toggleTheme);
    $("#dialog-theme-toggle").addEventListener("click", toggleTheme);
    $("#growth-text").addEventListener("input", (event) => { draft.growthText = event.target.value; scheduleDraftSave(); });
    $("#life-text").addEventListener("input", (event) => { draft.lifeText = event.target.value; scheduleDraftSave(); });
    $$("#editor-mode-toggle button").forEach((button) => button.addEventListener("click", () => setEditorMode(button.dataset.mode)));
    $("#save-log").addEventListener("click", saveToday);
    $("#avatar-image").addEventListener("change", (event) => handleImageUpload(event.target, "avatar"));
    $("#background-image").addEventListener("change", (event) => handleImageUpload(event.target, "background"));
    $("#wish-form").addEventListener("submit", createWish);
    $("#settings-button").addEventListener("click", openSettings);
    $("#mobile-settings-button").addEventListener("click", openSettings);
    $("#save-display-name").addEventListener("click", saveDisplayName);
    $("#display-name").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveDisplayName();
      }
    });
    $("#dialog-logout-button").addEventListener("click", () => {
      $("#settings-dialog").close();
      logout();
    });
    $("#clear-background").addEventListener("click", () => {
      (async () => {
        if (cloudSession) {
          const response = await sendCommand("clear_background", {});
          if (response) { applyBackground(); showToast("背景图已移除"); }
          return;
        }
        state.backgrounds[state.sessionRole] = "";
        persist();
        applyBackground();
        showToast("背景图已移除");
      })();
    });
    $$("#timeline-filter button").forEach((button) => button.addEventListener("click", () => {
      timelineFilter = button.dataset.filter;
      $$("#timeline-filter button").forEach((item) => item.classList.toggle("is-active", item === button));
      renderTimeline();
    }));
  }

  async function init() {
    applyTheme();
    renderLoginPreview();
    if (!canUseLocalFallback()) $("#local-demo-note")?.remove();
    bindEvents();
    // A persisted role is only an offline-preview convenience.  On a hosted
    // build, the HttpOnly cookie must be checked before showing any data.
    if (canUseLocalFallback() && state.sessionRole && state.roles[state.sessionRole]) {
      $("#login-screen").classList.add("is-hidden");
      $("#app-shell").classList.remove("is-hidden");
      insightPerson = state.sessionRole;
      renderApp();
    } else if (!canUseLocalFallback()) {
      state.sessionRole = null;
      persist();
    }
    // If a hosted session cookie exists, replace the local snapshot with the shared state.
    try {
      const response = await apiRequest("/api/bootstrap", { method: "GET", headers: {} });
      cloudSession = true;
      mergeRemoteState(response.state, response.role || response.roleId || state.sessionRole);
      enterApp(state.sessionRole);
    } catch (error) {
      if (!canUseLocalFallback() && error.status && error.status !== 401) {
        $("#login-error").textContent = error.message || "共享空间暂时不可用，请稍后重试。";
      }
    }
    window.addEventListener("focus", () => { if (cloudSession) refreshRemote({ silent: true }); });
  }

  init();
})();
