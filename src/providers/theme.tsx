import { createContext, useContext, useEffect, useState } from "react";

// ─── Theme registry ────────────────────────────────────────────────────────────

export type ThemeId =
  | "dark"
  | "dark-binance"
  | "colorblind-deu"
  | "colorblind-pro";

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  description: string;
  colorblindSafe: boolean;
  upColor: string;   // hex swatch for preview
  downColor: string;
}

export const THEMES: ThemeMeta[] = [
  {
    id: "dark",
    name: "Default Dark",
    description: "Standard dark trading theme",
    colorblindSafe: false,
    upColor: "#22c55e",
    downColor: "#ef4444",
  },
  {
    id: "dark-binance",
    name: "Binance Dark",
    description: "High-contrast Binance-style colors",
    colorblindSafe: false,
    upColor: "#0ecb81",
    downColor: "#f6465d",
  },
  {
    id: "colorblind-deu",
    name: "Deuteranopia",
    description: "Blue / Orange — safe for red-green colorblindness",
    colorblindSafe: true,
    upColor: "#3b82f6",
    downColor: "#f97316",
  },
  {
    id: "colorblind-pro",
    name: "Protanopia",
    description: "Blue / Gold — safe for red-green colorblindness",
    colorblindSafe: true,
    upColor: "#2563eb",
    downColor: "#d97706",
  },
];

// ─── Context ───────────────────────────────────────────────────────────────────

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (id: ThemeId) => void;
  meta: ThemeMeta;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "janus_theme";
const DEFAULT: ThemeId = "dark";

function applyTheme(id: ThemeId) {
  if (id === "dark") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", id);
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
    return stored && THEMES.some((t) => t.id === stored) ? stored : DEFAULT;
  });

  // Apply on mount and whenever theme changes
  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const setTheme = (id: ThemeId) => setThemeState(id);
  const meta = THEMES.find((t) => t.id === theme)!;

  return (
    <ThemeContext.Provider value={{ theme, setTheme, meta }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
