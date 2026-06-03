# Janus Theme System

## Status

### Infrastructure ✅
- [x] CSS vars + theme blocks in `src/index.css`
- [x] Tailwind tokens (`j-up`, `j-down`, etc.) in `tailwind.config.js`
- [x] `ThemeProvider` + `useTheme` in `src/providers/theme.tsx`
- [x] `ThemeSwitcher` component in `src/components/ThemeSwitcher.tsx`
- [x] `ThemeProvider` wired into `src/main.tsx`
- [x] Appearance section added to `SettingsModal.tsx`

### Migration — per file

| File | Instances | Status |
|---|---|---|
| `src/pages/Dashboard.tsx` | ~150 | ⬜ pending |
| `src/pages/Portfolio.tsx` | ~130 | ⬜ pending |
| `src/pages/Signals.tsx` | ~107 | ⬜ pending |
| `src/pages/RiskMetrics.tsx` | ~100 | ⬜ pending |
| `src/pages/Logs.tsx` | ~39 | ⬜ pending |
| `src/components/Layout.tsx` | ~23 | ⬜ pending |
| `src/components/AutoTraderPanel.tsx` | ~59 | ⬜ pending |
| `src/components/AlertsModal.tsx` | ~45 | ⬜ pending |
| `src/components/PerformanceDashboard.tsx` | ~40 | ⬜ pending |
| `src/components/SettingsModal.tsx` | ~26 | ⬜ pending |
| `src/components/AlertConfigPanel.tsx` | ~15 | ⬜ pending |
| `src/components/IndicatorPanel.tsx` | ~20 | ⬜ pending |
| `src/components/RiskStatus.tsx` | ~18 | ⬜ pending |
| `src/components/ChartOverlayPanel.tsx` | ~9 | ⬜ pending |
| `src/components/LlmActivityFeed.tsx` | ~14 | ⬜ pending |
| `src/components/RegimeIndicator.tsx` | ~9 | ⬜ pending |
| `src/components/KillSwitchButton.tsx` | ~5 | ⬜ pending |

---

## Themes

| ID | Name | Up | Down | Colorblind-safe |
|---|---|---|---|---|
| `dark` (default) | Default Dark | `#22c55e` | `#ef4444` | No |
| `dark-binance` | Binance Dark | `#0ecb81` | `#f6465d` | No |
| `colorblind-deu` | Deuteranopia | `#3b82f6` | `#f97316` | Yes |
| `colorblind-pro` | Protanopia | `#2563eb` | `#d97706` | Yes |

---

## Token Reference

### Direction (change per theme — migrate these first)

| Old hex | Old usage | New Tailwind class | CSS var |
|---|---|---|---|
| `#22c55e` | green-500, profit/bull | `text-j-up` / `bg-j-up/10` | `--janus-up` |
| `#0ecb81` | Binance green, price up | `text-j-up-bright` | `--janus-up-bright` |
| `#16a34a` | darker green (accent) | `text-j-up` (close enough) | `--janus-up` |
| `#ef4444` | red-500, loss/bear | `text-j-down` / `bg-j-down/10` | `--janus-down` |
| `#f6465d` | Binance red, price down | `text-j-down-bright` | `--janus-down-bright` |
| `#dc2626` | darker red (accent) | `text-j-down` | `--janus-down` |

### Accents (constant across themes — lower priority to migrate)

| Old hex | Old usage | New class | CSS var |
|---|---|---|---|
| `#3b82f6` | blue, info | `text-j-info` | `--janus-info` |
| `#f59e0b` | amber, paper/warn | `text-j-warn` | `--janus-warn` |
| `#d97706` | darker amber | `text-j-warn` | `--janus-warn` |
| `#a855f7` | purple, RSI | `text-j-purple` | `--janus-purple` |

### Surfaces (constant across dark themes — migrate if light theme is added)

| Old hex | Old usage | New class | CSS var |
|---|---|---|---|
| `#09090b` | page bg | `bg-j-app` | `--janus-app` |
| `#18181b` | card/panel | `bg-j-surface` | `--janus-surface` |
| `#1c1c1f` | elevated surface | `bg-j-surface-2` | `--janus-surface-2` |
| `#27272a` | border | `border-j-border` | `--janus-border` |
| `#3f3f46` | subtle border | `border-j-border-muted` | `--janus-border-muted` |

### Text (constant across dark themes)

| Old hex | Old usage | New class | CSS var |
|---|---|---|---|
| `#f4f4f5` | primary text | `text-j-text` | `--janus-text` |
| `#a1a1aa` | secondary text | `text-j-text-2` | `--janus-text-2` |
| `#71717a` | muted text | `text-j-text-3` | `--janus-text-3` |
| `#52525b` | dim text | `text-j-text-4` | `--janus-text-4` |

---

## Migration Guide

Migrate one file at a time. Focus on **direction colors first** (`up`/`down`) — these are what colorblind users need. Surfaces and text can be migrated later.

### Find patterns to replace

```bash
# Find all up-color instances in a file
grep -n "#22c55e\|#0ecb81\|#16a34a" src/pages/Dashboard.tsx

# Find all down-color instances
grep -n "#ef4444\|#f6465d\|#dc2626" src/pages/Dashboard.tsx
```

### Example replacement

Before:
```tsx
<span className="text-[#22c55e]">+{pnl}</span>
<span className="bg-[#22c55e]/10 text-[#22c55e]">LONG</span>
<span className="border-[#ef4444] text-[#ef4444]">SHORT</span>
```

After:
```tsx
<span className="text-j-up">+{pnl}</span>
<span className="bg-j-up/10 text-j-up">LONG</span>
<span className="border-j-down text-j-down">SHORT</span>
```

### Opacity variants

Tailwind arbitrary opacity like `text-[#22c55e]/50` becomes `text-j-up/50`.
Background opacity like `bg-[#22c55e]/15` becomes `bg-j-up/15`.

---

## How to Continue

1. Pick a file from the migration table above
2. Run the grep commands to find direction colors
3. Replace using the token reference table
4. Mark the file as ✅ in this doc
5. Run `npm run check` to confirm no type errors
6. Commit: `feat(theme): migrate <filename> to semantic tokens`

**Recommended order:** Dashboard → Portfolio → Signals → components (smallest first)
