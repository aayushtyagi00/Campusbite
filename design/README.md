# CampusBite — LPU scheduled pickup

Stitch project: https://stitch.withgoogle.com/projects/17438086332439213223

## Design direction

A warm, contemporary campus food experience designed around short breaks between classes. Working brand name: CampusBite. Ivory surfaces, forest-green typography and actions, terracotta highlights, authentic Indian food photography, DM Sans typography, generous spacing and clear touch targets.

## Core experience

Browse publicly → choose stall → add food → select a feasible pickup window → sign in → review all charges → pay → await vendor acceptance → track preparation → show six-digit pickup code → collect at the stall.

Pickup time and exact stall location take precedence over promotional content. This is self-pickup, not delivery. One vendor per cart. Configurable extras are outside the pilot. Sold-out items and full pickup windows must be visibly unavailable.

## Operational screens

Vendor: paid order queue, acceptance countdown, preparation actions, collection verification, connection status and order-alert controls.

Admin: vendor approval, refunds, order investigation, and settlement reconciliation. Payment, fulfillment, refunds, and settlements remain distinct statuses.

## Design assumptions

- All vendor names, menu prices, order records, fees, and metrics shown in mockups are illustrative.
- 10-minute pickup windows and a 90-second acceptance deadline are proposed pilot rules.
- Business fees, payment provider, post-acceptance cancellation rules, and support policy require final product decisions.
- Authentication preserves the cart. Recovery offers an email link or OTP with resend cooldown.
- No acceptance or pickup-ready claim before the corresponding verified state.
- No claim of a completed refund until confirmed.

## Handoff

This folder holds the design brief and exported review artifacts where available. No API credentials belong in project files. Designs are frontend concepts, not a connected payment or authentication implementation.

Open `index.html` for the ten-screen review gallery. Each screen includes a PNG preview and editable HTML export. `manifest.json` records the final Stitch screen resources; earlier iterations may also remain in the Stitch project. `DESIGN.md` contains the generated visual system.

Screens: campus discovery, stall menu, sign-in, cart and scheduled checkout, awaiting acceptance, pickup ticket, orders and refunds, password recovery, vendor order board, and admin operations overview. These establish the core frontend direction; they are not an exhaustive specification of every account, onboarding, settings, or error dialog.

Visual review corrected inconsistent prices and locations, unsupported preparation/refund guarantees, pickup-code wording, and the vendor board layout. The corrected refund and admin HTML were rendered in Chromium at 390px and 1440px respectively with no horizontal document overflow. The exports use external font/icon and styling resources, so internet access is needed for faithful HTML rendering; the PNG previews are self-contained.
