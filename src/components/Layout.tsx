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
  ChevronLeft,
  Settings,
  Shield,
  Bell,
  Brain,
  Zap,
  LineChart,
} from "lucide-react";
import { cn } from "@/lib/utils";
import SettingsModal from "./SettingsModal";
import AlertsModal from "./AlertsModal";
import { playAlertChime } from "@/lib/alert-sound";

const navItems = [
  { path: "/", label: "Dashboard", icon: TrendingUp },
  { path: "/signals", label: "Signals", icon: Signal },
  { path: "/adaptive-st", label: "Adaptive ST", icon: LineChart },
  { path: "/surveillance", label: "Surveillance", icon: Activity },
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
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("janus_sidebar_collapsed");
      return saved === null ? true : saved === "true";
    }
    return true;
  });

  const toggleSidebar = () => {
    setIsCollapsed((prev) => {
      const newVal = !prev;
      localStorage.setItem("janus_sidebar_collapsed", String(newVal));
      return newVal;
    });
  };

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
      <aside className={cn(
        "flex-shrink-0 flex flex-col py-4 border-r border-white/[0.06] bg-[#09090b] relative z-20 transition-all duration-300 ease-in-out",
        isCollapsed ? "w-16 items-center" : "w-52 px-4"
      )}>
        {/* Logo */}
        <div className={cn("mb-6 flex items-center gap-3 w-full", isCollapsed ? "justify-center" : "px-2")}>
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-j-up to-j-up/70 flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-sm">J</span>
          </div>
          {!isCollapsed && (
            <span className="text-sm font-black tracking-wider bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent transition-all">
              JANUS
            </span>
          )}
        </div>

        {/* Navigation */}
        <nav className={cn("flex-1 flex flex-col gap-2 w-full", isCollapsed ? "items-center" : "items-stretch")}>
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            const Icon = item.icon;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "rounded-lg flex items-center transition-all duration-200 group relative",
                  isCollapsed ? "w-10 h-10 justify-center" : "w-full px-3 py-2 gap-3",
                  isActive
                    ? "bg-j-up/10 text-j-up shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]"
                    : "text-[#71717a] hover:text-[#f4f4f5] hover:bg-[#18181b]"
                )}
              >
                {isActive && (
                  <span className={cn(
                    "absolute w-[3px] rounded-r-full bg-j-up shadow-[0_0_8px_rgba(34,197,94,0.5)]",
                    isCollapsed ? "-left-3 top-2 bottom-2" : "-left-4 top-2 bottom-2"
                  )} />
                )}
                <Icon size={20} className="flex-shrink-0" />
                {!isCollapsed && (
                  <span className="text-xs font-semibold whitespace-nowrap">{item.label}</span>
                )}
                {/* Tooltip */}
                {isCollapsed && (
                  <div className="absolute left-12 bg-[#18181b] text-[#f4f4f5] text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 border border-[#27272a]">
                    {item.label}
                  </div>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Bottom Actions */}
        <div className={cn("flex flex-col gap-2 mt-auto w-full", isCollapsed ? "items-center" : "items-stretch")}>
          {/* Collapse/Expand Toggle Button */}
          <button
            onClick={toggleSidebar}
            className={cn(
              "rounded-lg flex items-center text-[#71717a] hover:text-[#f4f4f5] hover:bg-[#18181b] transition-all relative group",
              isCollapsed ? "w-10 h-10 justify-center" : "w-full px-3 py-2 gap-3"
            )}
            title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          >
            {isCollapsed ? (
              <ChevronRight size={18} />
            ) : (
              <>
                <ChevronLeft size={18} className="flex-shrink-0" />
                <span className="text-xs font-semibold">Collapse</span>
              </>
            )}
            {isCollapsed && (
              <div className="absolute left-12 bg-[#18181b] text-[#f4f4f5] text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 border border-[#27272a]">
                Expand Sidebar
              </div>
            )}
          </button>

          <button
            onClick={() => setIsSettingsOpen(true)}
            className={cn(
              "rounded-lg flex items-center text-[#71717a] hover:text-[#f4f4f5] hover:bg-[#18181b] transition-all relative group",
              isCollapsed ? "w-10 h-10 justify-center" : "w-full px-3 py-2 gap-3"
            )}
          >
            <Settings size={18} className="flex-shrink-0" />
            {!isCollapsed && (
              <span className="text-xs font-semibold">Settings</span>
            )}
            {isCollapsed && (
              <div className="absolute left-12 bg-[#18181b] text-[#f4f4f5] text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 border border-[#27272a]">
                Settings
              </div>
            )}
          </button>

          <button
            className={cn(
              "rounded-lg flex items-center text-[#71717a] hover:text-[#f4f4f5] hover:bg-[#18181b] transition-all relative group",
              isCollapsed ? "w-10 h-10 justify-center" : "w-full px-3 py-2 gap-3"
            )}
          >
            <Search size={18} className="flex-shrink-0" />
            {!isCollapsed && (
              <span className="text-xs font-semibold">Search</span>
            )}
            {isCollapsed && (
              <div className="absolute left-12 bg-[#18181b] text-[#f4f4f5] text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 border border-[#27272a]">
                Search
              </div>
            )}
          </button>

          {user && (
            <button
              onClick={logout}
              className={cn(
                "rounded-lg flex items-center text-[#71717a] hover:text-j-down hover:bg-[#18181b] transition-all relative group",
                isCollapsed ? "w-10 h-10 justify-center" : "w-full px-3 py-2 gap-3"
              )}
            >
              <LogOut size={18} className="flex-shrink-0" />
              {!isCollapsed && (
                <span className="text-xs font-semibold">Logout</span>
              )}
              {isCollapsed && (
                <div className="absolute left-12 bg-[#18181b] text-[#f4f4f5] text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 border border-[#27272a]">
                  Logout
                </div>
              )}
            </button>
          )}

          <div className={cn("flex items-center gap-3", isCollapsed ? "justify-center mt-2" : "px-2 py-1 mt-2 border-t border-white/[0.04] pt-3")}>
            {user?.avatar ? (
              <img
                src={user.avatar}
                alt=""
                className="w-8 h-8 rounded-full border border-white/[0.06] flex-shrink-0"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-[#18181b] border border-white/[0.06] flex items-center justify-center text-xs text-[#71717a] flex-shrink-0 font-bold">
                {user?.name?.[0]?.toUpperCase() || "U"}
              </div>
            )}
            {!isCollapsed && (
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-bold text-zinc-300 truncate">{user?.name || "User"}</span>
                <span className="text-[9px] text-[#71717a] truncate font-medium">Administrator</span>
              </div>
            )}
          </div>
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
        <header className="h-12 flex-shrink-0 flex items-center justify-between px-4 border-b border-white/[0.06] bg-[#09090b]/80 backdrop-blur-md relative z-10">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-semibold tracking-wider text-[#f4f4f5] bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
              JANUS
            </h1>
            <div className="h-4 w-px bg-white/[0.06]" />
            <div className="flex items-center gap-1.5 text-[10px]">
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800/80 text-zinc-300 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-j-up animate-pulse" />
                Binance Feed
              </span>
              <ChevronRight size={10} className="text-zinc-600" />
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800/80 text-zinc-300 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-[#3b82f6] animate-pulse" />
                CoinDCX Exec
              </span>
              <ChevronRight size={10} className="text-zinc-600" />
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-j-up/10 border border-j-up/20 text-j-up font-bold">
                <Activity size={11} className="animate-pulse" />
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
