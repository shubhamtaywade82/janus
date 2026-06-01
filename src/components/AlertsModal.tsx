import { useState, useEffect } from "react";
import { X, Bell, Trash2, ShieldAlert, Check, Plus, AlertCircle, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/providers/trpc";
import { toast } from "sonner";

// Supported Symbols list matching backend pairs
const ALERTS_SUPPORTED_PAIRS = [
  { binance: "BTCUSDT", name: "Bitcoin" },
  { binance: "ETHUSDT", name: "Ethereum" },
  { binance: "SOLUSDT", name: "Solana" },
  { binance: "BNBUSDT", name: "BNB" },
  { binance: "XRPUSDT", name: "XRP" },
  { binance: "ADAUSDT", name: "Cardano" },
  { binance: "DOGEUSDT", name: "Dogecoin" },
  { binance: "AVAXUSDT", name: "Avalanche" },
];

export interface AlertRule {
  id: string;
  symbol: string;
  type: "price" | "sweep" | "absorption" | "volatility" | "imbalance";
  operator?: ">" | "<";
  value: number; // target value
  isActive: boolean;
}

export interface AlertLog {
  id: string;
  timestamp: number;
  symbol: string;
  message: string;
  type: string;
}

interface AlertsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Utility helper to play sound chime using Web Audio API
export function playAlertChime() {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    // Play dual-tone chime
    const playTone = (freq: number, start: number, duration: number) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, start);
      
      gain.gain.setValueAtTime(0.12, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.start(start);
      osc.stop(start + duration);
    };

    const now = audioCtx.currentTime;
    playTone(523.25, now, 0.15); // C5
    playTone(783.99, now + 0.1, 0.3); // G5
  } catch (err) {
    console.error("Failed to synthesize audio chime:", err);
  }
}

