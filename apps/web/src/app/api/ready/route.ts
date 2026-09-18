import { NextResponse } from "next/server";
import { isDatabaseConfigured, getDb } from "@gitimpact/db";
import { redisPing, getRuntimeMode, validateConfig } from "@gitimpact/ops";

export const runtime = "nodejs";

/** Readiness — dependencies available for serving traffic */
export async function GET() {
  const mode = getRuntimeMode();
  const config = validateConfig();
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  if (isDatabaseConfigured()) {
    try {
      const db = getDb();
      checks.database = { ok: Boolean(db), detail: db ? undefined : "client null" };
    } catch (error) {
      checks.database = {
        ok: false,
        detail: error instanceof Error ? error.message : "unavailable",
      };
    }
  } else if (mode !== "production") {
    checks.database = { ok: true, detail: "optional in development (memory)" };
  } else {
    checks.database = { ok: false, detail: "DATABASE_URL required" };
  }

  const redisOk = await redisPing();
  if (process.env.REDIS_URL) {
    checks.redis = { ok: redisOk, detail: redisOk ? undefined : "ping failed" };
  } else if (mode === "production") {
    checks.redis = { ok: false, detail: "REDIS_URL required" };
  } else {
    checks.redis = { ok: true, detail: "optional in development (inline queue)" };
  }

  const ready = config.ok && Object.values(checks).every((c) => c.ok);

  return NextResponse.json(
    {
      ok: ready,
      mode,
      checks,
      configErrors: config.errors,
      configWarnings: config.warnings,
      ts: new Date().toISOString(),
    },
    { status: ready ? 200 : 503 },
  );
}
