import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const hookSource = `
  window.__PAIR_JOURNAL_TEST_API__ = {
    currentAppDate,
    ensureEditorDate,
    flushEditorDraft,
    handlePageHide,
    ingestAppDateHint,
    ingestAppTimeMetadata,
    initializeDraftRecovery,
    mergeRecoverableDraft,
    saveToday,
    scheduleDraftSave,
    validISODate,
    getDraft: () => clone(draft),
    getDraftRecovery: () => clone(draftRecovery),
    getEditorDate: () => editorDate,
    getState: () => clone(state),
    setCloudSession: (value) => { cloudSession = Boolean(value); },
    setEditor: (date, value, revision = 0) => {
      editorDate = date;
      draft = clone(value || emptyLog());
      draft.images = Array.isArray(draft.images) ? draft.images : [];
      draftRevision = revision;
      document.querySelector("#growth-text").value = draft.growthText || "";
      document.querySelector("#life-text").value = draft.lifeText || "";
    },
    setState: (value) => { state = clone(value); },
  };
`;

function instrument(source) {
  const ending = /\n  init\(\);\n\}\)\(\);\s*$/;
  assert.match(source, ending, "app.js bootstrap shape changed; update the test harness");
  return source.replace(ending, `\n${hookSource}})();\n`);
}

class MemoryStorage {
  constructor(initial = {}) {
    this.data = new Map(Object.entries(initial));
    this.failWrites = false;
  }

  getItem(key) {
    return this.data.has(key) ? this.data.get(key) : null;
  }

  setItem(key, value) {
    if (this.failWrites) throw new Error("storage full");
    this.data.set(key, String(value));
  }

  removeItem(key) {
    if (this.failWrites) throw new Error("storage full");
    this.data.delete(key);
  }
}

function classList() {
  return { add() {}, remove() {}, toggle() {} };
}

function baseState() {
  return {
    version: 5,
    theme: "light",
    sessionRole: "me",
    roles: {
      me: { id: "me", name: "我", initials: "我", avatar: "" },
      partner: { id: "partner", name: "搭档", initials: "友", avatar: "" },
    },
    rooms: { pair: { id: "pair", name: "我们的日常", members: ["me", "partner"] } },
    logs: {},
    drafts: {},
    wallets: {
      "pair|me": { lifetimePoints: 101, points: 1, earnedStars: 1, spentStars: 0, stars: 1 },
      "pair|partner": { lifetimePoints: 0, points: 0, earnedStars: 0, spentStars: 0, stars: 0 },
    },
    wishes: [],
    reactions: {},
    backgrounds: { me: "", partner: "" },
  };
}

