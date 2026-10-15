import type { ViewActorContext, ViewRole } from "@gitimpact/shared";

/**
 * Light identity for saved-view ACL (no full OAuth yet).
 * Headers: x-gitimpact-actor, x-gitimpact-orgs, x-gitimpact-role
 */
export function parseViewActor(request: Request): ViewActorContext | undefined {
  const login = request.headers.get("x-gitimpact-actor")?.trim() || undefined;
  const orgsRaw = request.headers.get("x-gitimpact-orgs")?.trim();
  const roleRaw = request.headers.get("x-gitimpact-role")?.trim()?.toLowerCase();
  const orgs = orgsRaw
    ? orgsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
  const role =
    roleRaw === "admin" || roleRaw === "editor" || roleRaw === "viewer"
      ? (roleRaw as ViewRole)
      : login
        ? ("editor" as ViewRole)
        : undefined;

  if (!login && !orgs?.length && !role) return undefined;
  return { login, orgs, role };
}
