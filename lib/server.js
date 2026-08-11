import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";

export const ROOM_ID = "pair";
export const ROLE_IDS = Object.freeze(["me", "partner"]);
export const MEDIA_BUCKET = "pair-media";

const SESSION_COOKIE = "pair_star_session";
const SESSION_VERSION = 1;
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const DEFAULT_TIMEZONE = "Asia/Shanghai";
const MAX_JSON_BYTES = 10 * 1024 * 1024;

let supabaseClient;
const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 8;
const READ_RETRY_MIN_DELAY_MS = 150;
const READ_RETRY_JITTER_MS = 150;
const NON_RETRYABLE_DATABASE_CODES = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new HttpError(
      503,
      "SERVER_NOT_CONFIGURED",
      `服务端尚未配置 ${name}。`,
    );
  }
  return value;
}

export function getSupabase() {
  if (!supabaseClient) {
    const url = requiredEnvironment("SUPABASE_URL");
    const key = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
    supabaseClient = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { "X-Client-Info": "pair-star-server/1.0" } },
    });
  }
  return supabaseClient;
}

export function sendJson(res, status, value) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.end(JSON.stringify(value));
}

export function methodNotAllowed(res, methods) {
  res.setHeader("Allow", methods.join(", "));
  throw new HttpError(405, "METHOD_NOT_ALLOWED", "不支持这个请求方式。");
}

export function withApiHandler(handler) {
  return async function apiHandler(req, res) {
    try {
      await handler(req, res);
    } catch (error) {
      if (res.writableEnded) return;
      if (error instanceof HttpError) {
        sendJson(res, error.status, {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            ...(error.details === undefined ? {} : { details: error.details }),
          },
        });
        return;
      }

      console.error("Unhandled API error", {
        name: error?.name,
        message: error?.message,
        code: error?.code,
      });
      sendJson(res, 500, {
        ok: false,
        error: { code: "INTERNAL_ERROR", message: "服务暂时出了点问题，请稍后再试。" },
      });
    }
  };
}

async function streamToBuffer(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) {
      throw new HttpError(413, "PAYLOAD_TOO_LARGE", "上传内容过大。");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function readRawBody(req, limit = MAX_JSON_BYTES) {
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > limit) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "上传内容过大。");
    return req.body;
  }
  if (req.body instanceof Uint8Array) {
    const value = Buffer.from(req.body);
    if (value.length > limit) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "上传内容过大。");
    return value;
  }
  if (typeof req.body === "string") {
    const value = Buffer.from(req.body);
    if (value.length > limit) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "上传内容过大。");
    return value;
  }
  return streamToBuffer(req, limit);
}

export async function readJsonBody(req, limit = MAX_JSON_BYTES) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) && !(req.body instanceof Uint8Array)) {
    return req.body;
  }

  const raw = await readRawBody(req, limit);
  if (!raw.length) return {};
  try {
    const parsed = JSON.parse(raw.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed;
  } catch {
    throw new HttpError(400, "INVALID_JSON", "请求内容不是有效的 JSON。");
  }
}

function parseCookies(header = "") {
  return header.split(";").reduce((cookies, part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return cookies;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies[key] = value;
    return cookies;
  }, {});
}

function sessionSecret() {
  const secret = requiredEnvironment("SESSION_SECRET");
  if (Buffer.byteLength(secret) < 32) {
    throw new HttpError(503, "SERVER_NOT_CONFIGURED", "SESSION_SECRET 至少需要 32 个字节。");
  }
  return secret;
}

function signSession(encodedPayload) {
  return crypto.createHmac("sha256", sessionSecret()).update(encodedPayload).digest("base64url");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createSessionToken(roleId) {
  assertRole(roleId);
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    v: SESSION_VERSION,
    role: roleId,
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS,
  })).toString("base64url");
  return `${payload}.${signSession(payload)}`;
}

function requestIsSecure(req) {
  const forwarded = String(req.headers?.["x-forwarded-proto"] || "").split(",")[0].trim();
  if (forwarded === "https") return true;
  // Vercel sets VERCEL=1 during `vercel dev` as well. Do not mark the cookie
  // Secure for an explicitly local HTTP host, otherwise the browser drops it
  // and every subsequent API call looks unauthenticated.
  const host = String(req.headers?.host || "").split(":")[0].toLowerCase();
  const localHost = host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "[::1]";
  return !localHost && process.env.NODE_ENV === "production";
}

