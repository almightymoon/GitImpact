import { Router } from "express";
import { authenticate, register } from "../auth.service";

export const authRouter = Router();

authRouter.post("/login", (req, res) => {
  res.json(authenticate(req.body.email, req.body.password));
});

authRouter.post("/signup", (req, res) => {
  res.json(register(req.body.email));
});

authRouter.get("/health", (_req, res) => {
  res.json({ ok: true });
});
