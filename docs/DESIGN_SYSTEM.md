# BUYSELL design system

The supplied BUYSELL brand package is authoritative. The marketplace uses its real vector marks, green palette, Inter UI type, and practical commerce layouts. Reference screens guide density, hierarchy, responsive behavior, and dashboard composition; they do not override the official brand tokens.

## Brand assets

Use the SVG appropriate to its background:

| Asset | Intended use |
| --- | --- |
| `buysell_primary_light.svg` | Primary full logo on white/light surfaces |
| `buysell_primary_dark.svg` | Full logo variant for dark context defined by the asset |
| `buysell_reverse_green.svg` | Reversed logo on forest/deep green |
| `buysell_mono_white.svg` | Single-colour white mark where colour reproduction is limited |
| `buysell_icon_green.svg` | Compact app/navigation icon on light surfaces |
| `buysell_icon_dark.svg` | Compact dark icon where specified |

Keep the SVG aspect ratio, internal clear space, and colours. Do not redraw the wordmark, squeeze it, rotate it, add shadows/outlines, place it on noisy media without contrast, or combine it with an upstream supplier logo. The logo lettering uses Comfortaa; interface text does not.

## Colour tokens

| Token | Hex | Role |
| --- | --- | --- |
| Forest | `#0B6B3A` | Primary brand, navigation accents, selected states |
| Action | `#31A24C` | Primary actions and positive emphasis |
| Deep | `#073E26` | Dark header/sidebar/footer and strong text on mint |
| Ink | `#111614` | Main body and heading text |
| Black | `#0B0D0C` | Highest-emphasis neutral |
| White | `#FFFFFF` | Main canvas and reverse content |
| Mint | `#EAF6EE` | Brand-tinted section/background |
| Mint strong | `#D9F0E0` | Selected/strong tinted surface |
| Surface | `#F5F7F5` | Secondary canvas and subtle panels |
| Border | `#DFE6E1` | Dividers, inputs, card outlines |
| Muted | `#68716B` | Secondary copy; verify contrast at small sizes |
| Warm neutral | `#F3F1EA` | Editorial/trust variation |
| Deal yellow | `#F4B942` | Real promotions, warnings, and deal accents |
| Error | `#E34D59` | Destructive actions and validation errors |

Do not use colour alone to communicate status. Yellow is not a universal decoration; it denotes a real deal/warning. Error red is reserved for destructive/error states. Focus rings should be clearly visible against both white and green.

Suggested semantic aliases:

```css
:root {
  --color-brand: #0b6b3a;
  --color-action: #31a24c;
  --color-brand-deep: #073e26;
  --color-text: #111614;
  --color-text-muted: #68716b;
  --color-canvas: #ffffff;
  --color-surface: #f5f7f5;
  --color-brand-surface: #eaf6ee;
  --color-border: #dfe6e1;
  --color-danger: #e34d59;
}
```

## Typography

Interface font: **Inter** (400, 500, 600, 700) with system-ui fallback. Logo font: Comfortaa only where the official vector wordmark already uses it. Use tabular numerals for finance tables where supported.

| Style | Desktop guidance | Mobile guidance |
| --- | --- | --- |
| Display | 48–64 / 1.05, 700 | 34–44 / 1.08, 700 |
| Page title | 32–40 / 1.15, 700 | 26–32 / 1.18, 700 |
| Section heading | 24–30 / 1.2, 650–700 | 21–26 / 1.22, 650–700 |
| Card heading | 16–20 / 1.3, 600–700 | 15–18 / 1.3, 600–700 |
| Body | 16 / 1.55, 400 | 15–16 / 1.5, 400 |
| Label/meta | 12–14 / 1.4, 500–600 | 12–14 / 1.4, 500–600 |

Use sentence case. Avoid oversized landing text that delays commerce, condensed all-caps paragraphs, and weak grey copy below accessible contrast.

## Shape, spacing, and elevation

