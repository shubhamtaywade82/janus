import { Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { THEMES, useTheme } from "@/providers/theme";
import type { ThemeId } from "@/providers/theme";

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="grid grid-cols-2 gap-2">
      {THEMES.map((t) => {
        const active = theme === t.id;
        return (
          <button
            key={t.id}
            onClick={() => setTheme(t.id as ThemeId)}
            className={cn(
              "flex flex-col gap-2 p-3 rounded-lg border text-left transition-colors",
              active
                ? "border-[#3b82f6] bg-[#3b82f6]/10"
                : "border-[#27272a] bg-[#18181b] hover:border-[#3f3f46]"
            )}
          >
            {/* Color swatches */}
            <div className="flex items-center gap-1.5">
              <span
                className="w-4 h-4 rounded-full border border-white/10 flex-shrink-0"
                style={{ background: t.upColor }}
              />
              <span
                className="w-4 h-4 rounded-full border border-white/10 flex-shrink-0"
                style={{ background: t.downColor }}
              />
              {t.colorblindSafe && (
                <span className="ml-auto flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#f59e0b]/15 text-[#f59e0b] border border-[#f59e0b]/30">
                  <Eye size={8} />
                  CB
                </span>
              )}
            </div>

            {/* Name + description */}
            <div>
              <div className={cn("text-[11px] font-semibold", active ? "text-[#f4f4f5]" : "text-[#a1a1aa]")}>
                {t.name}
              </div>
              <div className="text-[9px] text-[#52525b] leading-tight mt-0.5">
                {t.description}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
