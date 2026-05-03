import { test, expect, describe, beforeEach, afterEach, vi } from "bun:test";
import { ProviderRouter } from "../src/providers/router";

describe("spy isolation test", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  
  beforeEach(() => {
    spy = vi.spyOn(ProviderRouter.prototype, "completion" as any);
    spy.mockImplementation(async () => ({ content: "default", provider: "groq", model: "x", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }));
  });
  
  afterEach(() => {
    spy.mockRestore();
  });
  
  test("local spy overrides correctly", async () => {
    spy.mockRestore();
    const localSpy = vi.spyOn(ProviderRouter.prototype, "completion" as any);
    let firstCall = true;
    localSpy.mockImplementation(() => {
      if (firstCall) {
        firstCall = false;
        return Promise.resolve({ content: "A", provider: "groq", model: "x", usage: {} });
      }
      return new Promise(resolve => setTimeout(() => resolve({ content: "B", provider: "groq", model: "x", usage: {} }), 500));
    });
    
    const r = new ProviderRouter();
    const r1 = await r.completion({ messages: [{ role: "user", content: "test" }], provider: "groq" } as any);
    expect(r1.content).toBe("A");
    localSpy.mockRestore();
  });
});
