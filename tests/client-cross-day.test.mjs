import assert from "node:assert/strict";
import test from "node:test";

import { appSource, baseState, createHarness, emptyLog, plain } from "./helpers/app-harness.mjs";

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
