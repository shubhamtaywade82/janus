import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { ShieldAlert, ShieldCheck } from "lucide-react";

export function KillSwitchButton() {
  const [confirming, setConfirming] = useState(false);

  const { data: status, refetch } = trpc.autoExecutor.killSwitchStatus.useQuery(undefined, {
    refetchInterval: 5_000,
  });

  const killSwitch = trpc.autoExecutor.killSwitch.useMutation({
    onSuccess: () => {
      refetch();
      setConfirming(false);
    },
    onError: (err) => toast.error("Kill switch error", { description: err.message }),
  });

  trpc.autoExecutor.killSwitchStream.useSubscription(undefined, {
    onData: (event: unknown) => {
      const e = event as { event: string; state?: { reason: string } };
      if (e.event === "triggered") {
        toast.error(`⛔ Kill switch triggered: ${e.state?.reason}`, { duration: 0 });
      } else {
        toast.success("✅ Kill switch reset — trading resumed");
      }
      refetch();
    },
  });

  const isActive = status?.isActive ?? false;

  if (isActive) {
    return (
      <button
        onClick={() => killSwitch.mutate({ action: "reset", reason: "" })}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold bg-j-down/10 text-j-down border border-j-down/40 animate-pulse hover:bg-j-down/20 transition-colors"
      >
        <ShieldAlert size={11} />
        <span>HALTED — Reset</span>
      </button>
    );
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-[9px] text-[#f59e0b]">Confirm stop?</span>
        <button
          onClick={() => killSwitch.mutate({ action: "trigger", reason: "Manual emergency stop" })}
          className="px-2 py-0.5 rounded text-[9px] font-semibold bg-j-down text-white hover:bg-j-down"
        >
          Yes
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="px-2 py-0.5 rounded text-[9px] bg-[#27272a] text-[#71717a] hover:text-[#f4f4f5]"
        >
          No
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-[#71717a] border border-[#27272a] hover:text-j-down hover:border-j-down/40 transition-colors"
    >
      <ShieldCheck size={11} />
      <span>Stop</span>
    </button>
  );
}
