/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Semantic tokens map to CSS variables (see index.css)
        base: "rgb(var(--c-base) / <alpha-value>)",
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        elevated: "rgb(var(--c-elevated) / <alpha-value>)",
        overlay: "rgb(var(--c-overlay) / <alpha-value>)",
        hover: "rgb(var(--c-hover) / <alpha-value>)",
        active: "rgb(var(--c-active) / <alpha-value>)",
        line: "rgb(var(--c-line) / <alpha-value>)",
        "line-strong": "rgb(var(--c-line-strong) / <alpha-value>)",
        content: {
          DEFAULT: "rgb(var(--c-text) / <alpha-value>)",
          muted: "rgb(var(--c-text-muted) / <alpha-value>)",
          faint: "rgb(var(--c-text-faint) / <alpha-value>)",
        },
        iris: {
          DEFAULT: "rgb(var(--c-iris) / <alpha-value>)",
          hi: "rgb(var(--c-iris-hi) / <alpha-value>)",
          lo: "rgb(var(--c-iris-lo) / <alpha-value>)",
        },
        teal: "rgb(var(--c-teal) / <alpha-value>)",
        amber: "rgb(var(--c-amber) / <alpha-value>)",
        rose: "rgb(var(--c-rose) / <alpha-value>)",
        sky: "rgb(var(--c-sky) / <alpha-value>)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
        "3xs": ["0.625rem", { lineHeight: "0.875rem" }],
      },
      borderRadius: {
        xl: "0.75rem",
        "2xl": "1rem",
      },
      boxShadow: {
        panel: "0 1px 0 0 rgb(255 255 255 / 0.02) inset",
        pop: "0 12px 32px -8px rgb(0 0 0 / 0.65), 0 0 0 1px rgb(var(--c-line-strong) / 0.7)",
        glow: "0 0 0 1px rgb(var(--c-iris) / 0.4), 0 8px 28px -10px rgb(var(--c-iris) / 0.55)",
      },
      transitionTimingFunction: {
        soft: "cubic-bezier(0.22, 1, 0.36, 1)",
        "soft-out": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(5px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in": {
          from: { opacity: "0", transform: "translateY(8px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "view-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-l": {
          from: { opacity: "0", transform: "translateX(-14px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "slide-r": {
          from: { opacity: "0", transform: "translateX(14px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        blink: {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: "0.3" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.22s cubic-bezier(0.22,1,0.36,1)",
        "slide-in": "slide-in 0.24s cubic-bezier(0.16,1,0.3,1)",
        "scale-in": "scale-in 0.16s cubic-bezier(0.22,1,0.36,1)",
        "view-in": "view-in 0.3s cubic-bezier(0.16,1,0.3,1)",
        "slide-l": "slide-l 0.26s cubic-bezier(0.16,1,0.3,1)",
        "slide-r": "slide-r 0.26s cubic-bezier(0.16,1,0.3,1)",
        shimmer: "shimmer 1.6s infinite",
        blink: "blink 1.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
