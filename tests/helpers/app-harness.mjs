import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

export const appSource = await readFile(new URL("../../app.js", import.meta.url), "utf8");
export const indexSource = await readFile(new URL("../../index.html", import.meta.url), "utf8");

// 在 app.js 的闭包末尾挂一个测试入口，替换掉 init()，因此不会绑定真实事件。
const hookSource = `
  window.__PAIR_JOURNAL_TEST_API__ = {
    applyTheme,
    createWish,
    currentAppDate,
    ensureEditorDate,
    flushEditorDraft,
    handleEditorInput,
    handlePageHide,
    ingestAppDateHint,
    ingestAppTimeMetadata,
    initializeDraftRecovery,
    mergeRecoverableDraft,
    refreshRemote,
    saveToday,
    scheduleDraftSave,
    setColorMode,
    setThemeStyle,
    usesLocalData,
    validISODate,
    getDraft: () => clone(draft),
    getDraftRecovery: () => clone(draftRecovery),
    getEditorDate: () => editorDate,
    getState: () => clone(state),
    getThemeStyle: () => themeStyle,
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

export class MemoryStorage {
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

// 最小化的 DOM 元素替身：记录 class、属性和 textarea 的写入次数，其余操作为空实现。
export function stubElement(tag = "div") {
  const classes = new Set();
  const listeners = {};
  let value = "";
  const element = {
    tagName: tag.toUpperCase(),
    textContent: "",
    innerHTML: "",
    disabled: false,
    dataset: {},
    style: {},
    attributes: {},
    valueWrites: 0,
    firstChild: { textContent: "" },
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle: (name, force) => {
        const enabled = force === undefined ? !classes.has(name) : Boolean(force);
        if (enabled) classes.add(name);
        else classes.delete(name);
        return enabled;
      },
      contains: (name) => classes.has(name),
    },
    get value() { return value; },
    set value(next) {
      value = String(next);
      element.valueWrites += 1;
    },
    setAttribute(name, next) { element.attributes[name] = String(next); },
    getAttribute(name) { return element.attributes[name] ?? null; },
    addEventListener(type, handler) { (listeners[type] ||= []).push(handler); },
    dispatch(type, event = {}) { (listeners[type] || []).forEach((handler) => handler(event)); },
    querySelector: () => stubElement(),
    querySelectorAll: () => [],
    appendChild() {},
    append() {},
    replaceChildren() {},
    remove() {},
    focus() {},
    select() {},
    close() {},
    showModal() {},
  };
  return element;
}

class LazyElements extends Map {
  get(selector) {
    if (!this.has(selector)) this.set(selector, stubElement());
    return super.get(selector);
  }
}

export function baseState() {
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

export function emptyLog(overrides = {}) {
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

export function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

export function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  };
}

// 可以手动控制返回时机的 fetch，用来模拟请求进行期间用户继续输入或重复点击。
export function deferredFetch() {
  const calls = [];
  const fetch = (path, options = {}) => new Promise((resolve) => {
    calls.push({ path, body: options.body ? JSON.parse(options.body) : null, resolve });
  });
  return { calls, fetch };
}

export function createHarness(initialState = baseState(), { fetch, storage: extraStorage = {}, hostname = "127.0.0.1" } = {}) {
  const storage = new MemoryStorage({
    ...(initialState ? { "pair-journal-prototype-v5": JSON.stringify(initialState) } : {}),
    ...extraStorage,
  });
  // 同一个选择器始终返回同一个替身，测试和 app.js 看到的是同一个元素。
  const elements = new LazyElements([
    ["#growth-text", stubElement("textarea")],
    ["#life-text", stubElement("textarea")],
  ]);
  const document = {
    documentElement: { dataset: {} },
    visibilityState: "visible",
    querySelector: (selector) => elements.get(selector),
    querySelectorAll: () => [],
    createElement: (tag) => stubElement(tag),
  };
  const window = {
    __PAIR_JOURNAL_TEST_MODE__: true,
    addEventListener() {},
    clearInterval,
    confirm: () => false,
    document,
    history: { replaceState() {} },
    location: {
      href: `http://${hostname}/`,
      hostname,
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
    Promise,
    RegExp,
    Set,
    String,
    URL,
    URLSearchParams,
    clearTimeout,
    console: quietConsole,
    crypto: webcrypto,
    document,
    fetch: fetch || (async () => { throw new Error("unexpected network request"); }),
    localStorage: storage,
    performance,
    setTimeout,
    window,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(instrument(appSource), sandbox, { filename: "app.js" });
  return { api: window.__PAIR_JOURNAL_TEST_API__, document, elements, storage };
}
