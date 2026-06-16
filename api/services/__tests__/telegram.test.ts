import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("sendTelegramMessage rate limiting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("drops second message sent within MIN_SEND_INTERVAL_MS", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true }),
      text: () => Promise.resolve(""),
    });
    vi.stubGlobal("fetch", mockFetch);

    const mod = await import("../telegram?t=" + Date.now());
    mod.__resetTelegramStateForTests();

    await mod.sendTelegramMessage({ botToken: "tok", chatId: "123", text: "msg1" });
    await mod.sendTelegramMessage({ botToken: "tok", chatId: "123", text: "msg2" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("sendTelegramMessage circuit breaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("opens circuit on network failure and skips subsequent sends", async () => {
    const networkError = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "UND_ERR_CONNECT_TIMEOUT" },
    });
    const mockFetch = vi.fn().mockRejectedValue(networkError);
    vi.stubGlobal("fetch", mockFetch);

    const mod = await import("../telegram?t=" + Date.now());
    mod.__resetTelegramStateForTests();

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await mod.sendTelegramMessage({ botToken: "tok", chatId: "123", text: "msg1" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mod.isTelegramPaused()).toBe(true);

    await mod.sendTelegramMessage({ botToken: "tok", chatId: "123", text: "msg2" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledOnce();

    warnSpy.mockRestore();
  });

  it("closes circuit after a successful send", async () => {
    const networkError = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "UND_ERR_CONNECT_TIMEOUT" },
    });
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true }),
        text: () => Promise.resolve(""),
      });
    vi.stubGlobal("fetch", mockFetch);

    const mod = await import("../telegram?t=" + Date.now());
    mod.__resetTelegramStateForTests();
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await mod.sendTelegramMessage({ botToken: "tok", chatId: "123", text: "fail" });
    expect(mod.isTelegramPaused()).toBe(true);

    vi.advanceTimersByTime(61_000);

    await mod.sendTelegramMessage({ botToken: "tok", chatId: "123", text: "ok" });
    expect(mod.isTelegramPaused()).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe("HTML escaping in liquidity alerts", () => {
  it("escapes < > & in dynamic message content", () => {
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    expect(esc("Price < 100")).toBe("Price &lt; 100");
    expect(esc("A & B > C")).toBe("A &amp; B &gt; C");
    expect(esc("BTCUSDT")).toBe("BTCUSDT");
  });

  it("escaping prevents Telegram 400 on price comparison strings", () => {
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const msg = "Funding: -0.015% < -0.001%";
    const text = `🚨 <b>[SS] BTCUSDT</b>\n<b>Message:</b> ${esc(msg)}`;

    expect(text).toContain("&lt;");
    expect(text).not.toMatch(/<[^b/][^>]*>/);
  });
});
