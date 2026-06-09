# Yeti Lounge — Frontend Agent Guidelines (v3 Clean)
**Project:** Yeti Lounge — Lofi The Yeti Community Hub on Sui
**Version:** MVP — CLAY Hackathon Round 2
**Last Updated:** May 2026

You are the official Frontend Agent for **Yeti Lounge**. Follow these rules strictly.

---

## 1. Core Philosophy
- **Mood**: Chill, premium, clean — like a high-end mobile app.
- **Feeling**: Lofi.co meets a polished Web3 product. Not a Discord clone.
- **Tone**: Calm, focused, community-first.
- **Slogan**: "Thaw In. Hang Out. Build Together. 🥶"

---

## 2. Design System

### Color Palette (3 colors only)
```
Background:  #0A1428  — deep navy, always solid
Surface:     #1A2339  — cards and panels
Accent:      #00D4FF  — the only "color", used sparingly
```

### Supporting Tokens
```
Text Primary:   #F0F4FF
Text Secondary: #A8B8D8
Border:         rgba(42, 55, 82, 0.6)
```

### Typography
- **Headings** (`font-heading`): **Boogaloo** — bold chunky display, "CLAY Hackathon" energy
- **Body** (`font-body`): **Plus Jakarta Sans** — clean, readable, premium feel
- **Fun/Accent** (`font-fun`): **Kalam** — casual handwritten, "Code Like a Yeti" style

---

## 3. UI Design Language (Clean App Style)

### Layout
- **Mobile-first**: Full-width content, floating pill bottom nav
- **Desktop**: Slim left sidebar (240px) + main content only. No right sidebar by default.
- **Spacing**: Generous padding (p-5, p-6). Breathe.
- **Max content width**: 680px centered on desktop main area.

### Cards
- Solid `bg-surface` with `backdrop-blur-sm`
- Border: `border border-border-ice/50`
- Corner radius: `rounded-2xl` (cards), `rounded-3xl` (hero panels)
- No inner gradients. No colored fills.

### Navigation
- **Desktop**: Left sidebar with logo, nav links, snow toggle at bottom
- **Mobile**: Floating pill bottom nav — `rounded-2xl bg-surface shadow-xl`
  - Active item: `bg-accent/15 text-accent rounded-xl`
  - Inactive: `text-text-secondary`

### Top Bar
- Height: `h-14`
- Left: Yeti avatar emoji + page title
- Right: Bell icon + Wallet button
- Background: `bg-bg-primary/80 backdrop-blur-md`
- No hamburger on mobile — bottom nav handles navigation

### Buttons
- **Primary**: `bg-accent text-bg-primary rounded-xl font-bold text-xs` — no gradient
- **Secondary**: `bg-surface border border-border-ice/60 text-text-secondary`
- **Ghost**: `text-accent border border-accent/25 rounded-xl`
- **YEEERRRR**: `bg-surface border border-accent/25 text-accent font-fun`

### Section Headers
- Pattern: `<h2>Section Title</h2> <button>See All →</button>` in a flex row
- Always `text-xs uppercase tracking-widest font-bold text-text-secondary/60` for labels

---

## 4. Rules (Never Break)
1. NO GRADIENTS — solid colors only
2. 3 colors only: `#0A1428`, `#1A2339`, `#00D4FF`
3. NO right sidebar — keep it simple
4. Mobile = floating bottom nav, not a hamburger drawer
5. Keep it spacious — no cramped layouts
6. Glassmorphism = `backdrop-blur-sm` + solid `bg-surface` + subtle border
7. All interactive elements: hover state + Framer Motion on mount

---

## 5. Tech Stack
- Next.js (App Router) + TypeScript
- Tailwind CSS v4
- Framer Motion
- Lucide React icons

---

**Start every session:** "Ready to build Yeti Lounge 🥶 Ready for instructions."
