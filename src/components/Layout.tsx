import { Link, useLocation } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { useState, useEffect, useRef } from "react";
import { trpc } from "@/providers/trpc";
import { toast } from "sonner";
import {
  TrendingUp,
  Wallet,
  Search,
  LogOut,
  Activity,
  Signal,
  ScrollText,
  ChevronRight,
  Settings,
  Shield,
  Bell,
} from "lucide-react";
import { cn } from "@/lib/utils";
import SettingsModal from "./SettingsModal";
import AlertsModal, { playAlertChime } from "./AlertsModal";
import type { AlertRule, AlertLog } from "./AlertsModal";

const navItems = [
  { path: "/", label: "Dashboard", icon: TrendingUp },
  { path: "/signals", label: "Signals", icon: Signal },
  { path: "/portfolio", label: "Portfolio", icon: Wallet },
  { path: "/risk", label: "Risk", icon: Shield },
  { path: "/logs", label: "Logs", icon: ScrollText },
];

const Layout = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const { user, logout } = useAuth({ redirectOnUnauthenticated: true });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAlertsOpen, setIsAlertsOpen] = useState(false);
  const [activeAlertsCount, setActiveAlertsCount] = useState(0);
  const lastAlertTimeRef = useRef<Record<string, number>>({});

  const sendTelegramAlert = trpc.telegram.sendAlert.useMutation();

  // Query to fetch all live states periodically for custom alerts comparison
  const { data: allStates } = trpc.market.allLiveStates.useQuery(undefined, {
    refetchInterval: 2000,
  });

  useEffect(() => {
    if (!allStates) return;

    // Load current alert rules from local storage
    let storedRules = localStorage.getItem("janus_alert_rules");
    if (!storedRules) {
      const defaultRules = [
        {
          id: "default-btc-volatility",
          symbol: "BTCUSDT",
          type: "volatility",
          value: 1,
          isActive: true,
        },
        {
          id: "default-eth-volatility",
          symbol: "ETHUSDT",
          type: "volatility",
          value: 1,
          isActive: true,
        },
        {
          id: "default-btc-imbalance-high",
          symbol: "BTCUSDT",
          type: "imbalance",
          operator: ">",
          value: 1.5,
          isActive: true,
        },
        {
          id: "default-btc-imbalance-low",
          symbol: "BTCUSDT",
          type: "imbalance",
          operator: "<",
          value: -1.5,
          isActive: true,
        },
      ];
      localStorage.setItem("janus_alert_rules", JSON.stringify(defaultRules));
      storedRules = JSON.stringify(defaultRules);
    }

    const alertRules: AlertRule[] = JSON.parse(storedRules);
    const activeRules = alertRules.filter((r) => r.isActive);
    if (activeRules.length === 0) return;

    const now = Date.now();
    const triggeredLogs: AlertLog[] = [];

    for (const rule of activeRules) {
      const state = allStates[rule.symbol];
      if (!state) continue;

      let isTriggered = false;
      let triggerMessage = "";

      const ltp = state.ltp || 0;
      const metrics = state.metrics || {};
      const cleanSymbol = rule.symbol.replace("B-", "").replace("_", "");

      // Evaluate condition
      switch (rule.type) {
        case "price":
          if (rule.operator === ">" && ltp > rule.value) {
            isTriggered = true;
            triggerMessage = `Price crossed ABOVE ${rule.value} (Current: ${ltp.toFixed(2)})`;
          } else if (rule.operator === "<" && ltp < rule.value) {
            isTriggered = true;
            triggerMessage = `Price crossed BELOW ${rule.value} (Current: ${ltp.toFixed(2)})`;
          }
          break;
        case "sweep":
          const sweep = metrics.sweepScore || 0;
          if (sweep > rule.value) {
            isTriggered = true;
            triggerMessage = `Sweep Intensity crossed above ${rule.value} (Current: ${sweep.toFixed(0)})`;
          }
          break;
        case "absorption":
          const absorb = metrics.absorptionScore || 0;
          if (absorb > rule.value) {
            isTriggered = true;
            triggerMessage = `Wall Limit Absorption crossed above ${rule.value} (Current: ${absorb.toFixed(0)})`;
          }
          break;
        case "imbalance":
          const imbalance = metrics.bidAskImbalance || 0;
          if (rule.operator === ">" && imbalance > rule.value) {
            isTriggered = true;
            triggerMessage = `OFI Imbalance went above ${rule.value} (Current: +${imbalance.toFixed(2)})`;
          } else if (rule.operator === "<" && imbalance < rule.value) {
            isTriggered = true;
            triggerMessage = `OFI Imbalance went below ${rule.value} (Current: ${imbalance.toFixed(2)})`;
          }
          break;
        case "volatility":
          if (metrics.volatilityRegime === "HIGH") {
            isTriggered = true;
            triggerMessage = `Volatility Regime shifted to HIGH!`;
          }
          break;
      }

      if (isTriggered) {
        // Apply a 1-minute cooldown per alert rule ID
        const lastTrigger = lastAlertTimeRef.current[rule.id] || 0;
        if (now - lastTrigger > 60_000) {
          lastAlertTimeRef.current[rule.id] = now;
          
          // Play sound and fire toast
          playAlertChime();
          toast.warning(`Alert: ${cleanSymbol} 🔔`, {
            description: triggerMessage,
            duration: 6000,
          });

          // Send Telegram message
          sendTelegramAlert.mutate({
            message: `🔔 <b>Janus Alert: ${cleanSymbol}</b>\n\n${triggerMessage}`,
          });

          // Push to logs
          triggeredLogs.push({
            id: Math.random().toString(36).substring(2, 9),
            timestamp: now,
            symbol: rule.symbol,
            message: triggerMessage,
            type: rule.type,
          });
        }
      }
    }

    if (triggeredLogs.length > 0) {
      const storedLogs = localStorage.getItem("janus_alert_logs");
      const currentLogs: AlertLog[] = storedLogs ? JSON.parse(storedLogs) : [];
      const updatedLogs = [...triggeredLogs, ...currentLogs].slice(0, 100); // keep last 100
      localStorage.setItem("janus_alert_logs", JSON.stringify(updatedLogs));
      
      // Flash active alert count indicator
      setActiveAlertsCount((prev) => prev + triggeredLogs.length);
    }
  }, [allStates]);

  // ─── Global Signal Stream & Alerts ───
  const prevSignalsRef = useRef<Map<string, { direction: string; isGated: boolean; compositeScore: number }>>(new Map());
  const isInitialRef = useRef(true);

  const { data: signals, refetch } = trpc.signal.latest.useQuery(
    { limit: 50 },
    { staleTime: 0 }
  );

  // Subscribe to signal stream via WebSockets
  trpc.signal.stream.useSubscription(undefined, {
    onData: () => {
      refetch();
    },
  });

  useEffect(() => {
    if (!signals || !Array.isArray(signals)) return;

    if (isInitialRef.current) {
      // Quietly populate on mount to prevent toast alert spam on first load
      for (const sig of signals) {
        prevSignalsRef.current.set(sig.symbol, {
          direction: sig.direction,
          isGated: sig.isGated,
          compositeScore: parseFloat(sig.compositeScore || "0"),
        });
      }
      isInitialRef.current = false;
      return;
    }

    // Compare updates
    for (const sig of signals) {
      const prev = prevSignalsRef.current.get(sig.symbol);
      const compositeScore = parseFloat(sig.compositeScore || "0");
      const cleanSymbol = sig.symbol.replace("B-", "").replace("_", "");

      if (prev) {
        // 1. Check Direction Flip
        if (prev.direction !== sig.direction) {
          if (sig.direction === "long") {
            toast.success(`${cleanSymbol} Signal BULLISH 🚀`, {
              description: `Score: ${compositeScore.toFixed(1)}. Trend turned bullish (was ${prev.direction.toUpperCase()}).`,
              duration: 5000,
            });
            sendTelegramAlert.mutate({
              message: `🟢 <b>Janus Trend Alert: ${cleanSymbol}</b>\n\nTrend turned <b>BULLISH 🚀</b> (Score: ${compositeScore.toFixed(1)}, was ${prev.direction.toUpperCase()})`,
            });
          } else if (sig.direction === "short") {
            toast.error(`${cleanSymbol} Signal BEARISH 📉`, {
              description: `Score: ${compositeScore.toFixed(1)}. Trend turned bearish (was ${prev.direction.toUpperCase()}).`,
              duration: 5000,
            });
            sendTelegramAlert.mutate({
              message: `🔴 <b>Janus Trend Alert: ${cleanSymbol}</b>\n\nTrend turned <b>BEARISH 📉</b> (Score: ${compositeScore.toFixed(1)}, was ${prev.direction.toUpperCase()})`,
            });
          } else {
            toast.info(`${cleanSymbol} Signal NEUTRAL ⚖️`, {
              description: `Score: ${compositeScore.toFixed(1)}. Trend returned to neutral (was ${prev.direction.toUpperCase()}).`,
              duration: 4000,
            });
            sendTelegramAlert.mutate({
              message: `⚪ <b>Janus Trend Alert: ${cleanSymbol}</b>\n\nTrend returned to <b>NEUTRAL ⚖️</b> (Score: ${compositeScore.toFixed(1)}, was ${prev.direction.toUpperCase()})`,
            });
          }
        }
        // 2. Check Gate status change
        else if (prev.isGated !== sig.isGated) {
          if (!sig.isGated) {
            toast.success(`${cleanSymbol} Signal UNLOCKED 🔓`, {
              description: `Composite Score: ${compositeScore.toFixed(1)} crossed 75-point gate threshold.`,
              duration: 5000,
            });
            sendTelegramAlert.mutate({
              message: `🔓 <b>Janus Signal Alert: ${cleanSymbol}</b>\n\nSignal crossed the 75-point gate threshold! Composite score: <b>${compositeScore.toFixed(1)}</b>`,
            });
          } else {
            toast.warning(`${cleanSymbol} Signal GATED 🔒`, {
              description: `Composite Score: ${compositeScore.toFixed(1)} fell below threshold.`,
              duration: 4000,
            });
            sendTelegramAlert.mutate({
              message: `🔒 <b>Janus Signal Alert: ${cleanSymbol}</b>\n\nSignal fell below the gate threshold. Composite score: <b>${compositeScore.toFixed(1)}</b>`,
            });
          }
        }
      }

      // Update state ref
      prevSignalsRef.current.set(sig.symbol, {
        direction: sig.direction,
        isGated: sig.isGated,
        compositeScore,
      });
    }
  }, [signals]);

  return (
    <div className="flex h-screen w-screen bg-[#09090b] text-[#f4f4f5] overflow-hidden">
      {/* Sidebar */}
      <aside className="w-16 flex-shrink-0 flex flex-col items-center py-4 border-r border-[#27272a] bg-[#09090b]">
        {/* Logo */}
        <div className="mb-6">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#22c55e] to-[#16a34a] flex items-center justify-center">
            <span className="text-white font-bold text-sm">J</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 flex flex-col items-center gap-2">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            const Icon = item.icon;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-200 group relative",
                  isActive
                    ? "bg-[#22c55e]/10 text-[#22c55e]"
                    : "text-[#71717a] hover:text-[#f4f4f5] hover:bg-[#18181b]"
                )}
              >
                <Icon size={20} />
                {/* Tooltip */}
                <div className="absolute left-12 bg-[#18181b] text-[#f4f4f5] text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 border border-[#27272a]">
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Bottom Actions */}
        <div className="flex flex-col items-center gap-2 mt-auto">
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-[#71717a] hover:text-[#f4f4f5] hover:bg-[#18181b] transition-all relative group"
          >
            <Settings size={18} />
            <div className="absolute left-12 bg-[#18181b] text-[#f4f4f5] text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 border border-[#27272a]">
              Settings
            </div>
          </button>
          <button className="w-10 h-10 rounded-lg flex items-center justify-center text-[#71717a] hover:text-[#f4f4f5] hover:bg-[#18181b] transition-all">
            <Search size={18} />
          </button>
          {user && (
            <button
              onClick={logout}
              className="w-10 h-10 rounded-lg flex items-center justify-center text-[#71717a] hover:text-[#ef4444] hover:bg-[#18181b] transition-all"
            >
              <LogOut size={18} />
            </button>
          )}
          {user?.avatar ? (
            <img
              src={user.avatar}
              alt=""
              className="w-8 h-8 rounded-full border border-[#27272a]"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-[#18181b] border border-[#27272a] flex items-center justify-center text-xs text-[#71717a]">
              {user?.name?.[0]?.toUpperCase() || "U"}
            </div>
          )}
        </div>
      </aside>

      {/* Settings Modal */}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

      {/* Alerts Modal */}
      <AlertsModal isOpen={isAlertsOpen} onClose={() => {
        setIsAlertsOpen(false);
        setActiveAlertsCount(0);
      }} />

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="h-12 flex-shrink-0 flex items-center justify-between px-4 border-b border-[#27272a] bg-[#09090b]">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-semibold tracking-wider text-[#f4f4f5]">
              JANUS
            </h1>
            <div className="h-4 w-px bg-[#27272a]" />
            <div className="flex items-center gap-2 text-xs text-[#71717a]">
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
                Binance Feed
              </span>
              <ChevronRight size={12} />
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#3b82f6] animate-pulse" />
                CoinDCX Exec
              </span>
              <ChevronRight size={12} />
              <span className="flex items-center gap-1 text-[#22c55e]">
                <Activity size={12} />
                Live
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-[#71717a]">
            {/* Custom Alerts Bell Button */}
            <button
              onClick={() => {
                setIsAlertsOpen(true);
                setActiveAlertsCount(0);
              }}
              className="relative p-1.5 rounded hover:bg-[#18181b] hover:text-[#f4f4f5] border border-transparent hover:border-[#27272a] transition-all flex items-center justify-center"
              title="Manage Alert Rules"
            >
              <Bell size={14} className={cn(activeAlertsCount > 0 ? "text-[#f59e0b] animate-bounce" : "text-[#71717a]")} />
              {activeAlertsCount > 0 && (
                <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-[#ef4444] text-[8px] text-white font-black rounded-full flex items-center justify-center border border-[#09090b] scale-95 shadow">
                  {activeAlertsCount}
                </span>
              )}
            </button>

            {user?.name && (
              <span className="text-[#a1a1aa]">{user.name}</span>
            )}
            <span className="px-2 py-0.5 rounded bg-[#18181b] border border-[#27272a]">
              v1.0.0
            </span>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-auto scrollbar-thin">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
