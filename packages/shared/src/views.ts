/** v1.2 — saved / team views for architecture focus */

export type ViewVisibility = "repo" | "org" | "private";
export type ViewRole = "viewer" | "editor" | "admin";

export interface SavedView {
  id: string;
  repositoryId: string;
  name: string;
  /** Architecture system component ids to pin / emphasize */
  pinnedSystemIds: string[];
  /** Optional bands to hide (actors, client, server, …) */
  hiddenBands: string[];
  /** Optional free-form notes for the team */
  notes?: string;
  /** Local vs shared (DB) */
  scope: "local" | "team";
  /** GitHub org / owner login for org-scoped views */
  orgLogin?: string;
  /** Who can see this view */
  visibility: ViewVisibility;
  /** GitHub login of creator */
  createdBy?: string;
  /** Minimum role required to mutate this view */
  roleRequired: ViewRole;
  createdAt: string;
  updatedAt: string;
}

export interface SavedViewInput {
  name: string;
  pinnedSystemIds?: string[];
  hiddenBands?: string[];
  notes?: string;
  scope?: "local" | "team";
  orgLogin?: string;
  visibility?: ViewVisibility;
  createdBy?: string;
  roleRequired?: ViewRole;
}

export interface ViewActorContext {
  /** GitHub login */
  login?: string;
  /** GitHub org logins the actor belongs to */
  orgs?: string[];
  /** Effective role for write checks (default viewer) */
  role?: ViewRole;
}

const ROLE_RANK: Record<ViewRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
};

export function roleAtLeast(have: ViewRole | undefined, need: ViewRole): boolean {
  return ROLE_RANK[have ?? "viewer"] >= ROLE_RANK[need];
}

/** Whether the actor may see a view given visibility / org / creator. */
export function canReadSavedView(
  view: Pick<SavedView, "visibility" | "orgLogin" | "createdBy" | "repositoryId">,
  ctx?: ViewActorContext,
): boolean {
  if (view.visibility === "repo") return true;
  if (view.visibility === "private") {
    return Boolean(ctx?.login && ctx.login === view.createdBy);
  }
  // org
  if (!view.orgLogin) return true;
  if (ctx?.login && ctx.login === view.createdBy) return true;
  return Boolean(ctx?.orgs?.some((o) => o.toLowerCase() === view.orgLogin!.toLowerCase()));
}

/** Whether the actor may create/update/delete a view. */
export function canWriteSavedView(
  view: Pick<SavedView, "roleRequired" | "createdBy" | "visibility">,
  ctx?: ViewActorContext,
): boolean {
  if (roleAtLeast(ctx?.role, "admin")) return true;
  if (!roleAtLeast(ctx?.role, view.roleRequired)) {
    // Unauthenticated demo writes still allowed for repo-visible views
    if (!ctx?.login && view.visibility === "repo" && view.roleRequired === "viewer") {
      return true;
    }
    return false;
  }
  if (view.visibility === "private" && ctx?.login && view.createdBy) {
    return ctx.login === view.createdBy || roleAtLeast(ctx.role, "admin");
  }
  return true;
}
