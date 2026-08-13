import assert from "node:assert/strict";
import test from "node:test";

import {
  HttpError,
  appTimeMetadata,
  assertCurrentAppDate,
  dateInTimezone,
} from "../lib/server.js";

const previousTimezone = process.env.APP_TIMEZONE;

test.after(() => {
  if (previousTimezone === undefined) delete process.env.APP_TIMEZONE;
  else process.env.APP_TIMEZONE = previousTimezone;
});

test("appTimeMetadata returns one internally consistent authoritative clock sample", () => {
  process.env.APP_TIMEZONE = "Asia/Shanghai";
  const metadata = appTimeMetadata();

  assert.equal(metadata.appTimezone, "Asia/Shanghai");
  assert.equal(metadata.appDate, dateInTimezone(new Date(metadata.serverTime)));
  assert.match(metadata.serverTime, /^\d{4}-\d{2}-\d{2}T/);
});

test("assertCurrentAppDate accepts today and rejects a stale date with a correction hint", () => {
  process.env.APP_TIMEZONE = "Asia/Shanghai";
  const today = dateInTimezone();
  const previous = new Date(`${today}T12:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  const yesterday = previous.toISOString().slice(0, 10);

  assert.equal(assertCurrentAppDate(today), today);
  assert.throws(
    () => assertCurrentAppDate(yesterday, {
      code: "LOG_DATE_MISMATCH",
      message: "日期已变化",
    }),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "LOG_DATE_MISMATCH");
      assert.deepEqual(error.details, { appDate: today, submittedDate: yesterday });
      return true;
    },
  );
});
