import { describe, it, expect, vi, beforeEach } from "vitest";
import { LlmAdvisor } from "../llm-advisor";

// Test the pure logic parts of LlmAdvisor without actual HTTP calls

describe("LlmAdvisor.parseResponse (via buildPrompt shape)", () => {
  it("parses valid JSON execute response", () => {
    const advisor = new LlmAdvisor();
    // Access private method via type assertion for testing
    const parse = (advisor as any).parseResponse.bind(advisor);

    const result = parse('{"decision":"execute","confidence":85,"reasoning":"strong RSI signal","sizeMult":1.0}');
    expect(result.decision).toBe("execute");
    expect(result.confidence).toBe(85);
    expect(result.reasoning).toBe("strong RSI signal");
    expect(result.sizeMult).toBe(1.0);
  });

  it("parses JSON wrapped in markdown code block", () => {
    const advisor = new LlmAdvisor();
    const parse = (advisor as any).parseResponse.bind(advisor);

    const raw = '```json\n{"decision":"skip","confidence":90,"reasoning":"high funding","sizeMult":0.5}\n```';
    const result = parse(raw);
    expect(result.decision).toBe("skip");
    expect(result.confidence).toBe(90);
  });

  it("defaults invalid decision to execute", () => {
    const advisor = new LlmAdvisor();
    const parse = (advisor as any).parseResponse.bind(advisor);

    const result = parse('{"decision":"unknown","confidence":50,"reasoning":"test","sizeMult":1.0}');
    expect(result.decision).toBe("execute");
  });

  it("clamps confidence to 0-100", () => {
    const advisor = new LlmAdvisor();
    const parse = (advisor as any).parseResponse.bind(advisor);

    const over = parse('{"decision":"execute","confidence":150,"reasoning":"x","sizeMult":1.0}');
    expect(over.confidence).toBe(100);

    const under = parse('{"decision":"execute","confidence":-10,"reasoning":"x","sizeMult":1.0}');
    expect(under.confidence).toBe(0);
  });

  it("defaults sizeMult to 1.0 for invalid values", () => {
    const advisor = new LlmAdvisor();
    const parse = (advisor as any).parseResponse.bind(advisor);

    const result = parse('{"decision":"execute","confidence":70,"reasoning":"x","sizeMult":3.5}');
    expect(result.sizeMult).toBe(1.0);
  });
});

describe("LlmAdvisor.defaultDecision", () => {
  it("returns execute with sizeMult 0.5 and error field", () => {
    const advisor = new LlmAdvisor();
    const def = (advisor as any).defaultDecision.bind(advisor);

    const result = def("all keys exhausted");
    expect(result.decision).toBe("execute");
    expect(result.sizeMult).toBe(0.5);
    expect(result.error).toBe("all keys exhausted");
    expect(result.keyUsed).toBe("none");
  });
});

describe("LlmAdvisor key rotation logic", () => {
  it("pickHealthyKey returns null when all unhealthy", () => {
    const advisor = new LlmAdvisor();
    (advisor as any).keys = [
      { id: 1, label: "primary", provider: "ollama", endpoint: "http://a", apiKey: "", model: "llama3", priority: 1 },
    ];
    (advisor as any).unhealthyUntil.set(1, Date.now() + 60_000);

    const key = (advisor as any).pickHealthyKey.call(advisor);
    expect(key).toBeNull();
  });

  it("pickHealthyKey returns expired unhealthy key", () => {
    const advisor = new LlmAdvisor();
    (advisor as any).keys = [
      { id: 1, label: "primary", provider: "ollama", endpoint: "http://a", apiKey: "", model: "llama3", priority: 1 },
    ];
    (advisor as any).unhealthyUntil.set(1, Date.now() - 1000); // expired

    const key = (advisor as any).pickHealthyKey.call(advisor);
    expect(key).not.toBeNull();
    expect(key.id).toBe(1);
  });

  it("pickHealthyKey selects lowest priority", () => {
    const advisor = new LlmAdvisor();
    (advisor as any).keys = [
      { id: 2, label: "backup", priority: 2, provider: "ollama", endpoint: "http://b", apiKey: "", model: "llama3" },
      { id: 1, label: "primary", priority: 1, provider: "ollama", endpoint: "http://a", apiKey: "", model: "llama3" },
    ];
    // Mark priority-1 key unhealthy
    (advisor as any).unhealthyUntil.set(1, Date.now() + 60_000);

    const key = (advisor as any).pickHealthyKey.call(advisor);
    expect(key.id).toBe(2);
  });
});
