import express from "express";
import { authRouter } from "./routes/auth.router";

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.get("/api/status", (_req, res) => {
    res.json({ status: "ok" });
  });
  return app;
}
