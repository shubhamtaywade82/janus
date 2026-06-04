import { useState } from "react";
import { trpc } from "@/providers/trpc";
import {
  ScrollText,
  Info,
  AlertTriangle,
  AlertCircle,
  Skull,
  Bug,
  RefreshCw,
  Cpu,
  Wifi,
  Shield,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";

const levelConfig = {
  info: { icon: Info, color: "#3b82f6", bg: "bg-[#3b82f6]/10" },
  warn: { icon: AlertTriangle, color: "#f59e0b", bg: "bg-[#f59e0b]/10" },
  error: { icon: AlertCircle, color: "hsl(var(--janus-down))", bg: "bg-j-down/10" },
  critical: { icon: Skull, color: "hsl(var(--janus-down))", bg: "bg-j-down/10" },
  debug: { icon: Bug, color: "#71717a", bg: "bg-[#71717a]/10" },
};

const componentIcons: Record<string, React.ElementType> = {
  "binance-ingestor": Wifi,
  "confluence-engine": Activity,
  "coindcx-client": Shield,
  "trade-executor": Cpu,
  default: Cpu,
};

// ─── Log Entry Row ───
const LogRow = ({ log }: { log: any }) => {
  const config = levelConfig[log.level as keyof typeof levelConfig] || levelConfig.info;
  const Icon = config.icon;
  const CompIcon = componentIcons[log.component] || componentIcons.default;

  return (
    <tr className="border-b border-[#27272a]/50 hover:bg-[#18181b] transition-colors">
      <td className="px-3 py-2">
        <div className={cn("flex items-center gap-1.5 px-1.5 py-0.5 rounded w-fit", config.bg)}>
          <Icon size={10} style={{ color: config.color }} />
          <span className="text-[10px] font-medium" style={{ color: config.color }}>
            {log.level.toUpperCase()}
          </span>
        </div>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <CompIcon size={12} className="text-[#71717a]" />
          <span className="text-xs text-[#a1a1aa]">{log.component}</span>
        </div>
      </td>
      <td className="px-3 py-2 text-xs text-[#f4f4f5]">{log.event}</td>
      <td className="px-3 py-2 text-xs text-[#a1a1aa] max-w-md truncate">{log.message}</td>
      <td className="px-3 py-2 text-[10px] text-[#52525b] tabular-nums">
        {new Date(log.createdAt).toLocaleTimeString()}
      </td>
    </tr>
  );
}

// ─── Main Logs Page ───
const Logs = () => {
  const [levelFilter, setLevelFilter] = useState<string>("");
  const [componentFilter, setComponentFilter] = useState<string>("");

  const { data: logs, isLoading, refetch } = trpc.logs.list.useQuery(
    {
      level: levelFilter as any || undefined,
      component: componentFilter || undefined,
      limit: 200,
    },
    { refetchInterval: 5000 }
  );

  const { data: stats } = trpc.logs.stats.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const levels = ["info", "warn", "error", "critical", "debug"] as const;

  return (
    <div className="flex flex-col h-full p-4 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ScrollText size={18} className="text-[#a1a1aa]" />
          <div>
            <h2 className="text-sm font-semibold text-[#f4f4f5]">System Logs</h2>
            <p className="text-[10px] text-[#71717a]">Audit trail and compliance logging</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
            className="bg-[#18181b] border border-[#27272a] rounded px-2 py-1 text-xs text-[#f4f4f5] outline-none"
          >
            <option value="">All Levels</option>
            {levels.map((l) => (
              <option key={l} value={l}>{l.toUpperCase()}</option>
            ))}
          </select>
          <select
            value={componentFilter}
            onChange={(e) => setComponentFilter(e.target.value)}
            className="bg-[#18181b] border border-[#27272a] rounded px-2 py-1 text-xs text-[#f4f4f5] outline-none"
          >
            <option value="">All Components</option>
            {Object.keys(componentIcons).filter(k => k !== "default").map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1 px-3 py-1.5 rounded bg-[#18181b] text-[#71717a] text-xs hover:text-[#f4f4f5] transition-colors border border-[#27272a]"
          >
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-6 gap-3">
          <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-3">
            <div className="text-[10px] text-[#71717a] mb-1">Total Logs</div>
            <div className="text-lg font-bold text-[#f4f4f5] tabular-nums">{stats.total}</div>
          </div>
          {levels.map((level) => {
            const config = levelConfig[level];
            const Icon = config.icon;
            return (
              <div key={level} className="bg-[#18181b] border border-[#27272a] rounded-lg p-3">
                <div className="flex items-center gap-1 mb-1">
                  <Icon size={10} style={{ color: config.color }} />
                  <span className="text-[10px] text-[#71717a] capitalize">{level}</span>
                </div>
                <div className="text-lg font-bold tabular-nums" style={{ color: config.color }}>
                  {stats.byLevel[level] || 0}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Recent Errors */}
      {stats && stats.recentErrors.length > 0 && (
        <div className="bg-j-down/5 border border-j-down/20 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle size={14} className="text-j-down" />
            <span className="text-xs font-semibold text-j-down">Recent Errors</span>
          </div>
          <div className="space-y-1">
            {stats.recentErrors.map((err: any) => (
              <div key={err.id} className="flex items-center gap-2 text-xs">
                <span className="text-[#52525b] tabular-nums">
                  {new Date(err.createdAt).toLocaleTimeString()}
                </span>
                <span className="text-[#a1a1aa]">[{err.component}]</span>
                <span className="text-[#f4f4f5]">{err.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Logs Table */}
      <div className="flex-1 bg-[#18181b] border border-[#27272a] rounded-lg overflow-hidden flex flex-col">
        <div className="px-4 py-2 border-b border-[#27272a] flex items-center justify-between">
          <span className="text-xs font-semibold text-[#f4f4f5]">Log Entries</span>
          <span className="text-[10px] text-[#71717a]">{logs?.length || 0} entries</span>
        </div>
        <div className="flex-1 overflow-auto scrollbar-thin">
          <table className="w-full">
            <thead className="sticky top-0 bg-[#18181b]">
              <tr className="border-b border-[#27272a]">
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">Level</th>
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">Component</th>
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">Event</th>
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">Message</th>
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {logs?.map((log) => (
                <LogRow key={log.id} log={log} />
              ))}
              {isLoading && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center">
                    <RefreshCw size={16} className="animate-spin mx-auto text-[#71717a]" />
                  </td>
                </tr>
              )}
              {!isLoading && (!logs || logs.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-xs text-[#71717a]">
                    <ScrollText size={20} className="mx-auto mb-2 opacity-30" />
                    No logs found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Logs;
