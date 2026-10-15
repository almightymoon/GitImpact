import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRepository } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const javaFixture = path.resolve(
  __dirname,
  "../../../tests/real-world/cases/java-spring-small",
);
const rustFixture = path.resolve(
  __dirname,
  "../../../tests/real-world/cases/rust-axum-small",
);
const csharpFixture = path.resolve(
  __dirname,
  "../../../tests/real-world/cases/csharp-aspnet-small",
);

describe("Java / Rust / C# parsers", () => {
  it("parses Spring-shaped Java classes and calls", async () => {
    const parsed = await parseRepository(javaFixture);
    expect(parsed.languages.some((l) => l.language === "Java")).toBe(true);
    expect(parsed.frameworks).toContain("Spring");
    const controller = parsed.files.find((f) => f.path.endsWith("UserController.java"));
    expect(controller).toBeTruthy();
    const list = controller!.classes
      .flatMap((c) => c.methods)
      .find((m) => m.name === "listUsers");
    expect(list).toBeTruthy();
    const issue = list!.calls.find((c) => c.calleeName === "issue");
    expect(issue?.resolvedFile?.endsWith("TokenService.java")).toBe(true);
  });

  it("parses Axum-shaped Rust modules and calls", async () => {
    const parsed = await parseRepository(rustFixture);
    expect(parsed.languages.some((l) => l.language === "Rust")).toBe(true);
    expect(parsed.frameworks).toContain("Axum");
    const main = parsed.files.find((f) => f.path.endsWith("main.rs"));
    expect(main).toBeTruthy();
    const list = main!.functions.find((f) => f.name === "list_users");
    expect(list).toBeTruthy();
    const issue = list!.calls.find((c) => c.calleeName === "issue");
    expect(issue?.resolvedFile?.endsWith("tokens.rs")).toBe(true);
  });

  it("parses ASP.NET minimal C# Program and service", async () => {
    const parsed = await parseRepository(csharpFixture);
    expect(parsed.languages.some((l) => l.language === "C#")).toBe(true);
    expect(parsed.frameworks).toContain("ASP.NET");
    const program = parsed.files.find((f) => f.path.endsWith("Program.cs"));
    expect(program).toBeTruthy();
    expect(program!.functions.some((f) => f.name === "Program")).toBe(true);
  });
});
