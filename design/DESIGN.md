---
name: CampusBite
colors:
  surface: '#faf9f3'
  surface-dim: '#dbdad4'
  surface-bright: '#faf9f3'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f5f4ee'
  surface-container: '#efeee8'
  surface-container-high: '#e9e8e2'
  surface-container-highest: '#e3e3dd'
  on-surface: '#1b1c19'
  on-surface-variant: '#404944'
  inverse-surface: '#30312d'
  inverse-on-surface: '#f2f1eb'
  outline: '#707974'
  outline-variant: '#c0c9c2'
  surface-tint: '#326853'
  primary: '#01402e'
  on-primary: '#ffffff'
  primary-container: '#215844'
  on-primary-container: '#94ccb3'
  inverse-primary: '#9ad2b9'
  secondary: '#406659'
  on-secondary: '#ffffff'
  secondary-container: '#c2ecdb'
  on-secondary-container: '#466c5f'
  tertiary: '#6d1800'
  on-tertiary: '#ffffff'
  tertiary-container: '#952500'
  on-tertiary-container: '#ffac95'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#b6efd4'
  primary-fixed-dim: '#9ad2b9'
  on-primary-fixed: '#002116'
  on-primary-fixed-variant: '#17503c'
  secondary-fixed: '#c2ecdb'
  secondary-fixed-dim: '#a6cfc0'
  on-secondary-fixed: '#002018'
  on-secondary-fixed-variant: '#284e42'
  tertiary-fixed: '#ffdbd1'
  tertiary-fixed-dim: '#ffb5a0'
  on-tertiary-fixed: '#3b0900'
  on-tertiary-fixed-variant: '#872000'
  background: '#faf9f3'
  on-background: '#1b1c19'
  surface-variant: '#e3e3dd'
typography:
  headline-xl:
    fontFamily: DM Sans
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.03em
  headline-xl-mobile:
    fontFamily: DM Sans
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: DM Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: DM Sans
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 30px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: DM Sans
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: DM Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: 0em
  body-lg:
    fontFamily: DM Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: 0em
  body-md:
    fontFamily: DM Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  body-sm:
    fontFamily: DM Sans
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-lg:
    fontFamily: DM Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 18px
    letterSpacing: 0.02em
  label-md:
    fontFamily: DM Sans
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.03em
  label-sm:
    fontFamily: DM Sans
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-desktop: 1.5rem
  margin: 1rem
  margin-tablet: 1.5rem
  margin-desktop: 2.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.25rem
---

## Brand & Style

This design system is tailored for high-density university food environments, piloting specifically at the UniMall Food Court (LPU Campus). The emotional tone balances the operational precision of scheduled campus logistics with the warm, inviting nature of casual dining. 

### Brand Tone & Atmosphere
- **Composed & Grounded:** Academic schedule-friendly, dependable, orderly, and calm amidst peak lunch-hour rushes.
- **Warm Editorial:** Organic warmth replaces standard aggressive fast-food aesthetics, drawing cues from lifestyle food publications and high-end botanical packaging.
- **Pragmatic Utility:** Immediate legibility of functional campus operational tokens: stall IDs, live preparation states, dynamic pickup time windows, and local currency (₹).

### Visual Movement
A modern blend of **Minimalism and Organic Tactility**: 
- Flat planes of warm ivory and pale sage anchored by dense forest-green typography.
- Thin, mechanical borders and generous whitespace provide crisp order.
- Highly targeted bursts of terracotta establish critical callouts (pickup timers, quick alerts, active stalls) without creating visual noise.
- Crisp line iconography (Lucide / Heroicons style at 1.5px stroke weight) strictly used; emojis are banned from functional interfaces.

## Colors

The palette establishes an earthy, academic, and nourishing identity. Contrast is prioritized for high outdoor legibility across sunlit campus courtyards.

### Palette Distribution
- **Background Canvas (`#F8F7F1`):** A warm ivory base that reduces screen glare and imparts organic warmth.
- **Primary Text & Deep Structural Headings (`#163D32`):** Deep forest green. Functions as the absolute highest contrast value for primary typography, dominant stall headlines, and foundational structural dividers.
- **Brand & Primary Actions (`#215844`):** Rich green. Applied to interactive affordances: primary checkout buttons, selected tabs, progress bars, and active state indicators.
- **Accent & Badges (`#D8532D`):** Terracotta. Reserved strictly for urgency and highlight attributes: active pickup window countdowns, limited-time campus specials, "Ready for Pickup" status chips, and promotional badges.
- **Surface & Containers:**
  - Standard Surface: Pure white (`#FFFFFF`) for menu items and interactive card states.
  - Secondary Container: Pale sage (`#E9F0E7`) for stall badges, informational banners, order summary trays, and contextual grouping.
- **Borders & Outlines (`#E2E1D7`):** Warm stone. A soft structural boundary used to demarcate cards and list items without visual heaviness.

## Typography

The typography leverages DM Sans across all tiers, pairing geometric readability with understated warmth.

### Hierarchy & Guidelines
- **Stall Identifiers & Numerical Data:** Stall numbers (e.g., `STALL 04`) and currency values (`₹120`) utilize tabular numeric spacing to guarantee clean vertical rhythm across listings.
- **Editorial Contrast:** Pair high-weight headlines (`fontWeight: 700`) with medium or light line-item subtexts to clearly segment stall titles, cuisine types, and timing windows.
- **Tracking:** Headings feature tight negative letter-spacing for a modern, editorial lockup, while micro-labels and status badges (e.g., `PREPARING`, `SELF-PICKUP`) feature expanded uppercase tracking (`0.03em` to `0.05em`) for immediate recognition at a distance.

