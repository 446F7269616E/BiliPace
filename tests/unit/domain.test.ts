import { describe, expect, it } from "vitest";
import { getPrimaryDomain } from "../../src/shared/domain";

describe("primary domain display grouping", () => {
  it("groups sibling subdomains under a conventional parent", () => {
    expect(getPrimaryDomain("www.bilibili.com")).toBe("bilibili.com");
    expect(getPrimaryDomain("live.bilibili.com")).toBe("bilibili.com");
    expect(getPrimaryDomain("NEWS.Example.COM.")).toBe("example.com");
  });

  it("keeps the registrable label for common multi-label suffixes", () => {
    expect(getPrimaryDomain("docs.example.co.uk")).toBe("example.co.uk");
    expect(getPrimaryDomain("video.example.com.cn")).toBe("example.com.cn");
  });

  it("preserves local and IP hosts", () => {
    expect(getPrimaryDomain("localhost")).toBe("localhost");
    expect(getPrimaryDomain("127.0.0.1")).toBe("127.0.0.1");
    expect(getPrimaryDomain("[::1]")).toBe("[::1]");
  });
});
