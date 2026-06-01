import { Link, useLocation } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import {
  TrendingUp,
  Wallet,
  Search,
  LogOut,
  Activity,
  Signal,
  ScrollText,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { path: "/", label: "Dashboard", icon: TrendingUp },
  { path: "/signals", label: "Signals", icon: Signal },
  { path: "/portfolio", label: "Portfolio", icon: Wallet },
  { path: "/logs", label: "Logs", icon: ScrollText },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { user, logout } = useAuth();

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
}
