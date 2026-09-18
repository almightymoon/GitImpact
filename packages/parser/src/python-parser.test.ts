import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRepository } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(
  __dirname,
  "../../../tests/real-world/cases/python-flask-small",
);

describe("Python parser", () => {
  it("parses Flask-shaped imports and cross-module calls", async () => {
    const parsed = await parseRepository(fixture);
    expect(parsed.languages.some((l) => l.language === "Python")).toBe(true);
    expect(parsed.frameworks).toContain("Flask");

    const app = parsed.files.find((f) => f.path === "app.py");
    expect(app).toBeTruthy();
    expect(app!.language).toBe("python");
    expect(
      app!.imports.some(
        (i) => i.resolvedPath === "services/auth.py" && i.namedImports.includes("issue_token"),
      ),
    ).toBe(true);

    const login = app!.functions.find((f) => f.name === "login");
    expect(login).toBeTruthy();
    const issue = login!.calls.find((c) => c.calleeName === "issue_token");
    expect(issue?.resolvedFile).toBe("services/auth.py");
    expect(issue?.confidence).toBe("HIGH");
  });
});
