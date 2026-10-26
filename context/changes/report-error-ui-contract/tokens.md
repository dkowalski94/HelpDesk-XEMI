# Token values — XEMI light theme (`:root`, active)

Source of truth: `src/styles/global.css`. Since phase 2 (amendment 2026-10-19) `<html>` carries no theme class, so `:root` is the theme every page shows. Its values map the palette of https://www.xemi.pl/ onto shadcn role names. The cosmic set stays in `.dark` as the dark variant (see the last section).

## How contrast was measured

WCAG 2.x relative luminance: oklch → OKLab → linear sRGB → sRGB (clamped), translucent colours composited in sRGB over the surface they sit on (as the browser does). Targets: 4.5:1 for text, 3:1 for control borders and the focus ring. Every oklch value below round-trips to the hex shown. Surfaces checked:

| Surface | Value |
|---|---|
| `background` | `--background` white `#FFFFFF` (also `--card`, `--popover`) |
| `muted` | `--muted` `#F4F4F4` (xemi.pl section background) — **worst case** for dark-on-light |

## Roles

"derived" = no exact xemi.pl value; chosen as the closest value to the xemi.pl hue/neutral that meets the target.

| Role | `:root` value | Hex | xemi.pl source | Contrast vs `background` / `muted` |
|---|---|---|---|---|
| `--background` | `oklch(1 0 0)` | `#FFFFFF` | page background | — |
| `--foreground` | `oklch(0.1913 0 0)` | `#141414` | body text | 18.42 / 16.75 |
| `--card`, `--popover` | `oklch(1 0 0)` | `#FFFFFF` | content blocks | surface |
| `--card-foreground`, `--popover-foreground` | `oklch(0.1913 0 0)` | `#141414` | body text | 18.42 / 16.75 |
| `--muted`, `--secondary` | `oklch(0.9672 0 0)` | `#F4F4F4` | section background | surface (1.10 vs white) |
| `--secondary-foreground` | `oklch(0.1913 0 0)` | `#141414` | body text | 18.42 / 16.75 |
| `--muted-foreground` | `oklch(0.5417 0 0)` | `#6F6F6F` | derived (xemi.pl neutral gray) | 5.02 / 4.57 |
| `--border` | `oklch(0.8975 0 0)` | `#DDDDDD` | derived (light gray separator) | 1.36 / 1.24 — decorative card border, not a control; below 3:1 by design |
| `--input` | `oklch(0.64 0 0)` | `#8C8C8C` | derived (neutral gray) | 3.36 / 3.06 |
| `--accent` | `oklch(0.8998 0.0453 225.267)` | `#BFE5F5` | light blue | surface (1.33 vs white) |
| `--accent-foreground` | `oklch(0.1913 0 0)` | `#141414` | body text | 13.81 on `--accent` |
| `--brand` (new) | `oklch(0.6667 0.1473 237.798)` | `#009FE3` | brand blue (logo `#009EE2`) | 2.97 / 2.70 — **logo and large accents only**, not text or small controls |
| `--primary` | `oklch(0.51 0.115 237.8)` | `#006EA0` | derived — brand-blue hue, darker | 5.63 / 5.12 (as text) |
| `--primary-foreground` | `oklch(1 0 0)` | `#FFFFFF` | — | 5.63 on `--primary`; 4.65 on `hover:bg-primary/90` |
| `--ring` | `oklch(0.6 0.13 237.8)` | `#0C8AC4` | derived — brand-blue hue | 3.87 / 3.52 (at `ring-ring/50`: 1.91 / 1.84 — see notes) |
| `--destructive` | `oklch(0.505 0.213 27.518)` | `#C10007` | none on xemi.pl — Tailwind red-700 | 6.42 / 5.84; text on `bg-destructive/10` over white: 5.33 |
| `--destructive-foreground` | `oklch(1 0 0)` | `#FFFFFF` | — | 6.42 on `--destructive`; 5.84 on `/90` |
| `--success` | `oklch(0.508 0.118 165.612)` | `#007A55` | none on xemi.pl — Tailwind emerald-700 | 5.37 / 4.88; text on `bg-success/10` over white: 4.66 |
| `--success-foreground` | `oklch(1 0 0)` | `#FFFFFF` | — | 5.37 on `--success` |
| `--warning` | `oklch(0.53 0.15 48)` | `#AE4900` | none on xemi.pl — amber/orange, darker than Tailwind amber-700 | 5.60 / 5.09; text on `bg-warning/10` over white: 4.85 |
| `--warning-foreground` | `oklch(1 0 0)` | `#FFFFFF` | — | 5.60 on `--warning` |
| `--radius` | `0.375rem` (6 px; `sm` 2 px, `md` 4 px, `lg` 6 px, `xl` 10 px) | — | radii 4–7 px | — |
| `--font-sans` | `"Lato", ui-sans-serif, system-ui, sans-serif, …` | — | Lato 400/700/800 | — |
| `--cosmic-from` (theme-independent) | `oklch(0.1663 0.0262 269.371)` | `#0A0E1A` | — (today's `bg-cosmic` ends) | — |
| `--cosmic-via` (theme-independent) | `oklch(0.2014 0.0412 269.806)` | `#0F1529` | — (today's `bg-cosmic` middle) | — |

Unchanged `:root` roles: `--chart-*`, `--sidebar*` (stock shadcn, unused).

Published in `@theme inline` for this change: `--color-brand`, `--color-destructive-foreground`, `--color-success(-foreground)`, `--color-warning(-foreground)`, `--font-sans`. `body` gets `font-sans` in the base layer.

## Notes and deviations

- **Brand blue split.** `#009FE3` fails 4.5:1 and 3:1 on white, so it lives only in `--brand`; `--primary` (fills, link text) and `--ring` are darker steps of the same hue (237.8°).
- **`hover:bg-primary/90`** (button default variant) lightens the fill over white; white text there is 4.65:1, which is why `--primary` is L 0.51 rather than the lightest step passing 4.5:1 at rest (L 0.52 gives only 4.49 on hover).
- **Primary on accent.** `text-primary` on `bg-accent` is 4.22:1 — below AA; text on an accent surface uses `text-accent-foreground`.
- **Focus ring at half alpha.** `--ring` passes 3:1 on both surfaces, but `button.tsx` and the base layer draw it as `ring-ring/50` / `outline-ring/50` (1.91 / 1.84). The 3 px ring width partly compensates; phase 3 should use full `ring-ring` (or `focus-visible:border-ring`) on the view's controls where focus must meet 3:1.
- **`--input` passes 3:1 on white and on `#F4F4F4`.** The plan's ≈`#8F8F8F` gives 2.94 on `#F4F4F4`, so `#8C8C8C` was used.
- **Lato weights.** `@fontsource/lato` ships 100/300/400/700/900 — there is no 800; `Layout.astro` imports 400, 700 and 900 (900 stands in for xemi.pl's 800).
- **`--background-elevated` removed.** It existed only for `bg-cosmic`, which now reads `--cosmic-from`/`--cosmic-via`; nothing else read it and it was never published in `@theme inline`.
- **`bg-cosmic` is theme-independent.** `linear-gradient(to bottom, var(--cosmic-from), var(--cosmic-via), var(--cosmic-from))`, defined once in `:root` and not overridden in `.dark`, so the 12 views with white literal text on `bg-cosmic` keep their navy background. Their `body` behind it is now white (`bg-background`), covered by `bg-cosmic min-h-screen`.
- **Global side effect.** The base layer `outline-ring/50` now draws a blue focus outline on every page, and body text everywhere is Lato.

## Dark variant (`.dark`, cosmic)

Applies inside any element with `class="dark"` (e.g. the Topbar wrapper on dark pages in phase 3). Values reproduce the cosmic literals (Tailwind v4 palette). Contrast measured against `#0A0E1A`, a glass card (white/10) over it, and the worst case — an inner card (white/5) over the card over `#0F1529`.

| Role | `.dark` value | Literal it replaces | Contrast vs background / card / worst |
|---|---|---|---|
| `--background` | `oklch(0.1663 0.0262 269.371)` | `#0a0e1a` | — |
| `--foreground`, `--card-foreground` | `oklch(1 0 0)` | `text-white` | 19.25 / 15.08 / 11.84 |
| `--card` | `oklch(1 0 0 / 10%)` | `bg-white/10` | surface |
| `--muted` | `oklch(1 0 0 / 5%)` | `bg-white/5` | surface |
| `--muted-foreground` | `oklch(0.932 0.032 255.585 / 60%)` | `text-blue-100/60` (also `/50`, `/40`) | 6.12 / 5.41 / 4.62 |
| `--border` | `oklch(1 0 0 / 10%)` | `border-white/10` | decorative, below 3:1 by design |
| `--input` | `oklch(1 0 0 / 40%)` | `border-white/20` (raised to pass 3:1) | 3.80 / 3.66 / 3.30 |
| `--primary`, `--ring` | `oklch(0.827 0.119 306.383)` (purple-300) | `focus:border-purple-300/60`, `text-purple-200` | 10.81 / 8.46 / 6.65 |
| `--primary-foreground` | `oklch(0.1663 0.0262 269.371)` | — | 10.81 on `--primary` |
| `--accent` / `--accent-foreground` | `oklch(1 0 0 / 20%)` / `oklch(0.985 0 0)` | `hover:bg-white/20`, `text-white` | — |
| `--brand` | `oklch(0.6667 0.1473 237.798)` | — (same as light) | 6.48 on `#0a0e1a`, 6.10 on `#0f1529` |
| `--destructive` | `oklch(0.808 0.114 19.571)` (red-300) | `text-rose-200`, `red-100/300/400/500` | 10.02 / 7.85 / 6.16 |
| `--success` | `oklch(0.905 0.093 164.15)` (emerald-200) | `text-emerald-200` | 15.04 / 11.78 / 9.25 |
| `--warning` | `oklch(0.924 0.12 95.746)` (amber-200) | `text-amber-200` | 15.45 / 12.10 / 9.50 |
| `--destructive-/success-/warning-foreground` | `oklch(0.1663 0.0262 269.371)` (navy) | — | ≥ 10.02 on their role |

Unchanged stock `.dark` roles: `--popover*`, `--secondary*`, `--chart-*`, `--sidebar*`. At `ring-ring/50` the dark ring is 3.46 / 3.22 / 2.85.
