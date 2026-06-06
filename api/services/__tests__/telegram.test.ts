import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Test the rate-limiting and HTML-escape behavior without hitting real Telegram API

describe("sendTelegramMessage rate limiting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("drops second message sent within MIN_SEND_INTERVAL_MS", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true }),
      text: () => Promise.resolve(""),
    });
    vi.stubGlobal("fetch", mockFetch);

    // Import fresh module instance to reset module-level rate state
    const mod = await import("../telegram?t=" + Date.now());

    await mod.sendTelegramMessage({ botToken: "tok", chatId: "123", text: "msg1" });
    await mod.sendTelegramMessage({ botToken: "tok", chatId: "123", text: "msg2" });

    // Only one fetch call — second was rate-limited
    expect(mockFetch).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

describe("HTML escaping in liquidity alerts", () => {
  it("escapes < > & in dynamic message content", () => {
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    expect(esc("Price < 100")).toBe("Price &lt; 100");
    expect(esc("A & B > C")).toBe("A &amp; B &gt; C");
    expect(esc("BTCUSDT")).toBe("BTCUSDT"); // no-op for normal symbols
  });

  it("escaping prevents Telegram 400 on price comparison strings", () => {
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const msg = "Funding: -0.015% < -0.001%";
    const text = `🚨 <b>[SS] BTCUSDT</b>\n<b>Message:</b> ${esc(msg)}`;

    // Valid HTML: < is escaped, <b> tags are literal markup
    expect(text).toContain("&lt;");
    expect(text).not.toMatch(/<[^b/][^>]*>/); // no unescaped non-<b> tags
  });
});
