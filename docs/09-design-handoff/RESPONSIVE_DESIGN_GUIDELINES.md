# Responsive design guidelines

## Breakpoints (Tailwind)
`sm 640` · `md 768` · `lg 1024` · `xl 1280` · `2xl 1536`. Design at **360**, **768** and **1280**.

## Rules
- Mobile-first CSS. The public pages, the customer booking flow, the lab scanner and the verification page must be fully usable at 360 px.
- Admin console: desktop-first (≥ 1024). Below that, show a "best on a larger screen" notice but stay functional for read-only views.
- Tables become card lists below `md`. The key fields shown are the booking number, status, next action and deadline.
- Search: below `lg`, a list/map toggle. At `lg` and above, a split view.
- Touch targets ≥ 44×44 px. Primary actions stay sticky at the bottom on mobile forms.
- **Lab scanner:** full-screen camera, a bottom sheet with booking info, large confirm buttons, works one-handed, offline banner, low-end Android performance (no heavy animation, lazy-load images, keep the JS bundle for the scanner route small).
- QR display for customers at the counter: a full-width QR with a "max brightness" hint and the short code in large type.
- Printing: label sheets and the custody trail have print stylesheets.
- Respect `prefers-reduced-motion` and the OS font scaling (support 200% zoom without loss of content).