const AlertsModal = ({ isOpen, onClose }: AlertsModalProps) => {
  const [activeTab, setActiveTab] = useState<"create" | "rules" | "logs" | "telegram">("create");
  
  // Rules and Logs State
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [logs, setLogs] = useState<AlertLog[]>([]);

  // Create Form State
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [type, setType] = useState<AlertRule["type"]>("price");
  const [operator, setOperator] = useState<AlertRule["operator"]>(">");
  const [value, setValue] = useState("");

  // Telegram settings state
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [isSavingTelegram, setIsSavingTelegram] = useState(false);
  const [isTestingTelegram, setIsTestingTelegram] = useState(false);

  // Queries/Mutations for Telegram settings
  const { data: telegramSettings, refetch: refetchTelegram } = trpc.telegram.getSettings.useQuery(
    undefined,
    { enabled: isOpen }
  );

  const saveTelegramSettings = trpc.telegram.saveSettings.useMutation();
  const testTelegramSettings = trpc.telegram.testSettings.useMutation();

  // Load backend Telegram settings into inputs
  useEffect(() => {
    if (telegramSettings) {
      setBotToken(telegramSettings.telegramBotToken || "");
      setChatId(telegramSettings.telegramChatId || "");
    }
  }, [telegramSettings]);

  // Load alert settings from local storage
  useEffect(() => {
    if (isOpen) {
      const storedRules = localStorage.getItem("janus_alert_rules");
      const storedLogs = localStorage.getItem("janus_alert_logs");
      if (storedRules) setRules(JSON.parse(storedRules));
      if (storedLogs) setLogs(JSON.parse(storedLogs));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const saveRules = (updatedRules: AlertRule[]) => {
    setRules(updatedRules);
    localStorage.setItem("janus_alert_rules", JSON.stringify(updatedRules));
    window.dispatchEvent(new Event("janus_alerts_changed"));
  };

  const saveLogs = (updatedLogs: AlertLog[]) => {
    setLogs(updatedLogs);
    localStorage.setItem("janus_alert_logs", JSON.stringify(updatedLogs));
  };

  const handleSaveTelegram = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingTelegram(true);
    try {
      await saveTelegramSettings.mutateAsync({
        telegramBotToken: botToken.trim() || null,
        telegramChatId: chatId.trim() || null,
      });
      toast.success("Telegram settings saved successfully!");
      refetchTelegram();
    } catch (err: any) {
      toast.error(err.message || "Failed to save Telegram settings");
    } finally {
      setIsSavingTelegram(false);
    }
  };

  const handleTestTelegram = async () => {
    if (!botToken.trim() || !chatId.trim()) {
      toast.error("Please enter both Bot Token and Chat ID to test.");
      return;
    }
    setIsTestingTelegram(true);
    try {
      const result = await testTelegramSettings.mutateAsync({
        telegramBotToken: botToken.trim(),
        telegramChatId: chatId.trim(),
      });
      if (result.success) {
        toast.success("Test message sent! Check Telegram.");
      } else {
        toast.error("Failed to send test message. Check your token/chat ID.");
      }
    } catch (err: any) {
      toast.error(err.message || "An error occurred during test.");
    } finally {
      setIsTestingTelegram(false);
    }
  };

  // Form submit handler
  const handleAddRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (type !== "volatility" && !value) return;

    const newRule: AlertRule = {
      id: Math.random().toString(36).substring(2, 9),
      symbol,
      type,
      operator: type === "volatility" ? undefined : operator,
      value: type === "volatility" ? 1 : parseFloat(value), // 1 signifies high volatility trigger
      isActive: true,
    };

    const updated = [...rules, newRule];
    saveRules(updated);
    setValue("");
    setActiveTab("rules");
  };

  const handleDeleteRule = (id: string) => {
    const updated = rules.filter((r) => r.id !== id);
    saveRules(updated);
  };

  const handleToggleRule = (id: string) => {
    const updated = rules.map((r) => (r.id === id ? { ...r, isActive: !r.isActive } : r));
    saveRules(updated);
  };

  const handleClearLogs = () => {
    saveLogs([]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md bg-[#09090b] border border-[#27272a] rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#27272a] bg-[#18181b]">
          <div className="flex items-center gap-2">
            <Bell size={15} className="text-[#f59e0b] animate-pulse" />
            <span className="text-xs font-bold text-[#f4f4f5] tracking-wide">Market Alert Rules</span>
          </div>
          <button
            onClick={onClose}
            className="text-[#71717a] hover:text-[#f4f4f5] transition-colors rounded p-1 hover:bg-[#27272a]"
          >
            <X size={14} />
          </button>
        </div>

        {/* Tab Headers */}
        <div className="flex border-b border-[#27272a] text-[10px] bg-[#18181b]/30">
          <button
            onClick={() => setActiveTab("create")}
            className={cn(
              "flex-1 py-2 text-center font-bold border-b-2 transition-all",
              activeTab === "create"
                ? "text-[#f4f4f5] border-[#f59e0b] bg-[#27272a]/20"
                : "text-[#71717a] border-transparent hover:text-[#a1a1aa]"
            )}
          >
            Create Trigger
          </button>
          <button
            onClick={() => setActiveTab("rules")}
            className={cn(
              "flex-1 py-2 text-center font-bold border-b-2 transition-all flex items-center justify-center gap-1.5",
              activeTab === "rules"
                ? "text-[#f4f4f5] border-[#f59e0b] bg-[#27272a]/20"
                : "text-[#71717a] border-transparent hover:text-[#a1a1aa]"
            )}
          >
            Active Rules ({rules.length})
          </button>
          <button
            onClick={() => setActiveTab("logs")}
            className={cn(
              "flex-1 py-2 text-center font-bold border-b-2 transition-all flex items-center justify-center gap-1.5",
              activeTab === "logs"
                ? "text-[#f4f4f5] border-[#f59e0b] bg-[#27272a]/20"
                : "text-[#71717a] border-transparent hover:text-[#a1a1aa]"
            )}
          >
            Alert History ({logs.length})
          </button>
          <button
            onClick={() => setActiveTab("telegram")}
            className={cn(
              "flex-1 py-2 text-center font-bold border-b-2 transition-all flex items-center justify-center gap-1.5",
              activeTab === "telegram"
                ? "text-[#f4f4f5] border-[#f59e0b] bg-[#27272a]/20"
                : "text-[#71717a] border-transparent hover:text-[#a1a1aa]"
            )}
          >
            Telegram Config
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-auto p-4 min-h-[300px]">
          {/* Tab 1: Create Alert */}
          {activeTab === "create" && (
            <form onSubmit={handleAddRule} className="flex flex-col gap-3.5">
              {/* Target symbol dropdown */}
              <div>
                <label className="block text-[9px] uppercase tracking-wider text-[#71717a] font-semibold mb-1">
                  Trading Pair
                </label>
                <select
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  className="w-full bg-[#18181b] border border-[#27272a] rounded px-2.5 py-1.5 text-xs text-[#f4f4f5] focus:outline-none focus:border-[#f59e0b]"
                >
                  {ALERTS_SUPPORTED_PAIRS.map((pair) => (
                    <option key={pair.binance} value={pair.binance}>
                      {pair.binance} - {pair.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Alert Type */}
              <div>
                <label className="block text-[9px] uppercase tracking-wider text-[#71717a] font-semibold mb-1">
                  Condition Type
                </label>
                <select
                  value={type}
                  onChange={(e) => {
                    const newType = e.target.value as AlertRule["type"];
                    setType(newType);
                    if (newType === "volatility") {
                      setValue("1");
                    } else if (newType === "imbalance") {
                      setValue("0.5");
                    } else if (newType === "sweep") {
                      setValue("60");
                    } else if (newType === "absorption") {
                      setValue("60");
                    } else {
                      setValue("");
                    }
                  }}
                  className="w-full bg-[#18181b] border border-[#27272a] rounded px-2.5 py-1.5 text-xs text-[#f4f4f5] focus:outline-none focus:border-[#f59e0b]"
                >
                  <option value="price">Price (LTP)</option>
                  <option value="sweep">Tape Sweep Score</option>
                  <option value="absorption">Limit Wall Absorption</option>
                  <option value="imbalance">Order Book Imbalance (OFI)</option>
                  <option value="volatility">Volatility Regime Shift</option>
                </select>
              </div>

              {/* Operators and Target Values */}
              {type !== "volatility" && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-1">
                    <label className="block text-[9px] uppercase tracking-wider text-[#71717a] font-semibold mb-1">
                      Operator
                    </label>
                    <select
                      value={operator}
                      onChange={(e) => setOperator(e.target.value as AlertRule["operator"])}
                      className="w-full bg-[#18181b] border border-[#27272a] rounded px-2.5 py-1.5 text-xs text-[#f4f4f5] focus:outline-none focus:border-[#f59e0b]"
                    >
                      <option value=">">&gt; (Above)</option>
                      <option value="<">&lt; (Below)</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[9px] uppercase tracking-wider text-[#71717a] font-semibold mb-1">
                      Trigger Value
                    </label>
                    <input
                      type="number"
                      step="any"
                      placeholder={type === "price" ? "e.g. 68500" : "e.g. 50"}
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      required
                      className="w-full bg-[#18181b] border border-[#27272a] rounded px-2.5 py-1.5 text-xs text-[#f4f4f5] focus:outline-none focus:border-[#f59e0b] placeholder-[#52525b] tabular-nums"
                    />
                  </div>
                </div>
              )}

              {type === "volatility" && (
                <div className="p-2.5 rounded border border-[#ef4444]/20 bg-[#ef4444]/5 text-[#ef4444] text-[10px] leading-relaxed flex gap-2">
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>Triggers instantly when the symbol's volatility standard deviation enters the <strong>HIGH</strong> regime state.</span>
                </div>
              )}

              <button
                type="submit"
                className="w-full mt-2.5 py-2 rounded bg-[#f59e0b] hover:bg-[#d97706] text-black text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-[#f59e0b]/10"
              >
                <Plus size={14} />
                Create Active Rule
              </button>
            </form>
          )}

          {/* Tab 2: Active Rules */}
          {activeTab === "rules" && (
            <div className="flex flex-col gap-2">
              {rules.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-[#71717a] text-[10px] gap-1.5">
                  <Bell size={24} className="opacity-20 mb-1" />
                  <span>No alert rules configured.</span>
                </div>
              ) : (
                rules.map((rule) => (
                  <div
                    key={rule.id}
                    className="p-2.5 rounded border border-[#27272a] bg-[#1c1c1f]/40 flex items-center justify-between gap-2 transition-all hover:bg-[#27272a]/20"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] font-bold text-[#e4e4e7]">{rule.symbol}</span>
                      <span className="text-[9px] text-[#71717a] font-semibold uppercase">
                        {rule.type === "volatility"
                          ? "VOLATILITY REGIME ➡️ HIGH"
                          : `${rule.type.toUpperCase()} ${rule.operator} ${rule.value}`}
                      </span>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {/* Active/Inactive Toggle Button */}
                      <button
                        onClick={() => handleToggleRule(rule.id)}
                        className={cn(
                          "px-2 py-0.5 rounded text-[8px] font-bold border uppercase transition-all",
                          rule.isActive
                            ? "bg-[#0ecb81]/15 text-[#0ecb81] border-[#0ecb81]/40"
                            : "bg-[#27272a]/30 text-[#52525b] border-[#27272a]"
                        )}
                      >
                        {rule.isActive ? "Active" : "Disabled"}
                      </button>

                      {/* Delete Button */}
                      <button
                        onClick={() => handleDeleteRule(rule.id)}
                        className="text-[#71717a] hover:text-[#ef4444] p-1.5 hover:bg-[#27272a]/50 rounded transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Tab 3: History Logs */}
          {activeTab === "logs" && (
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-center mb-1">
                <span className="text-[9px] text-[#71717a] font-semibold uppercase">Triggered Alerts History</span>
                {logs.length > 0 && (
                  <button
                    onClick={handleClearLogs}
                    className="text-[9px] text-[#ef4444] hover:underline flex items-center gap-1 font-semibold"
                  >
                    Clear History
                  </button>
                )}
              </div>

              {logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-[#71717a] text-[10px] gap-1.5">
                  <ShieldAlert size={24} className="opacity-20 mb-1" />
                  <span>No alerts have triggered yet.</span>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5 max-h-[45vh] overflow-auto">
                  {logs.map((log) => (
                    <div
                      key={log.id}
                      className="p-2.5 rounded border border-[#27272a] bg-[#18181b]/20 flex flex-col gap-0.5 text-[10px] leading-relaxed border-l-2 border-l-[#ef4444]"
                    >
                      <div className="flex justify-between text-[8px] text-[#71717a] font-semibold">
                        <span className="text-white/60">{log.symbol}</span>
                        <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <span className="text-[#f4f4f5]">{log.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab 4: Telegram Settings */}
          {activeTab === "telegram" && (
            <form onSubmit={handleSaveTelegram} className="flex flex-col gap-4">
              <div>
                <span className="text-[10px] text-[#a1a1aa] leading-relaxed block">
                  Configure a Telegram Bot to receive real-time alert notifications directly on your Telegram account or group/channel.
                </span>
              </div>

              <div>
                <label className="block text-[9px] uppercase tracking-wider text-[#71717a] font-semibold mb-1">
                  Telegram Bot Token
                </label>
                <input
                  type="password"
                  placeholder="1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  className="w-full bg-[#18181b] border border-[#27272a] rounded px-2.5 py-1.5 text-xs text-[#f4f4f5] placeholder-[#52525b] focus:outline-none focus:border-[#f59e0b]"
                />
              </div>

              <div>
                <label className="block text-[9px] uppercase tracking-wider text-[#71717a] font-semibold mb-1">
                  Telegram Chat ID
                </label>
                <input
                  type="text"
                  placeholder="e.g. 518293021 or -100123456789"
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                  className="w-full bg-[#18181b] border border-[#27272a] rounded px-2.5 py-1.5 text-xs text-[#f4f4f5] placeholder-[#52525b] focus:outline-none focus:border-[#f59e0b]"
                />
                <span className="text-[8px] text-[#71717a] mt-1 block">
                  Enter your User ID for private DMs or a negative Group/Channel ID (e.g. <code>-100...</code>).
                </span>
              </div>

              <div className="flex gap-2 mt-2">
                <button
                  type="submit"
                  disabled={isSavingTelegram}
                  className="flex-1 bg-[#f59e0b] hover:bg-[#d97706] disabled:opacity-50 text-[#09090b] font-bold text-xs py-1.5 rounded transition-all flex items-center justify-center gap-1.5"
                >
                  <Check size={13} />
                  {isSavingTelegram ? "Saving..." : "Save Settings"}
                </button>
                <button
                  type="button"
                  onClick={handleTestTelegram}
                  disabled={isTestingTelegram || !botToken || !chatId}
                  className="px-4 bg-[#27272a] hover:bg-[#3f3f46] disabled:opacity-50 text-[#f4f4f5] font-bold text-xs py-1.5 rounded transition-all flex items-center justify-center gap-1.5 border border-[#3f3f46]"
                >
                  <Send size={11} />
                  {isTestingTelegram ? "Testing..." : "Test Message"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default AlertsModal;
