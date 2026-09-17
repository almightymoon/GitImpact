import { add } from "./math";

describe("add", () => {
  it("sums", () => {
    expect(add(1, 2)).toBe(3);
  });
});
