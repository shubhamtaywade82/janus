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
  Brain,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import SettingsModal from "./SettingsModal";
import AlertsModal from "./AlertsModal";
import { playAlertChime } from "@/lib/alert-sound";

const navItems = [
  { path: "/", label: "Dashboard", icon: TrendingUp },
  { path: "/signals", label: "Signals", icon: Signal },
  { path: "/ai-analysis", label: "AI Analysis", icon: Brain },
  { path: "/brain", label: "Brain", icon: Zap },
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

  // ─── Backend user-alert stream → in-browser toast + badge ───
  // Alert evaluation and Telegram delivery happen on the backend (AlertEngine).
  // The frontend only receives the already-fired event for display purposes.
  const userAlertStreamOpts = useRef({
    onData: (event: { symbol: string; type: string; message: string }) => {
      playAlertChime();
      const sym = event.symbol.replace("B-", "").replace("_", "");
      toast.warning(`Alert: ${sym} 🔔`, {
        description: event.message,
        duration: 6000,
      });
      setActiveAlertsCount((prev) => prev + 1);
    },
  });
  trpc.alerts.userAlertStream.useSubscription(undefined, userAlertStreamOpts.current);

  // ─── Backend system-alert stream → in-browser toast + badge ───
  // These are the SAME transitions the bot/strategy reasons about (BOS, CHoCH,
  // KNN bias flip, SuperTrend flip, rejection, etc.) — emitted by the backend
  // analysis loop regardless of bot state. Source of truth for "what the bot sees".
  const SYSTEM_ALERT_EMOJI: Record<string, string> = {
    bos: "⬆️", choch: "🔄", knn_bias_flip: "🤖", supertrend_flip: "⚡",
    direction_flip: "↔️", gated_flip: "🎯", knn_rejection: "🛑",
    ema_cross: "📈", rsi_extreme: "⚠️",
  };
  const systemAlertStreamOpts = useRef({
    onData: (event: { symbol: string; type: string; direction: string | null; message: string }) => {
      playAlertChime();
      const sym = event.symbol.replace("B-", "").replace("_", "");
      const emoji = SYSTEM_ALERT_EMOJI[event.type] ?? "📡";
      const title = `${emoji} ${sym} · ${event.type.replace(/_/g, " ").toUpperCase()}`;
      const fn = event.direction === "bullish" ? toast.success
        : event.direction === "bearish" ? toast.error : toast.info;
      fn(title, { description: event.message, duration: 6000 });
      setActiveAlertsCount((prev) => prev + 1);
    },
  });
  trpc.alerts.systemAlertStream.useSubscription(undefined, systemAlertStreamOpts.current);

  // ─── Global Signal Stream — direction / gate flip toasts (UI only) ───
  const prevSignalsRef = useRef<Map<string, { direction: string; isGated: boolean; compositeScore: number }>>(new Map());
  const isInitialRef = useRef(true);

  const { data: signals, refetch } = trpc.signal.latest.useQuery(
    { limit: 50 },
    { staleTime: 0 }
  );

  const onDataRef = useRef<() => void>(() => {});
  useEffect(() => {
    onDataRef.current = () => {
      refetch();
    };
  }, [refetch]);

  const streamOpts = useRef({
    onData: () => onDataRef.current(),
  });

  // Subscribe to signal stream via WebSockets
  trpc.signal.stream.useSubscription(undefined, streamOpts.current);

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

    // Show in-browser toasts on state transitions
    // (Telegram delivery for these events is handled by the backend AlertEngine)
    for (const sig of signals) {
      const prev = prevSignalsRef.current.get(sig.symbol);
      const compositeScore = parseFloat(sig.compositeScore || "0");
      const cleanSymbol = sig.symbol.replace("B-", "").replace("_", "");

      if (prev) {
        if (prev.direction !== sig.direction) {
          if (sig.direction === "long") {
            toast.success(`${cleanSymbol} Signal BULLISH 🚀`, {
              description: `Score: ${compositeScore.toFixed(1)}. Trend turned bullish (was ${prev.direction.toUpperCase()}).`,
              duration: 5000,
            });
          } else if (sig.direction === "short") {
            toast.error(`${cleanSymbol} Signal BEARISH 📉`, {
              description: `Score: ${compositeScore.toFixed(1)}. Trend turned bearish (was ${prev.direction.toUpperCase()}).`,
              duration: 5000,
            });
          } else {
            toast.info(`${cleanSymbol} Signal NEUTRAL ⚖️`, {
              description: `Score: ${compositeScore.toFixed(1)}. Trend returned to neutral (was ${prev.direction.toUpperCase()}).`,
              duration: 4000,
            });
          }
        } else if (prev.isGated !== sig.isGated) {
          if (!sig.isGated) {
            toast.success(`${cleanSymbol} Signal UNLOCKED 🔓`, {
              description: `Composite Score: ${compositeScore.toFixed(1)} crossed 75-point gate threshold.`,
              duration: 5000,
            });
          } else {
            toast.warning(`${cleanSymbol} Signal GATED 🔒`, {
              description: `Composite Score: ${compositeScore.toFixed(1)} fell below threshold.`,
              duration: 4000,
            });
          }
        }
      }

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
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-j-up to-j-up/70 flex items-center justify-center">
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
                    ? "bg-j-up/10 text-j-up"
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
              className="w-10 h-10 rounded-lg flex items-center justify-center text-[#71717a] hover:text-j-down hover:bg-[#18181b] transition-all"
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
                <span className="w-1.5 h-1.5 rounded-full bg-j-up animate-pulse" />
                Binance Feed
              </span>
              <ChevronRight size={12} />
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#3b82f6] animate-pulse" />
                CoinDCX Exec
              </span>
              <ChevronRight size={12} />
              <span className="flex items-center gap-1 text-j-up">
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
                <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-j-down text-[8px] text-white font-black rounded-full flex items-center justify-center border border-[#09090b] scale-95 shadow">
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
