import {
  HttpError,
  ROOM_ID,
  dateInTimezone,
  getSupabase,
  methodNotAllowed,
  readJsonBody,
  requireSession,
  sendJson,
  throwIfSupabaseError,
  validateDate,
  withApiHandler,
} from "../lib/server.js";
import {
  checkinEmailConfig,
  quoteForDate,
  sendCheckinEmail,
} from "../lib/checkin-email.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canonicalLog(value, date) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(502, "INVALID_CHECKIN_STATE", "读取已保存记录失败。");
  }
  return {
    date,
    growthText: String(value.growthText || ""),
    lifeText: String(value.lifeText || ""),
    growthScore: Number(value.growthScore || 0),
    lifeScore: Number(value.lifeScore || 0),
  };
}

function retryAfterFrom(notification) {
  const expiresAt = new Date(notification?.lease_expires_at || 0).valueOf();
  if (!Number.isFinite(expiresAt)) return 15;
  return Math.max(1, Math.min(60, Math.ceil((expiresAt - Date.now()) / 1000)));
}

function reservationError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("checkin_log_not_found")) {
    return new HttpError(404, "CHECKIN_LOG_NOT_FOUND", "服务端暂未找到今天已保存的正式记录。");
  }
  if (message.includes("empty_checkin")) {
    return new HttpError(400, "EMPTY_CHECKIN", "请先写一点今天的记录，或至少选择一项评分。");
  }
  return null;
}

async function updateNotification(supabase, id, values, expectedStatuses) {
  let query = supabase
    .from("checkin_notifications")
    .update(values)
    .eq("id", id);
  if (expectedStatuses?.length) query = query.in("status", expectedStatuses);
  const { data, error } = await query.select("id, status").maybeSingle();
  throwIfSupabaseError(error, "更新邮件通知状态失败。");
  if (!data) {
    throw new HttpError(409, "CHECKIN_IN_PROGRESS", "这次打卡正在由另一个请求处理。", { retryAfter: 15 });
  }
  return data;
}

function handleExistingReservation(reservation, date) {
  const action = String(reservation?.action || "");
  const notification = reservation?.notification || {};
  if (action === "sent") {
    return {
      ok: true,
      alreadySent: true,
      quote: quoteForDate(date),
      sentAt: notification.sent_at || null,
    };
  }
  if (action === "unknown") {
    throw new HttpError(
      409,
      "CHECKIN_DELIVERY_UNKNOWN",
      "上一次邮件发送结果暂时无法确认，请不要立即重复打卡。",
    );
  }
  if (action === "failed") {
    throw new HttpError(409, "EMAIL_SEND_FAILED", "上一次通知发送失败，可以重新点击打卡重试。");
  }
  if (action === "in_progress") {
    const retryAfter = retryAfterFrom(notification);
    throw new HttpError(
      409,
      "CHECKIN_IN_PROGRESS",
      `这次打卡仍在处理中，请 ${retryAfter} 秒后再确认。`,
      { retryAfter },
    );
  }
  if (action === "rate_limited") {
    const retryAfter = Math.max(1, Number(reservation.retry_after || 60));
    throw new HttpError(
      429,
      "CHECKIN_RATE_LIMITED",
      `刚刚已经请求过通知，请 ${retryAfter} 秒后再试。`,
      { retryAfter },
    );
  }
  return null;
}

export default withApiHandler(async (req, res) => {
  if (req.method !== "POST") methodNotAllowed(res, ["POST"]);
  const { roleId } = requireSession(req);
  const body = await readJsonBody(req, 16 * 1024);
  const today = dateInTimezone();
  const date = validateDate(body.date, today);
  if (date !== today) {
    throw new HttpError(409, "CHECKIN_DATE_MISMATCH", "当前日期已经变化，请刷新页面后再打卡。");
  }
  const idempotencyKey = String(body.idempotencyKey || "").trim();
  if (!UUID_V4.test(idempotencyKey)) {
    throw new HttpError(400, "INVALID_IDEMPOTENCY_KEY", "打卡请求编号无效。");
  }

  // Validate all mail settings before reserving an outbox row. In particular,
  // a missing partner address must not leave an ambiguous delivery behind.
  const emailConfig = checkinEmailConfig(roleId);
  const supabase = getSupabase();
  const { data: reservation, error: reservationFailure } = await supabase.rpc(
    "reserve_checkin_notification",
    {
      p_room_id: ROOM_ID,
      p_role_id: roleId,
      p_log_date: date,
      p_idempotency_key: idempotencyKey,
    },
  );
  if (reservationFailure) {
    const knownError = reservationError(reservationFailure);
    if (knownError) throw knownError;
    throwIfSupabaseError(reservationFailure, "准备邮件通知失败。");
  }

  const existing = handleExistingReservation(reservation, date);
  if (existing) {
    sendJson(res, 200, existing);
    return;
  }
  if (reservation?.action !== "send") {
    throw new HttpError(502, "INVALID_CHECKIN_STATE", "邮件通知状态无效。");
  }

  const notification = reservation.notification || {};
  const notificationId = String(notification.id || "");
  const messageId = String(notification.message_id || "");
  const log = canonicalLog(reservation.log, date);
  await updateNotification(
    supabase,
    notificationId,
    { status: "sending", lease_expires_at: new Date(Date.now() + 45_000).toISOString() },
    ["reserved"],
  );

  let result;
  try {
    result = await sendCheckinEmail({
      config: emailConfig,
      roleName: reservation.role_name || (roleId === "me" ? "我" : "搭档"),
      date,
      log,
      messageId,
    });
  } catch (error) {
    const definiteFailure = error instanceof HttpError && error.code === "EMAIL_SEND_FAILED";
    try {
      await updateNotification(
        supabase,
        notificationId,
        {
          status: definiteFailure ? "failed" : "unknown",
          failure_code: definiteFailure ? "smtp_rejected" : "delivery_result_unconfirmed",
          lease_expires_at: null,
        },
        ["sending"],
      );
    } catch (stateError) {
      console.error("Could not persist check-in delivery failure", {
        code: stateError?.code,
        status: stateError?.status,
      });
      throw new HttpError(
        502,
        "CHECKIN_DELIVERY_UNKNOWN",
        "邮件发送结果暂时无法确认，请不要立即重复打卡。",
      );
    }
    throw error;
  }

  try {
    await updateNotification(
      supabase,
      notificationId,
      {
        status: "sent",
        sent_at: result.sentAt,
        lease_expires_at: null,
        failure_code: null,
      },
      ["sending"],
    );
  } catch (error) {
    console.error("Email accepted but sent state was not persisted", {
      code: error?.code,
      status: error?.status,
    });
    throw new HttpError(
      502,
      "CHECKIN_DELIVERY_UNKNOWN",
      "邮件可能已经送达，但状态暂时无法确认，请不要立即重复打卡。",
    );
  }

  sendJson(res, 200, {
    ok: true,
    alreadySent: false,
    quote: result.quote,
    sentAt: result.sentAt,
  });
});
