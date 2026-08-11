import {
  HttpError,
  checkLoginRateLimit,
  clearLoginRateLimit,
  identifyRoleByPassword,
  loadState,
  methodNotAllowed,
  readJsonBody,
  sendJson,
  setSessionCookie,
  withApiHandler,
} from "../lib/server.js";

export default withApiHandler(async (req, res) => {
  if (req.method !== "POST") methodNotAllowed(res, ["POST"]);
  checkLoginRateLimit(req);
  const body = await readJsonBody(req, 16 * 1024);
  const roleId = await identifyRoleByPassword(body.password);
  if (!roleId) {
    throw new HttpError(401, "INVALID_CREDENTIALS", "密码不对，请再试一次。");
  }

  clearLoginRateLimit(req);

  setSessionCookie(req, res, roleId);
  const state = await loadState(roleId);
  sendJson(res, 200, { ok: true, role: roleId, roleId, state });
});