function emptyLog(overrides = {}) {
  return {
    growthText: "",
    lifeText: "",
    growthScore: 0,
    lifeScore: 0,
    images: [],
    updatedAt: null,
    ...overrides,
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createHarness(initialState = baseState()) {
  const storage = new MemoryStorage({
    "pair-journal-prototype-v5": JSON.stringify(initialState),
  });
  const elements = new Map([
    ["#growth-text", { value: "", classList: classList(), dataset: {} }],
    ["#life-text", { value: "", classList: classList(), dataset: {} }],
    ["#toast", { textContent: "", classList: classList(), dataset: {} }],
    ["#checkin-status", { textContent: "", classList: classList(), dataset: {} }],
  ]);
  const document = {
    documentElement: { dataset: {} },
    visibilityState: "visible",
    querySelector: (selector) => elements.get(selector) || null,
    querySelectorAll: () => [],
  };
  const window = {
    __PAIR_JOURNAL_TEST_MODE__: true,
    addEventListener() {},
    clearInterval,
    confirm: () => false,
    document,
    history: { replaceState() {} },
    location: {
      href: "http://127.0.0.1/",
      hostname: "127.0.0.1",
      pathname: "/",
      protocol: "http:",
      search: "",
    },
    scrollTo() {},
    setInterval,
  };
  const quietConsole = Object.create(console);
  quietConsole.warn = () => {};
  const sandbox = {
    Array,
    Date,
    Error,
    FileReader: class {},
    Image: class {},
    Intl,
    JSON,
    Map,
    Math,
    Number,
    Object,
    RegExp,
    Set,
    String,
    URL,
    URLSearchParams,
    clearTimeout,
    console: quietConsole,
    crypto: webcrypto,
    document,
    fetch: async () => { throw new Error("unexpected network request"); },
    localStorage: storage,
    performance,
    setTimeout,
    window,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(instrument(appSource), sandbox, { filename: "app.js" });
  return { api: window.__PAIR_JOURNAL_TEST_API__, elements, storage };
}

test("a rollover stores the old editor under its original date and opens a clean new day", () => {
  const { api, storage } = createHarness();
  const oldDate = "2026-08-13";
  const newDate = "2026-08-14";
  api.setEditor(oldDate, emptyLog({ growthText: "零点前的内容", growthScore: 4 }), 1);

  const rolled = api.ensureEditorDate({ targetDate: newDate, render: false, announce: false, force: true });

  assert.equal(rolled, true);
  assert.equal(api.getEditorDate(), newDate);
  assert.equal(api.getDraft().growthText, "");
  assert.equal(api.getState().drafts[`pair|me|${oldDate}`].growthText, "零点前的内容");
  const persisted = JSON.parse(storage.getItem("pair-journal-prototype-v5"));
  assert.equal(persisted.drafts[`pair|me|${oldDate}`].growthScore, 4);
  assert.equal(persisted.drafts[`pair|me|${newDate}`], undefined);
});

test("a storage failure blocks rollover instead of losing the old editor", () => {
  const { api, storage } = createHarness();
  const oldDate = "2026-08-13";
  api.setEditor(oldDate, emptyLog({ lifeText: "必须保留" }), 1);
  storage.failWrites = true;

  const rolled = api.ensureEditorDate({
    targetDate: "2026-08-14",
    render: false,
    announce: false,
    force: true,
  });

  assert.equal(rolled, false);
  assert.equal(api.getEditorDate(), oldDate);
  assert.equal(api.getDraft().lifeText, "必须保留");
});

test("the 350ms draft debounce captures the editor date before midnight", async () => {
  const { api } = createHarness();
  const oldDate = "2026-08-13";
  const newDate = "2026-08-14";
  api.setEditor(oldDate, emptyLog({ growthText: "23:59:59 输入" }), 7);
  api.scheduleDraftSave();
  api.ingestAppDateHint(newDate);

  await new Promise((resolve) => setTimeout(resolve, 420));

  const state = api.getState();
  assert.equal(state.drafts[`pair|me|${oldDate}`].growthText, "23:59:59 输入");
  assert.equal(state.drafts[`pair|me|${newDate}`], undefined);
});

test("an authoritative date hint can correct a bad future prediction", () => {
  const { api } = createHarness();
  api.ingestAppTimeMetadata({
    appDate: "2030-01-02",
    appTimezone: "Asia/Shanghai",
    serverTime: "2030-01-02T04:00:00.000Z",
  });
  assert.equal(api.currentAppDate(), "2030-01-02");

  api.ingestAppDateHint("2030-01-01");
  assert.equal(api.currentAppDate(), "2030-01-01");

  api.ingestAppTimeMetadata({
    appDate: "2030-01-03",
    appTimezone: "Asia/Shanghai",
    serverTime: "2030-01-03T04:00:00.000Z",
  });
  assert.equal(api.currentAppDate(), "2030-01-03");

  api.ingestAppTimeMetadata({
    appDate: "2030-01-02",
    appTimezone: "Asia/Shanghai",
    serverTime: "2030-01-02T04:00:00.000Z",
  });
  assert.equal(api.currentAppDate(), "2030-01-03");
});

test("legacy drafts are archived before the active draft namespace is cleared", () => {
  const state = baseState();
  const key = "pair|me|2026-08-13";
  state.drafts[key] = emptyLog({ growthText: "旧版本草稿" });
  const { api, storage } = createHarness(state);

  assert.equal(api.initializeDraftRecovery(), true);
  assert.equal(api.getState().drafts[key], undefined);
  const recovery = api.getDraftRecovery();
  const item = Object.values(recovery.items).find((candidate) => candidate.key === key);
  assert.equal(item.log.growthText, "旧版本草稿");
  assert.equal(JSON.parse(storage.getItem("pair-journal-prototype-v5")).drafts[key], undefined);
});

test("copying a previous draft preserves a conflicting score and reports the conflict", () => {
  const { api } = createHarness();
  const target = emptyLog({ growthText: "今天", growthScore: 5, images: ["a"] });
  const source = emptyLog({ growthText: "昨天", growthScore: 3, lifeScore: 2, images: ["a", "b"] });

  const result = plain(api.mergeRecoverableDraft(target, source));

  assert.equal(result.mergedDraft.growthText, "今天\n\n昨天");
  assert.equal(result.mergedDraft.growthScore, 5);
  assert.equal(result.mergedDraft.lifeScore, 2);
  assert.deepEqual(result.mergedDraft.images, ["a", "b"]);
  assert.deepEqual(result.scoreConflicts, ["growthScore"]);
});

test("recoverable image merge keeps today's images within the six-image server limit", () => {
  const { api } = createHarness();
  const target = emptyLog({
    images: ["/today-1.jpg", "/shared.jpg?token=today", "/today-2.jpg", "/today-3.jpg"],
  });
  const source = emptyLog({
    images: ["/shared.jpg?token=yesterday", "/old-1.jpg", "/old-2.jpg", "/old-3.jpg"],
  });

  const result = plain(api.mergeRecoverableDraft(target, source));

  assert.deepEqual(result.mergedDraft.images, [
    "/today-1.jpg",
    "/shared.jpg?token=today",
    "/today-2.jpg",
    "/today-3.jpg",
    "/old-1.jpg",
    "/old-2.jpg",
  ]);
  assert.deepEqual(result.skippedImages, ["/old-3.jpg"]);
});

test("offline save rolls back the log and wallet when localStorage cannot commit", async () => {
  const { api, storage } = createHarness();
  const date = api.currentAppDate();
  const state = baseState();
  const key = `pair|me|${date}`;
  state.logs[key] = emptyLog({ growthText: "原记录", growthScore: 1 });
  const walletBefore = plain(state.wallets["pair|me"]);
  api.setState(state);
  api.setEditor(date, emptyLog({ growthText: "新记录", growthScore: 5 }), 2);
  storage.failWrites = true;

  const result = await api.saveToday({ showSuccess: false, showFailure: false });
  const after = api.getState();

  assert.equal(result.ok, false);
  assert.equal(result.reason, "local-storage-failed");
  assert.equal(after.logs[key].growthText, "原记录");
  assert.deepEqual(plain(after.wallets["pair|me"]), walletBefore);
  assert.equal(api.getDraft().growthText, "新记录");
});

test("flushing before logout persists the final input without waiting for debounce", () => {
  const { api, elements, storage } = createHarness();
  const date = "2026-08-13";
  api.setEditor(date, emptyLog({ growthText: "旧值" }), 3);
  elements.get("#growth-text").value = "退出前最后输入";

  assert.equal(api.flushEditorDraft(), true);
  const persisted = JSON.parse(storage.getItem("pair-journal-prototype-v5"));
  assert.equal(persisted.drafts[`pair|me|${date}`].growthText, "退出前最后输入");
});

test("pagehide synchronously persists the final input before refresh or tab close", () => {
  const { api, elements, storage } = createHarness();
  const date = "2026-08-13";
  api.setEditor(date, emptyLog({ lifeText: "旧值" }), 4);
  elements.get("#life-text").value = "刷新前最后输入";

  assert.match(appSource, /window\.addEventListener\("pagehide", handlePageHide\)/);
  assert.equal(api.handlePageHide(), true);
  const persisted = JSON.parse(storage.getItem("pair-journal-prototype-v5"));
  assert.equal(persisted.drafts[`pair|me|${date}`].lifeText, "刷新前最后输入");
});

test("date validation rejects impossible calendar dates", () => {
  const { api } = createHarness();
  assert.equal(api.validISODate("2026-02-28"), true);
  assert.equal(api.validISODate("2026-02-30"), false);
  assert.equal(api.validISODate("2026-2-3"), false);
});
