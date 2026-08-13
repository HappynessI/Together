import {
  HttpError,
  ROOM_ID,
  appTimeMetadata,
  assertCurrentAppDate,
  assertRole,
  getSupabase,
  loadState,
  methodNotAllowed,
  partnerRole,
  readJsonBody,
  requireSession,
  sanitizeDisplayName,
  sanitizeLog,
  sanitizeWishText,
  sendJson,
  throwIfSupabaseError,
  withApiHandler,
} from "../lib/server.js";

function normalizeType(value) {
  return String(value || "").trim().toLowerCase().replaceAll("-", "_");
}

function payloadFrom(body) {
  if (body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)) return body.payload;
  return body;
}

async function saveLog(supabase, roleId, payload) {
  const submittedLog = payload.log && typeof payload.log === "object"
    ? { ...payload.log, date: payload.date || payload.log.date }
    : payload;
  const date = assertCurrentAppDate(submittedLog.date, {
    code: "LOG_DATE_MISMATCH",
    message: "当前日期已经变化，请刷新页面后再保存今日记录。",
  });
  const log = sanitizeLog({ ...submittedLog, date });
  const { data, error } = await supabase.rpc("save_daily_log", {
    p_room_id: ROOM_ID,
    p_role_id: roleId,
    p_log_date: log.date,
    p_growth_text: log.growthText,
    p_life_text: log.lifeText,
    p_growth_score: log.growthScore,
    p_life_score: log.lifeScore,
    p_images: log.images,
  });
  throwIfSupabaseError(error, "保存今日记录失败。");
  return data;
}

async function toggleReaction(supabase, roleId, payload) {
  const targetRoleId = assertRole(payload.targetRoleId || payload.target || partnerRole(roleId));
  if (targetRoleId === roleId) throw new HttpError(400, "INVALID_TARGET", "不能回应自己的记录。");
  const date = assertCurrentAppDate(payload.date, {
    code: "REACTION_DATE_MISMATCH",
    message: "当前日期已经变化，请刷新页面后再回应。",
  });
  const { data, error } = await supabase.rpc("toggle_reaction", {
    p_room_id: ROOM_ID,
    p_target_role_id: targetRoleId,
    p_log_date: date,
    p_reactor_role_id: roleId,
  });
  throwIfSupabaseError(error, "保存回应失败。");
  return data;
}

async function createWish(supabase, roleId, payload) {
  const text = sanitizeWishText(payload.text);
  const { data, error } = await supabase.rpc("create_wish", {
    p_room_id: ROOM_ID,
    p_from_role_id: roleId,
    p_to_role_id: partnerRole(roleId),
    p_text: text,
  });
  throwIfSupabaseError(error, "发出愿望失败。");
  return data;
}

async function updateWish(supabase, roleId, payload) {
  const wishId = String(payload.wishId || payload.id || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(wishId)) {
    throw new HttpError(400, "INVALID_WISH", "愿望编号无效。");
  }
  const nextStatus = payload.status || payload.nextStatus || null;
  if (nextStatus !== null && !["accepted", "done"].includes(nextStatus)) {
    throw new HttpError(400, "INVALID_STATUS", "愿望状态无效。");
  }
  const { data, error } = await supabase.rpc("update_wish_status", {
    p_wish_id: wishId,
    p_actor_role_id: roleId,
    p_next_status: nextStatus,
  });
  throwIfSupabaseError(error, "更新愿望失败。");
  return data;
}

async function clearBackground(supabase, roleId) {
  const { error } = await supabase.from("profiles").update({ background_url: null }).eq("id", roleId);
  throwIfSupabaseError(error, "移除背景图失败。");
  return { roleId, background: "" };
}

async function updateTheme(supabase, roleId, payload) {
  const theme = payload.theme === "dark" ? "dark" : payload.theme === "light" ? "light" : null;
  if (!theme) throw new HttpError(400, "INVALID_THEME", "主题参数无效。");
  const { error } = await supabase.from("profiles").update({ theme }).eq("id", roleId);
  throwIfSupabaseError(error, "保存主题失败。");
  return { roleId, theme };
}

async function updateDisplayName(supabase, roleId, payload) {
  const displayName = sanitizeDisplayName(payload.displayName ?? payload.name);
  const { data, error } = await supabase.rpc("update_profile_display_name", {
    p_role_id: roleId,
    p_display_name: displayName,
  });
  throwIfSupabaseError(error, "保存昵称失败。");
  return data;
}

export default withApiHandler(async (req, res) => {
  if (req.method !== "POST") methodNotAllowed(res, ["POST"]);
  const { roleId } = requireSession(req);
  const body = await readJsonBody(req);
  const type = normalizeType(body.type || body.command || body.action);
  const payload = payloadFrom(body);
  const supabase = getSupabase();

  let result;
  if (["save_log", "save_daily_log", "savelog"].includes(type)) {
    result = await saveLog(supabase, roleId, payload);
  } else if (["toggle_reaction", "reaction", "togglereaction"].includes(type)) {
    result = await toggleReaction(supabase, roleId, payload);
  } else if (["create_wish", "wish", "createwish"].includes(type)) {
    result = await createWish(supabase, roleId, payload);
  } else if (["update_wish", "advance_wish", "updatewish"].includes(type)) {
    result = await updateWish(supabase, roleId, payload);
  } else if (["clear_background", "remove_background"].includes(type)) {
    result = await clearBackground(supabase, roleId);
  } else if (["update_theme", "theme", "updatetheme"].includes(type)) {
    result = await updateTheme(supabase, roleId, payload);
  } else if (["update_display_name", "update_name", "display_name", "updatename"].includes(type)) {
    result = await updateDisplayName(supabase, roleId, payload);
  } else {
    throw new HttpError(400, "UNKNOWN_COMMAND", "未知操作。");
  }

  const state = await loadState(roleId);
  sendJson(res, 200, { ok: true, result, state, ...appTimeMetadata() });
});
