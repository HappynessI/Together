import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import {
  MemoryStorage,
  baseState,
  createHarness,
  deferredFetch,
  emptyLog,
  indexSource,
  jsonResponse,
} from "./helpers/app-harness.mjs";

const STORE_KEY = "pair-journal-prototype-v5";
const THEME_STYLE_KEY = "pair-journal-theme-style-v1";
const UNAUTHORIZED = { ok: false, error: { code: "UNAUTHORIZED", message: "请先输入密码登录。" } };

function persistedState(storage) {
  return JSON.parse(storage.getItem(STORE_KEY));
}

function remoteStateWithLog(key, log) {
  const state = baseState();
  state.logs[key] = log;
  return state;
}

function serverLog(date, log) {
  return {
    log_date: date,
    growth_text: log.growthText,
    life_text: log.lifeText,
    growth_score: log.growthScore,
    life_score: log.lifeScore,
    images: log.images,
  };
}

test("an expired session keeps the editor content as a local draft and never commits it as a saved log", async () => {
  const { api, elements, storage } = createHarness(baseState(), {
    fetch: async () => jsonResponse(401, UNAUTHORIZED),
  });
  const date = api.currentAppDate();
  const key = `pair|me|${date}`;
  api.setCloudSession(true);
  api.setEditor(date, emptyLog({ growthText: "会话过期前写的内容", growthScore: 4 }), 1);

  const result = await api.saveToday({ showSuccess: false, showFailure: false });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "session-expired");
  assert.equal(api.getState().logs[key], undefined);
  assert.equal(persistedState(storage).drafts[key].growthText, "会话过期前写的内容");
  assert.equal(persistedState(storage).drafts[key].growthScore, 4);
  assert.equal(api.usesLocalData(), false, "an expired cloud session must not fall back to local-only writes");
  assert.equal(elements.get("#app-shell").classList.contains("is-hidden"), true);
  assert.match(elements.get("#login-error").textContent, /登录已过期/);
});

test("a 401 during background sync persists keystrokes that are still waiting for the debounce", async () => {
  const { api, elements, storage } = createHarness(baseState(), {
    fetch: async () => jsonResponse(401, UNAUTHORIZED),
  });
  const date = api.currentAppDate();
  api.setCloudSession(true);
  api.setEditor(date, emptyLog(), 0);
  elements.get("#growth-text").value = "还没等到防抖保存的输入";
  api.handleEditorInput("growthText", "还没等到防抖保存的输入");

  assert.equal(await api.refreshRemote({ silent: true }), false);
  assert.equal(persistedState(storage).drafts[`pair|me|${date}`].growthText, "还没等到防抖保存的输入");
});

test("text typed while a cloud save is in flight stays in the editor and is kept as a draft", async () => {
  const network = deferredFetch();
  const { api, elements } = createHarness(baseState(), { fetch: network.fetch });
  const date = api.currentAppDate();
  const key = `pair|me|${date}`;
  const submitted = emptyLog({ growthText: "点击保存时的内容", growthScore: 3 });
  api.setCloudSession(true);
  api.setEditor(date, submitted, 1);

  const saving = api.saveToday({ showSuccess: false, showFailure: false });
  assert.equal(network.calls.length, 1);
  assert.equal(network.calls[0].body.payload.growthText, "点击保存时的内容");

  const later = "点击保存时的内容\n保存请求进行中继续写的一行";
  elements.get("#growth-text").value = later;
  api.handleEditorInput("growthText", later);
  const writesBeforeResponse = elements.get("#growth-text").valueWrites;
  const savedLog = { ...submitted, updatedAt: "21:00" };
  network.calls[0].resolve(jsonResponse(200, {
    ok: true,
    result: { log: serverLog(date, savedLog) },
    state: remoteStateWithLog(key, savedLog),
  }));
  const result = await saving;

  assert.equal(result.ok, true);
  const state = api.getState();
  assert.equal(state.logs[key].growthText, "点击保存时的内容");
  assert.equal(state.drafts[key].growthText, later);
  assert.equal(api.getDraft().growthText, later);
  assert.equal(elements.get("#growth-text").value, later);
  assert.equal(elements.get("#growth-text").valueWrites, writesBeforeResponse, "the editor must not be rewritten");
});

