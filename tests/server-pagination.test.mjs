import assert from "node:assert/strict";
import test from "node:test";

import { readAllPages } from "../lib/server.js";

// 模拟 PostgREST：每次请求最多返回 maxRows 行，并记录请求过的区间。
function fakeTable(totalRows, maxRows = 1000) {
  const rows = Array.from({ length: totalRows }, (_, index) => ({ id: index }));
  const ranges = [];
  return {
    ranges,
    build() {
      return {
        range(from, to) {
          ranges.push([from, to]);
          const end = Math.min(to + 1, from + maxRows, rows.length);
          return Promise.resolve({ data: rows.slice(from, end), error: null, status: 200 });
        },
      };
    },
  };
}

test("readAllPages returns rows beyond the first 1000 so the newest logs are not dropped", async () => {
  const table = fakeTable(2345);
  const result = await readAllPages("daily_logs", () => table.build());

  assert.equal(result.error, null);
  assert.equal(result.data.length, 2345);
  assert.equal(result.data.at(-1).id, 2344);
  assert.deepEqual(table.ranges, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test("readAllPages stops after one request when the table fits in a page", async () => {
  const table = fakeTable(12);
  const result = await readAllPages("wishes", () => table.build());

  assert.equal(result.data.length, 12);
  assert.deepEqual(table.ranges, [[0, 999]]);
});

test("readAllPages issues a final request when the row count is an exact multiple of the page size", async () => {
  const table = fakeTable(2000);
  const result = await readAllPages("daily_logs", () => table.build());

  assert.equal(result.data.length, 2000);
  assert.deepEqual(table.ranges, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test("readAllPages returns the database error instead of partial data", async () => {
  let calls = 0;
  const failure = { code: "XX000", message: "boom" };
  const result = await readAllPages("daily_logs", () => ({
    range() {
      calls += 1;
      return Promise.resolve(calls === 1
        ? { data: Array.from({ length: 1000 }, (_, id) => ({ id })), error: null, status: 200 }
        : { data: null, error: failure, status: 400 });
    },
  }));

  assert.equal(result.error, failure);
  assert.equal(result.data, null);
});
