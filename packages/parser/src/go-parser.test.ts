import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRepository } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const echoFixture = path.resolve(
  __dirname,
  "../../../tests/real-world/cases/go-echo-small",
);
const libFixture = path.resolve(
  __dirname,
  "../../../tests/real-world/cases/go-library-small",
);

describe("Go parser", () => {
  it("parses Echo-shaped imports, handlers, and cross-package calls", async () => {
    const parsed = await parseRepository(echoFixture);
    expect(parsed.languages.some((l) => l.language === "Go")).toBe(true);
    expect(parsed.frameworks).toContain("Echo");

    const main = parsed.files.find((f) => f.path === "main.go");
    expect(main).toBeTruthy();
    expect(main!.language).toBe("go");
    expect(
      main!.imports.some(
        (i) =>
          i.moduleSpecifier === "example.com/echo-small/handlers" &&
          i.resolvedPath === "handlers/users.go",
      ),
    ).toBe(true);

    const handlers = parsed.files.find((f) => f.path === "handlers/users.go");
    expect(handlers).toBeTruthy();
    const login = handlers!.functions.find((f) => f.name === "Login");
    expect(login).toBeTruthy();
    const issue = login!.calls.find((c) => c.calleeName === "IssueToken");
    expect(issue?.resolvedFile).toBe("handlers/users.go");
    expect(issue?.confidence).toBe("HIGH");
  });

  it("resolves library package CALLS across packages", async () => {
    const parsed = await parseRepository(libFixture);
    const main = parsed.files.find((f) => f.path === "main.go");
    expect(main).toBeTruthy();
    const issue = main!.functions
      .find((f) => f.name === "main")
      ?.calls.find((c) => c.calleeName === "Issue");
    expect(issue?.resolvedFile).toBe("pkg/tokens/tokens.go");
    expect(issue?.confidence).toBe("HIGH");
  });
});
