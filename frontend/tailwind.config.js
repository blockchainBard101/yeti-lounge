/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── 3-Color Light Ice System ─────────────────
        bgPrimary:        "#EEF4FF",   // Light ice blue canvas
        surface:          "#FFFFFF",   // White cards
        surfaceSecondary: "#F3F8FF",   // Tinted surface
        accent:           "#00B8E6",   // Yeti ice blue

        // ── Supporting tokens ────────────────────────
        textPrimary:   "#0A1428",
        textSecondary: "#4A6080",
        borderIce:     "#D0DCF0",
      },
      fontFamily: {
        heading: ["var(--font-space-grotesk)", "sans-serif"],
        body:    ["var(--font-inter)", "sans-serif"],
        fun:     ["var(--font-fredoka)", "sans-serif"],
      },
      backdropBlur: { xs: "2px" },
      boxShadow: {
        "ice-glow": "0 4px 20px rgba(0, 184, 230, 0.15)",
        "card":     "0 2px 16px rgba(10, 20, 60, 0.07)",
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.25rem",
      },
    },
  },
  plugins: [],
};