test("a successful save does not rewrite textarea content that is already identical", async () => {
  const network = deferredFetch();
  const { api, elements } = createHarness(baseState(), { fetch: network.fetch });
  const date = api.currentAppDate();
  const key = `pair|me|${date}`;
  const log = emptyLog({ growthText: "已经整理好的内容", lifeText: "散步", growthScore: 2, lifeScore: 1 });
  api.setCloudSession(true);
  api.setEditor(date, log, 1);
  const growthWrites = elements.get("#growth-text").valueWrites;
  const lifeWrites = elements.get("#life-text").valueWrites;

  const saving = api.saveToday({ showSuccess: false, showFailure: false });
  network.calls[0].resolve(jsonResponse(200, {
    ok: true,
    result: { log: serverLog(date, log) },
    state: remoteStateWithLog(key, log),
  }));
  assert.equal((await saving).ok, true);

  assert.equal(elements.get("#growth-text").valueWrites, growthWrites);
  assert.equal(elements.get("#life-text").valueWrites, lifeWrites);
  assert.equal(api.getState().drafts[key], undefined);
});

test("double-submitting a wish sends one create_wish command and spends one star", async () => {
  const network = deferredFetch();
  const { api, elements } = createHarness(baseState(), { fetch: network.fetch });
  api.setCloudSession(true);
  elements.get("#wish-text").value = "周末一起去看展";
  const event = { preventDefault() {} };

  const first = api.createWish(event);
  const second = api.createWish(event);
  assert.equal(network.calls.length, 1);
  assert.equal(network.calls[0].body.type, "create_wish");

  network.calls[0].resolve(jsonResponse(200, { ok: true, result: {}, state: baseState() }));
  await Promise.all([first, second]);
  assert.equal(network.calls.length, 1);
  assert.equal(elements.get("#wish-form button[type='submit']").disabled, false);
  assert.equal(elements.get("#wish-text").value, "");
});

test("a local wish records the spent star so a later save does not refund it", async () => {
  const { api, elements } = createHarness();
  elements.get("#wish-text").value = "陪我散步一小时";
  await api.createWish({ preventDefault() {} });

  const afterWish = api.getState().wallets["pair|me"];
  assert.equal(afterWish.stars, 0);
  assert.equal(afterWish.spentStars, 1);

  const date = api.currentAppDate();
  api.setEditor(date, emptyLog({ growthText: "写一点", growthScore: 5 }), 1);
  assert.equal((await api.saveToday({ showSuccess: false, showFailure: false })).ok, true);
  const afterSave = api.getState().wallets["pair|me"];
  assert.equal(afterSave.lifetimePoints, 106);
  assert.equal(afterSave.spentStars, 1);
  assert.equal(afterSave.stars, 0);
});

test("first-time users and upgraded users keep the Solarized style", () => {
  const firstVisit = createHarness(null);
  firstVisit.api.applyTheme();
  assert.equal(firstVisit.api.getThemeStyle(), "solarized");
  assert.equal(firstVisit.document.documentElement.dataset.style, "solarized");
  assert.equal(firstVisit.document.documentElement.dataset.mode, "light");

  const legacyDark = { ...baseState(), theme: "dark" };
  const upgraded = createHarness(legacyDark);
  upgraded.api.applyTheme();
  assert.equal(upgraded.document.documentElement.dataset.style, "solarized");
  assert.equal(upgraded.document.documentElement.dataset.mode, "dark");

  const corrupted = createHarness(baseState(), { storage: { [THEME_STYLE_KEY]: "neon" } });
  assert.equal(corrupted.api.getThemeStyle(), "solarized");
});

