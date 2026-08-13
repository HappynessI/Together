import crypto from "node:crypto";
import {
  HttpError,
  MEDIA_BUCKET,
  appTimeMetadata,
  extensionForMime,
  getSupabase,
  loadState,
  methodNotAllowed,
  parseDataUrl,
  readRawBody,
  requireSession,
  sendJson,
  throwIfSupabaseError,
  withApiHandler,
} from "../lib/server.js";

export const config = { api: { bodyParser: false } };

const MAX_UPLOAD_BYTES = 9 * 1024 * 1024;
const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function parseContentDisposition(value = "") {
  const name = value.match(/(?:^|;)\s*name="([^"]+)"/i)?.[1];
  const filename = value.match(/(?:^|;)\s*filename="([^"]*)"/i)?.[1];
  return { name, filename };
}

function parseMultipart(buffer, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const headerSeparator = Buffer.from("\r\n\r\n");
  const parts = [];
  let cursor = buffer.indexOf(delimiter);

  while (cursor >= 0) {
    cursor += delimiter.length;
    if (buffer.subarray(cursor, cursor + 2).toString() === "--") break;
    if (buffer.subarray(cursor, cursor + 2).toString() === "\r\n") cursor += 2;
    const next = buffer.indexOf(delimiter, cursor);
    if (next < 0) break;
    let end = next;
    if (buffer.subarray(end - 2, end).toString() === "\r\n") end -= 2;
    const headerEnd = buffer.indexOf(headerSeparator, cursor);
    if (headerEnd < 0 || headerEnd > end) break;
    const headers = Object.fromEntries(buffer.subarray(cursor, headerEnd).toString("utf8").split("\r\n").map((line) => {
      const separator = line.indexOf(":");
      return [line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim()];
    }));
    const disposition = parseContentDisposition(headers["content-disposition"]);
    parts.push({
      ...disposition,
      contentType: headers["content-type"]?.toLowerCase(),
      data: buffer.subarray(headerEnd + headerSeparator.length, end),
    });
    cursor = next;
  }
  return parts;
}

async function readUpload(req) {
  const contentType = String(req.headers["content-type"] || "");
  const raw = await readRawBody(req, MAX_UPLOAD_BYTES);

  if (contentType.toLowerCase().startsWith("application/json")) {
    let body;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      throw new HttpError(400, "INVALID_JSON", "上传请求不是有效的 JSON。");
    }
    const parsed = parseDataUrl(body.dataUrl || body.data);
    return { kind: body.kind, ...parsed };
  }

  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.slice(1).find(Boolean)?.trim();
  if (!contentType.toLowerCase().startsWith("multipart/form-data") || !boundary) {
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "请使用 multipart/form-data 或 JSON dataUrl 上传图片。");
  }
  const parts = parseMultipart(raw, boundary);
  const kind = parts.find((part) => part.name === "kind")?.data.toString("utf8").trim();
  const file = parts.find((part) => part.name === "file");
  if (!file?.data?.length || !MIME_TYPES.has(file.contentType)) {
    throw new HttpError(400, "INVALID_IMAGE", "仅支持 JPEG、PNG、WebP 或 GIF 图片。");
  }
  return { kind, contentType: file.contentType, bytes: file.data };
}

export default withApiHandler(async (req, res) => {
  if (req.method !== "POST") methodNotAllowed(res, ["POST"]);
  const { roleId } = requireSession(req);
  const upload = await readUpload(req);
  if (!["avatar", "background"].includes(upload.kind)) {
    throw new HttpError(400, "INVALID_MEDIA_KIND", "图片用途应为 avatar 或 background。");
  }

  const maximum = upload.kind === "avatar" ? 3 * 1024 * 1024 : 8 * 1024 * 1024;
  if (upload.bytes.length > maximum) {
    throw new HttpError(413, "IMAGE_TOO_LARGE", upload.kind === "avatar" ? "头像不能超过 3MB。" : "背景图不能超过 8MB。");
  }

  const supabase = getSupabase();
  const extension = extensionForMime(upload.contentType);
  const path = `${roleId}/${upload.kind}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${extension}`;
  const { error: uploadError } = await supabase.storage.from(MEDIA_BUCKET).upload(path, upload.bytes, {
    contentType: upload.contentType,
    cacheControl: "31536000",
    upsert: false,
  });
  throwIfSupabaseError(uploadError, "上传图片失败，请确认已创建 pair-media 存储桶。");

  const column = upload.kind === "avatar" ? "avatar_url" : "background_url";
  const { error: updateError } = await supabase.from("profiles").update({ [column]: path }).eq("id", roleId);
  throwIfSupabaseError(updateError, "保存图片地址失败。");

  const state = await loadState(roleId);
  const url = upload.kind === "avatar" ? state.roles[roleId]?.avatar : state.backgrounds[roleId];
  sendJson(res, 200, { ok: true, kind: upload.kind, url, state, ...appTimeMetadata() });
});
