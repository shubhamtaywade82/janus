/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },

        // ── Janus semantic tokens ──────────────────────────────────────────
        // Use these instead of hardcoded hex. They switch automatically with
        // the active data-theme. All support opacity modifiers (e.g. /10).
        "j-up":           "hsl(var(--janus-up)           / <alpha-value>)",
        "j-up-bright":    "hsl(var(--janus-up-bright)    / <alpha-value>)",
        "j-down":         "hsl(var(--janus-down)         / <alpha-value>)",
        "j-down-bright":  "hsl(var(--janus-down-bright)  / <alpha-value>)",
        "j-info":         "hsl(var(--janus-info)         / <alpha-value>)",
        "j-warn":         "hsl(var(--janus-warn)         / <alpha-value>)",
        "j-purple":       "hsl(var(--janus-purple)       / <alpha-value>)",
        "j-app":          "hsl(var(--janus-app)          / <alpha-value>)",
        "j-surface":      "hsl(var(--janus-surface)      / <alpha-value>)",
        "j-surface-2":    "hsl(var(--janus-surface-2)    / <alpha-value>)",
        "j-border":       "hsl(var(--janus-border)       / <alpha-value>)",
        "j-border-muted": "hsl(var(--janus-border-muted) / <alpha-value>)",
        "j-text":         "hsl(var(--janus-text)         / <alpha-value>)",
        "j-text-2":       "hsl(var(--janus-text-2)       / <alpha-value>)",
        "j-text-3":       "hsl(var(--janus-text-3)       / <alpha-value>)",
        "j-text-4":       "hsl(var(--janus-text-4)       / <alpha-value>)",
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xs: "calc(var(--radius) - 6px)",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "caret-blink": {
          "0%,70%,100%": { opacity: "1" },
          "20%,50%": { opacity: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "caret-blink": "caret-blink 1.25s ease-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}