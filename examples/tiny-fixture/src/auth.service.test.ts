import { authenticate } from "./auth.service";

describe("authenticate", () => {
  it("returns a token", () => {
    expect(authenticate("a@b.com", "x").token).toBeDefined();
  });
});