## Layout & Spacing

The layout is built upon an 8pt base grid with a responsive fluid container logic adapted for handheld student devices navigating crowded food courts.

### Grid Architecture
- **Mobile (<640px):** Single-column stacked feed. Margin is locked to `1rem` (16px) with an interior component gap of `1rem` to maximize touch areas.
- **Tablet (641px - 1024px):** 6-column fluid grid. Margin expands to `1.5rem` (24px) with `1rem` gutters for 2-column food stall indexing.
- **Desktop / Kiosk (>1024px):** 12-column grid maxed at 1200px width with `2.5rem` margins and `1.5rem` gutters. Accommodates split navigation: live stall map on the left, order tray on the right.

### Rhythm & Densities
- Vertical flow prioritizes generous top and bottom spacing (`space-xl`) between content sections to establish clean, unhurried negative space.
- Dense inner groupings (`space-xs` and `space-sm`) are applied within structural chips and price tags to preserve visual encapsulation.

## Elevation & Depth

Visual hierarchy is communicated through **tonal surface separation** and **ghost borders** rather than deep, dramatic drop shadows.

### Elevation Levels
- **Canvas (Level 0):** Pure background canvas (`#F8F7F1`). Un-elevated.
- **Surface Cards (Level 1):** Solid white (`#FFFFFF`) or pale sage (`#E9F0E7`) containers. Depth is defined by a 1px continuous hairline stroke in `#E2E1D7` and an ultra-subtle, ambient drop shadow: `0px 2px 6px rgba(22, 61, 50, 0.04)`.
- **Floating Controls & Sheets (Level 2):** Sticky cart footers, pickup window selectors, and filter drawers. Elevated with a warm ambient shadow: `0px 8px 24px rgba(22, 61, 50, 0.08)` with a 1px `#E2E1D7` top or bounding stroke.
- **Interactive Focus & Hover:** Elements lift slightly via subtle scale or tint shift to Pale Sage (`#E9F0E7`) rather than aggressive elevation increases.

## Shapes

The design system adopts a consistent 16px to 20px radius geometry (`roundedness: 2`), reflecting friendly approachability while maintaining a clean container contour.

### Corner Radius System
- **Base Components (Inputs, Small Badges, Action Icons):** `0.5rem` (8px).
- **Cards & Primary Modules (Stall Tiles, Menu Items, Order Summaries):** `1rem` to `1.25rem` (16px - 20px).
- **Sticky Trays, Floating Sheets, & Modal Panels:** `1.5rem` (24px) on top radii to establish an inviting, soft surface.
- **Pill Attributes (Pickup Timing Chips, Status Badges):** Fully rounded pill geometry (`9999px`) for contextual tags.

## Components

### 1. Buttons
- **Primary Button:** Background in Rich Green (`#215844`), text in `#FFFFFF`, with 16px corner radius. Minimum height 48px to allow easy single-handed tapping.
- **Secondary Button:** Outlined container with 1.5px border in Rich Green (`#215844`), background transparent or White (`#FFFFFF`), text in `#215844`.
- **Accent / Alert Action Button:** Background in Terracotta (`#D8532D`), white text, used strictly for immediate fulfillment actions (e.g., "Confirm Pickup Slot").

### 2. Stall Cards (UniMall Specials)
- **Container:** Pure White (`#FFFFFF`) background, 1px border (`#E2E1D7`), 16px radius.
- **Header Structure:** Stall badge (e.g., "Stall 04 • 1st Floor") displayed on Pale Sage (`#E9F0E7`) pill at top left. Open/Closed status dot on top right.
- **Pricing:** Clear "From ₹99" typography using Deep Forest Green (`#163D32`).

### 3. Pickup Window Selector & Chips
- **Time Slot Chips:** Fully rounded pills (`9999px`).
  - *Default:* Pale Sage (`#E9F0E7`) background, Deep Forest Green text.
  - *Active / Selected:* Rich Green (`#215844`) background with pure white text and an integrated checkmark icon.
  - *Urgent / Nearing Close:* Subtle Terracotta outline with text in Terracotta (`#D8532D`).

### 4. Input Fields
- **Container:** Background pure white (`#FFFFFF`), 1px outline in `#E2E1D7`, 8px radius.
- **Typography:** Body-md in Deep Forest Green (`#163D32`), placeholder in `#163D32` at 40% opacity.
- **Focus State:** 1.5px continuous outline in Rich Green (`#215844`) with zero outer glow.

### 5. Selection Controls (Checkboxes & Radios)
- **Checkboxes:** 20px square with 4px border radius. Unselected uses a 1.5px border (`#E2E1D7`). Selected fills with Rich Green (`#215844`) with a sharp white checkmark.
- **Radio Buttons:** Circular selection with matching Rich Green fill dot for dietary choices (Veg/Non-Veg indicators accompany labels using standard culinary green/red symbols).

### 6. Campus Pickup Status Banner
- **Persistent Bottom / Header Bar:** Sticky banner signaling active order progress.
- Pale Sage (`#E9F0E7`) ground, highlighted by a Terracotta (`#D8532D`) counter tag (e.g., "Ready in 6 mins • Stall 04").
- High legibility, Lucide clock/store icon at 1.5px stroke weight.