Core radii are 12px (controls/small cards), 18px (cards/panels), and 28px (hero/feature surfaces). Pills are reserved for compact statuses, filters, and chips—not every button or container. The card shadow is `0 10px 30px rgba(8, 39, 25, .08)`; most dashboard panels use a border and little or no shadow.

Use a 4px base spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80. Public sections generally have 64–96px vertical spacing on desktop and 40–64px on mobile. Dense dashboards use 20–32px between groups while maintaining at least 12–16px inside cards. Align to a consistent content container (approximately 1200–1320px) rather than allowing unrelated full-width blocks.

## Layout character

The first viewport reads as a marketplace: header, search, useful category entry points, real product imagery, and clear buyer/seller actions. Use white and pale surfaces with focused deep-green anchors. Establish rhythm by alternating product grids, compact trust bars, editorial commerce blocks, and seller/sourcing propositions. Avoid repetitive feature-card rows, decorative gradients everywhere, floating glass panels, random icon discs, and fake SaaS dashboard art.

Desktop marketplace product grids may use 3–6 columns based on available width and minimum card width. At usable phone widths, the public product grid is exactly two columns. Cards prioritize image, product name, current price, valid comparison/discount, store, real rating, availability, and wishlist affordance. Do not fill them with operational metadata.

Dashboards use a deep-green sidebar, compact top bar, high-information content surface, status chips, responsive tables, and contextual primary action. Buyer checkout and product pages use a two-column desktop layout that collapses to a clear single flow on mobile. Product mobile has a persistent bottom action only when it does not obscure content or browser safe areas.

## Component standards

- **Button:** primary green for the page's main action, outline/quiet for alternatives, red only for destructive actions. Minimum 44px touch target; visible pending state.
- **Input:** persistent label, helper/error line, border and focus ring, correct input type/autocomplete. Placeholder is an example, never the label.
- **Card:** one clear purpose; consistent image ratio and padding; entire-card links must keep nested controls independently accessible.
- **Status chip:** semantic icon/text plus colour; vocabulary comes from the domain status map.
- **Data table:** real headings, numeric alignment, row actions in a menu, filters above; convert to labelled cards or safe horizontal scroll on narrow screens.
- **Modal/dialog:** confirmation or short focused task only. Cart, checkout, messages, account, and dashboards are pages.
- **Toast:** brief confirmation. Actionable errors remain beside their failing control or in a persistent alert.
- **Skeleton:** approximates the final layout and respects reduced motion; it does not replace an empty state.
- **Empty state:** explains what is empty, why it matters, and one relevant next action without invented data.

## Accessibility

Target WCAG 2.2 AA. Use semantic landmarks and heading order, skip navigation, keyboard-operable menus/dialogs, trapped and restored focus for dialogs, visible `:focus-visible`, labelled icon buttons, live regions for asynchronous status, and alt text based on image purpose. Respect `prefers-reduced-motion`; do not autoplay distracting media. Test at 200% zoom, keyboard-only, common screen-reader navigation, 320px CSS width, and high text scaling.

## Content and imagery

Copy is direct, commerce-focused, human, and appropriate to Nigeria. Use `Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' })`. Do not invent user counts, ratings, revenue, delivery times, partnerships, warehouses, or supplier networks.

Product imagery should be clear, consistent, and responsive. Preserve aspect ratio; use `object-fit: cover` only where cropping is intentional. Public sourcing imagery is BUYSELL-owned or neutral and must not reproduce recognizable upstream marketplace branding, screenshots, or watermarks.

## Review checklist

- Correct official logo variant and clear space.
- Only defined tokens or an approved semantic derivative.
- Inter loaded without layout-blocking behavior and with system fallback.
- Two-column mobile product grid remains readable and tappable.
- Desktop/mobile hierarchy matches the supplied marketplace and dashboard references.
- No fabricated metrics or generic template copy.
- Keyboard, focus, contrast, zoom, reduced-motion, loading, empty, error, and long-content states checked.
