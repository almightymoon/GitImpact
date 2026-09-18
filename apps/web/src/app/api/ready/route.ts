import { NextResponse } from "next/server";
import { isDatabaseConfigured, databasePing } from "@gitimpact/db";
import { redisPing, getRuntimeMode, validateConfig } from "@gitimpact/ops";

export const runtime = "nodejs";

/** Readiness — dependencies available for serving traffic */
export async function GET() {
  const mode = getRuntimeMode();
  const config = validateConfig();
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  if (isDatabaseConfigured()) {
    const dbOk = await databasePing();
    checks.database = { ok: dbOk, detail: dbOk ? undefined : "ping failed" };
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
