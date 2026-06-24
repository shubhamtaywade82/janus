export const AST_COLORS = {
  bg: "#080a0e",
  panel: "#0d1018",
  panel2: "#111520",
  border: "#1a2035",
  border2: "#222840",
  accent: "#00d4aa",
  red: "#ff4757",
  purple: "#a855f7",
  yellow: "#fbbf24",
  blue: "#38bdf8",
  text: "#dde3f0",
  sub: "#5a6480",
  label: "#8899bb",
  grid: "#0f1420",
  // legacy aliases
  gridLine: "#0f1420",
  muted: "#5a6480",
  warn: "#fbbf24",
} as const;

export const navBtnStyle = {
  padding: "3px 9px",
  borderRadius: 5,
  border: `1px solid ${AST_COLORS.border2}`,
  background: "transparent",
  color: AST_COLORS.sub,
  fontSize: 11,
  cursor: "pointer",
} as const;