export function setSessionCookie(req, res, roleId) {
  const secure = requestIsSecure(req) ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${createSessionToken(roleId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`,
  );
}

export function clearSessionCookie(req, res) {
  const secure = requestIsSecure(req) ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`,
  );
}

export function getSession(req) {
  const token = parseCookies(req.headers?.cookie || "")[SESSION_COOKIE];
  if (!token) return null;
  const [encodedPayload, signature, extra] = token.split(".");
  if (!encodedPayload || !signature || extra || !safeEqual(signature, signSession(encodedPayload))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    if (payload.v !== SESSION_VERSION || !ROLE_IDS.includes(payload.role) || !Number.isFinite(payload.exp) || payload.exp <= now) {
      return null;
    }
    return { roleId: payload.role, issuedAt: payload.iat, expiresAt: payload.exp };
  } catch {
    return null;
  }
}

export function requireSession(req) {
  const session = getSession(req);
  if (!session) throw new HttpError(401, "UNAUTHORIZED", "请先输入密码登录。");
  return session;
}

function requestIp(req) {
  return String(req.headers?.["x-forwarded-for"] || req.headers?.["x-real-ip"] || "unknown")
    .split(",")[0].trim().slice(0, 80) || "unknown";
}

export function checkLoginRateLimit(req) {
  const key = requestIp(req);
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || now - current.startedAt >= LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { startedAt: now, count: 1 });
    return;
  }
  if (current.count >= LOGIN_LIMIT) {
    const retryAfter = Math.max(1, Math.ceil((LOGIN_WINDOW_MS - (now - current.startedAt)) / 1000));
    throw new HttpError(429, "RATE_LIMITED", "尝试次数过多，请稍后再试。", { retryAfter });
  }
  current.count += 1;
}

export function clearLoginRateLimit(req) {
  loginAttempts.delete(requestIp(req));
}

export async function identifyRoleByPassword(password) {
  if (typeof password !== "string" || !password || password.length > 256) {
    throw new HttpError(400, "INVALID_PASSWORD", "请输入有效密码。");
  }

  const hashes = [
    process.env.APP_PASSWORD_ME_HASH?.trim(),
    process.env.APP_PASSWORD_PARTNER_HASH?.trim(),
  ];
  if (hashes.some((hash) => !hash || !/^\$2[aby]\$/.test(hash))) {
    throw new HttpError(503, "SERVER_NOT_CONFIGURED", "登录密码哈希尚未正确配置。");
  }

  const matches = await Promise.all(hashes.map((hash) => bcrypt.compare(password, hash)));
  const index = matches.findIndex(Boolean);
  return index < 0 ? null : ROLE_IDS[index];
}

export function assertRole(roleId) {
  if (!ROLE_IDS.includes(roleId)) {
    throw new HttpError(400, "INVALID_ROLE", "身份参数不正确。");
  }
  return roleId;
}

export function partnerRole(roleId) {
  assertRole(roleId);
  return roleId === "me" ? "partner" : "me";
}

export function appTimezone() {
  const timezone = process.env.APP_TIMEZONE?.trim() || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    return timezone;
  } catch {
    throw new HttpError(503, "SERVER_NOT_CONFIGURED", "APP_TIMEZONE 不是有效时区。");
  }
}

export function dateInTimezone(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: appTimezone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).reduce((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function validateDate(value, fallback = dateInTimezone()) {
  const date = value || fallback;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new HttpError(400, "INVALID_DATE", "日期格式应为 YYYY-MM-DD。");
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new HttpError(400, "INVALID_DATE", "日期无效。");
  }
  return date;
}

function boundedText(value, name, maximum) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new HttpError(400, "INVALID_INPUT", `${name} 必须是文字。`);
  const result = value.trim();
  if (result.length > maximum) throw new HttpError(400, "INVALID_INPUT", `${name} 最多 ${maximum} 个字符。`);
  return result;
}

function score(value, name) {
  const number = Number(value ?? 0);
  if (!Number.isInteger(number) || number < 0 || number > 5) {
    throw new HttpError(400, "INVALID_SCORE", `${name}应为 0 到 5 的整数。`);
  }
  return number;
}

export function sanitizeLog(payload = {}) {
  const images = payload.images ?? [];
  if (!Array.isArray(images) || images.length > 6 || images.some((item) => typeof item !== "string" || item.length > 2048)) {
    throw new HttpError(400, "INVALID_INPUT", "记录中的图片列表无效。");
  }
  return {
    date: validateDate(payload.date),
    growthText: boundedText(payload.growthText, "学习与工作记录", 50_000),
    lifeText: boundedText(payload.lifeText, "生活与娱乐记录", 50_000),
    growthScore: score(payload.growthScore, "学习与工作得分"),
    lifeScore: score(payload.lifeScore, "生活与娱乐得分"),
    images,
  };
}

