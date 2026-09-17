import { Router } from "express";
import { authenticate } from "../lib/auth";

export const router = Router();

export function loginHandler(_req: unknown, res: { json: (body: unknown) => void }) {
  res.json(authenticate("a@b.com", "secret"));
}

router.post("/login", loginHandler);
