import { stripCodeFences } from "../../src/helpers/strip-code-fences.js";

describe("stripCodeFences", () => {
  it("returns input unchanged when no fences present", () => {
    const input = "key: value\nlist:\n  - a\n  - b";
    expect(stripCodeFences(input)).toBe(input);
  });

  it("strips fenced block with language hint", () => {
    const inner = "key: value\nlist:\n  - a\n  - b";
    const input = "```yaml\n" + inner + "\n```";
    expect(stripCodeFences(input)).toBe(inner);
  });

  it("strips fenced block without language hint", () => {
    const inner = "foo: bar";
    const input = "```\n" + inner + "\n```";
    expect(stripCodeFences(input)).toBe(inner);
  });

  it("trims whitespace around content inside fences", () => {
    const inner = "foo: bar";
    const input = "```yaml\n\n  " + inner + "  \n\n```";
    expect(stripCodeFences(input)).toBe("foo: bar");
  });

  it("removes stray opening or closing fences if present", () => {
    expect(stripCodeFences("```yaml\nfoo: bar")).toBe("foo: bar");
    expect(stripCodeFences("foo: bar\n```")).toBe("foo: bar");
  });

  it("handles empty string", () => {
    expect(stripCodeFences("")).toBe("");
  });
});