export function sanitizeWishText(value) {
  const text = boundedText(value, "愿望", 280);
  if (!text) throw new HttpError(400, "INVALID_WISH", "请先写下一个具体的小愿望。");
  return text;
}

export function sanitizeDisplayName(value) {
  if (typeof value !== "string") {
    throw new HttpError(400, "INVALID_DISPLAY_NAME", "昵称必须是文字。");
  }
  const name = value.trim();
  if (!name) {
    throw new HttpError(400, "INVALID_DISPLAY_NAME", "昵称不能为空白。");
  }
  if (Array.from(name).length > 16) {
    throw new HttpError(400, "INVALID_DISPLAY_NAME", "昵称最多 16 个字。");
  }
  if (/[\u0000-\u001F\u007F]/.test(name)) {
    throw new HttpError(400, "INVALID_DISPLAY_NAME", "昵称不能包含控制字符。");
  }
  return name;
}

export function throwIfSupabaseError(error, fallback = "数据库操作失败。") {
  if (!error) return;
  const message = String(error.message || fallback);
  const normalized = message.toLowerCase();
  if (normalized.includes("insufficient_stars")) {
    throw new HttpError(409, "NO_STARS", "这段关系中还没有可用的 Star。");
  }
  if (normalized.includes("forbidden")) {
    throw new HttpError(403, "FORBIDDEN", "你不能进行这个操作。");
  }
  if (normalized.includes("invalid_transition")) {
    throw new HttpError(409, "INVALID_TRANSITION", "愿望状态已经变化，请刷新后再试。");
  }
  if (normalized.includes("not_found")) {
    throw new HttpError(404, "NOT_FOUND", "没有找到对应内容。");
  }
  if (normalized.includes("invalid_score") || normalized.includes("invalid_text") || normalized.includes("invalid_images") || normalized.includes("invalid_wish") || normalized.includes("invalid_display_name")) {
    throw new HttpError(400, "INVALID_INPUT", "提交内容不符合要求。");
  }
  if (["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code)) {
    throw new HttpError(503, "DATABASE_NOT_MIGRATED", "数据库尚未完成初始化，请先运行 supabase/schema.sql。");
  }
  throw new HttpError(502, "DATABASE_ERROR", fallback);
}

function isTransientReadError(result) {
  const error = result?.error;
  if (!error) return false;

  const code = String(error.code || "").toUpperCase();
  if (NON_RETRYABLE_DATABASE_CODES.has(code)) return false;

  const status = Number(result?.status || error.status || 0);
  return [500, 502, 504].includes(status);
}

async function readWithRetry(label, operation) {
  const startedAt = Date.now();
  let result;
  try {
    result = await operation();
  } catch (error) {
    result = { data: null, error, status: 0 };
  }

  if (!isTransientReadError(result)) return result;
  console.warn("Retrying transient Supabase read", {
    label,
    attempt: 2,
    status: Number(result?.status || result?.error?.status || 0),
    code: String(result?.error?.code || ""),
  });
  const delay = READ_RETRY_MIN_DELAY_MS + Math.floor(Math.random() * READ_RETRY_JITTER_MS);
  await new Promise((resolve) => setTimeout(resolve, delay));

  try {
    const retried = await operation();
    if (retried?.error) {
      console.warn("Supabase read failed after retry", {
        label,
        attempt: 2,
        status: Number(retried.status || retried.error.status || 0),
        code: String(retried.error.code || ""),
        elapsedMs: Date.now() - startedAt,
      });
    }
    return retried;
  } catch (error) {
    console.warn("Supabase read failed after retry", {
      label,
      attempt: 2,
      status: Number(error?.status || 0),
      code: String(error?.code || ""),
      elapsedMs: Date.now() - startedAt,
    });
    return { data: null, error, status: 0 };
  }
}

function formatUpdateTime(timestamp) {
  if (!timestamp) return null;
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: appTimezone(),
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(timestamp));
  } catch {
    return null;
  }
}

function defaultProfile(roleId) {
  return roleId === "me"
    ? { id: "me", name: "我", initials: "我", avatar: "" }
    : { id: "partner", name: "搭档", initials: "友", avatar: "" };
}

