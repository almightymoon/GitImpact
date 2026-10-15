import { describe, expect, it, beforeEach } from "vitest";
import {
  clearMemoryViewsForTests,
  createSavedView,
  listSavedViews,
  deleteSavedView,
} from "./views.js";

describe("saved views collab", () => {
  beforeEach(() => {
    clearMemoryViewsForTests();
    delete process.env.DATABASE_URL;
  });

  it("filters private views by actor", async () => {
    await createSavedView(
      "acme",
      "api",
      {
        name: "Mine",
        pinnedSystemIds: ["sys:a"],
        visibility: "private",
        createdBy: "alice",
      },
      { login: "alice", role: "editor" },
    );
    const asBob = await listSavedViews("acme", "api", { login: "bob", role: "viewer" });
    expect(asBob).toHaveLength(0);
    const asAlice = await listSavedViews("acme", "api", { login: "alice", role: "viewer" });
    expect(asAlice).toHaveLength(1);
  });

  it("allows org visibility for matching org membership", async () => {
    await createSavedView(
      "acme",
      "api",
      {
        name: "Org view",
        pinnedSystemIds: ["sys:a"],
        visibility: "org",
        orgLogin: "acme",
        createdBy: "alice",
      },
      { login: "alice", role: "editor", orgs: ["acme"] },
    );
    const outsider = await listSavedViews("acme", "api", {
      login: "bob",
      orgs: ["other"],
    });
    expect(outsider).toHaveLength(0);
    const member = await listSavedViews("acme", "api", {
      login: "carol",
      orgs: ["acme"],
    });
    expect(member).toHaveLength(1);
  });

  it("deletes with sufficient role", async () => {
    const view = await createSavedView(
      "acme",
      "api",
      { name: "Temp", pinnedSystemIds: [], roleRequired: "editor" },
      { login: "alice", role: "editor" },
    );
    await expect(
      deleteSavedView("acme", "api", view.id, { login: "bob", role: "viewer" }),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      deleteSavedView("acme", "api", view.id, { login: "alice", role: "editor" }),
    ).resolves.toBe(true);
  });
});