test("theme style and color mode are stored and changed independently", () => {
  const { api, document, storage } = createHarness({ ...baseState(), theme: "dark" });

  api.setThemeStyle("paper");
  assert.equal(storage.getItem(THEME_STYLE_KEY), "paper");
  assert.equal(document.documentElement.dataset.style, "paper");
  assert.equal(document.documentElement.dataset.mode, "dark");
  assert.equal(persistedState(storage).theme, "dark");

  api.setColorMode("light");
  assert.equal(persistedState(storage).theme, "light");
  assert.equal(storage.getItem(THEME_STYLE_KEY), "paper");
  assert.equal(document.documentElement.dataset.style, "paper");
  assert.equal(document.documentElement.dataset.mode, "light");

  api.setThemeStyle("unknown");
  assert.equal(storage.getItem(THEME_STYLE_KEY), "paper");

  const reloaded = createHarness(persistedState(storage), { storage: { [THEME_STYLE_KEY]: "paper" } });
  reloaded.api.applyTheme();
  assert.equal(reloaded.document.documentElement.dataset.style, "paper");
  assert.equal(reloaded.document.documentElement.dataset.mode, "light");
});

test("changing the theme while editing keeps the unsaved editor content", () => {
  const { api, elements } = createHarness();
  const date = api.currentAppDate();
  api.setEditor(date, emptyLog(), 0);
  elements.get("#growth-text").value = "切换主题前的输入";
  api.handleEditorInput("growthText", "切换主题前的输入");
  const writes = elements.get("#growth-text").valueWrites;

  api.setThemeStyle("paper");
  api.setColorMode("dark");
  api.setThemeStyle("solarized");

  assert.equal(elements.get("#growth-text").valueWrites, writes);
  assert.equal(elements.get("#growth-text").value, "切换主题前的输入");
  assert.equal(api.getDraft().growthText, "切换主题前的输入");
});

function runPrePaintScript(stored) {
  const script = indexSource.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  const documentElement = { dataset: { style: "solarized", mode: "light" } };
  vm.runInNewContext(script, { document: { documentElement }, localStorage: new MemoryStorage(stored), JSON });
  return documentElement.dataset;
}

test("the pre-paint script restores the saved style and mode before app.js loads", () => {
  assert.deepEqual({ ...runPrePaintScript({}) }, { style: "solarized", mode: "light" });
  assert.deepEqual(
    { ...runPrePaintScript({ [THEME_STYLE_KEY]: "paper", [STORE_KEY]: JSON.stringify({ theme: "dark" }) }) },
    { style: "paper", mode: "dark" },
  );
  assert.deepEqual(
    { ...runPrePaintScript({ [THEME_STYLE_KEY]: "paper", [STORE_KEY]: "{broken" }) },
    { style: "paper", mode: "light" },
  );
  assert.deepEqual(
    { ...runPrePaintScript({ [THEME_STYLE_KEY]: "claude", [STORE_KEY]: JSON.stringify({ theme: "dark" }) }) },
    { style: "claude", mode: "dark" },
  );
  assert.deepEqual({ ...runPrePaintScript({ [THEME_STYLE_KEY]: "neon" }) }, { style: "solarized", mode: "light" });
});

test("every style offered in the settings dialog is registered in app.js and styled in CSS", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const offered = [...indexSource.matchAll(/data-theme-style="([a-z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(offered, ["solarized", "paper", "claude"]);

  const { api, document, storage } = createHarness();
  api.applyTheme();
  for (const style of offered) {
    api.setThemeStyle(style);
    assert.equal(api.getThemeStyle(), style);
    assert.equal(document.documentElement.dataset.style, style);
    if (style !== "solarized") {
      assert.match(css, new RegExp(`html\\[data-style="${style}"\\] \\{`));
      assert.match(css, new RegExp(`html\\[data-style="${style}"\\]\\[data-mode="dark"\\] \\{`));
      assert.match(indexSource, new RegExp(`style === "${style}"`), `pre-paint script must accept ${style}`);
    }
  }
  assert.equal(storage.getItem(THEME_STYLE_KEY), "claude");
});
