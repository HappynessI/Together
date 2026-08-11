import {
  clearSessionCookie,
  methodNotAllowed,
  sendJson,
  withApiHandler,
} from "../lib/server.js";

export default withApiHandler(async (req, res) => {
  if (req.method !== "POST") methodNotAllowed(res, ["POST"]);
  clearSessionCookie(req, res);
  sendJson(res, 200, { ok: true });
});
