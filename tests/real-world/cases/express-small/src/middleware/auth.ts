import type { Handler } from "./compose";
import { verifyToken } from "../services/auth";

export const requireAuth: Handler = async (req, res, next) => {
  const ok = await verifyToken(req.headers.authorization ?? "");
  if (!ok) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  await next();
};
