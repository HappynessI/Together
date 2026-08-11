import {
  loadState,
  methodNotAllowed,
  requireSession,
  sendJson,
  withApiHandler,
} from "../lib/server.js";

export default withApiHandler(async (req, res) => {
  if (req.method !== "GET") methodNotAllowed(res, ["GET"]);
  const { roleId } = requireSession(req);
  const state = await loadState(roleId);
  sendJson(res, 200, {
    ok: true,
    role: roleId,
    roleId,
    state,
    serverTime: new Date().toISOString(),
  });
});