async function resolveMediaUrl(supabase, storedValue) {
  if (!storedValue) return "";
  // Keep compatibility with an earlier public-bucket prototype.
  if (/^https?:\/\//i.test(storedValue)) return storedValue;
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(storedValue, 60 * 60);
  throwIfSupabaseError(error, "生成图片访问地址失败。");
  return data?.signedUrl || "";
}

export async function loadState(sessionRole) {
  assertRole(sessionRole);
  const supabase = getSupabase();
  const [profilesResult, logsResult, walletsResult, wishesResult, reactionsResult] = await Promise.all([
    readWithRetry("profiles", () => supabase.from("profiles").select("id, display_name, initials, theme, avatar_url, background_url").in("id", ROLE_IDS)),
    readWithRetry("daily_logs", () => supabase.from("daily_logs").select("room_id, role_id, log_date, growth_text, life_text, growth_score, life_score, images, updated_at").eq("room_id", ROOM_ID).order("log_date", { ascending: true }).limit(1000)),
    readWithRetry("wallet_summary", () => supabase.from("wallet_summary").select("room_id, role_id, points, stars, lifetime_points").eq("room_id", ROOM_ID)),
    readWithRetry("wishes", () => supabase.from("wishes").select("id, room_id, from_role_id, to_role_id, text, status, created_at, updated_at").eq("room_id", ROOM_ID).order("created_at", { ascending: true }).limit(500)),
    readWithRetry("reactions", () => supabase.from("reactions").select("room_id, target_role_id, log_date, reactor_role_id").eq("room_id", ROOM_ID)),
  ]);

  for (const result of [profilesResult, logsResult, walletsResult, wishesResult, reactionsResult]) {
    throwIfSupabaseError(result.error, "读取共享数据失败。");
  }

  const roles = Object.fromEntries(ROLE_IDS.map((roleId) => [roleId, defaultProfile(roleId)]));
  const backgrounds = Object.fromEntries(ROLE_IDS.map((roleId) => [roleId, ""]));
  for (const row of profilesResult.data || []) {
    if (!ROLE_IDS.includes(row.id)) continue;
    const [avatar, background] = await Promise.all([
      resolveMediaUrl(supabase, row.avatar_url),
      resolveMediaUrl(supabase, row.background_url),
    ]);
    roles[row.id] = {
      id: row.id,
      name: row.display_name || defaultProfile(row.id).name,
      initials: row.initials || defaultProfile(row.id).initials,
      avatar,
    };
    backgrounds[row.id] = background;
  }

  const logs = {};
  for (const row of logsResult.data || []) {
    logs[`${row.room_id}|${row.role_id}|${row.log_date}`] = {
      growthText: row.growth_text || "",
      lifeText: row.life_text || "",
      growthScore: Number(row.growth_score || 0),
      lifeScore: Number(row.life_score || 0),
      images: Array.isArray(row.images) ? row.images : [],
      updatedAt: formatUpdateTime(row.updated_at),
    };
  }

  const wallets = Object.fromEntries(ROLE_IDS.map((roleId) => [
    `${ROOM_ID}|${roleId}`,
    { points: 0, stars: 0 },
  ]));
  for (const row of walletsResult.data || []) {
    if (!ROLE_IDS.includes(row.role_id)) continue;
    wallets[`${row.room_id}|${row.role_id}`] = {
      points: Number(row.points || 0),
      stars: Number(row.stars || 0),
    };
  }

  const wishes = (wishesResult.data || []).map((row) => ({
    id: row.id,
    roomId: row.room_id,
    from: row.from_role_id,
    to: row.to_role_id,
    text: row.text,
    status: row.status,
    createdAt: String(row.created_at).slice(0, 10),
    updatedAt: row.updated_at,
  }));

  const reactions = {};
  for (const row of reactionsResult.data || []) {
    const key = `${row.room_id}|${row.target_role_id}|${row.log_date}`;
    if (!reactions[key]) reactions[key] = { count: 0, by: [] };
    if (!reactions[key].by.includes(row.reactor_role_id)) {
      reactions[key].by.push(row.reactor_role_id);
      reactions[key].count += 1;
    }
  }

  const currentProfile = (profilesResult.data || []).find((row) => row.id === sessionRole);
  return {
    version: 5,
    theme: currentProfile?.theme === "dark" ? "dark" : "light",
    sessionRole,
    roles,
    rooms: { [ROOM_ID]: { id: ROOM_ID, name: "我们的日常", members: [...ROLE_IDS] } },
    logs,
    drafts: {},
    wallets,
    wishes,
    reactions,
    backgrounds,
  };
}

export function parseDataUrl(value) {
  if (typeof value !== "string") throw new HttpError(400, "INVALID_IMAGE", "图片数据无效。");
  const match = value.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw new HttpError(400, "INVALID_IMAGE", "仅支持 JPEG、PNG、WebP 或 GIF 图片。");
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!bytes.length) throw new HttpError(400, "INVALID_IMAGE", "图片内容为空。");
  return { contentType: match[1], bytes };
}

export function extensionForMime(contentType) {
  return ({
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  })[contentType];
}
