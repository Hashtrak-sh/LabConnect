# Component specification

**Status:** DRAFT. Base: shadcn/ui (Radix). Each component lists its variants and required states. All components use semantic tokens.

| Component | Variants and notes | States |
|---|---|---|
| Button | primary, secondary, ghost, destructive, link. Sizes sm/md/lg. Icon-only needs an aria-label. | default, hover, focus, active, disabled, loading |
| Input, Textarea, Select, Combobox (taxonomy search), DatePicker (IST), Checkbox, Radio, Switch | with label, help, error | default, focus, error, disabled, read-only |
| FileUpload | drag-drop + picker, shows scan status (Pending scan / Clean / Rejected) | idle, uploading %, scanning, clean, infected, invalid |
| CameraScanner | full-screen on mobile, torch toggle, manual short-code entry fallback, offline badge, queued count | permission prompt, scanning, success (haptic + tone), rejected (reason), offline |
| PhotoCapture | camera or gallery, thumbnails, up to 10 | — |
| StatusBadge | booking, payment, report, dispute, accreditation (uses the status mapping) | — |
| BookingTimeline | vertical steps with actor, role and time. Custody events are collapsible. | — |
| NextActionCard | state + who it's waiting on + primary CTA + deadline countdown | — |
| SlaCountdown | relative + absolute IST. Warning at 50%, danger at 90%. | — |
| LabResultCard | name, distance, accreditation badge, matched scope lines (max 3 + "more"), price from, TAT, next slot, rating, Book / Request CTA | bookable, listed, calibration, unavailable |
| MapView | MapLibre, clusters, selected-pin sync with the list, OSM attribution | — |
| ScopeTree | discipline → group → product → parameter, searchable, selectable for booking | — |
| PriceSummary | lines, prep, GST, total (₹ en-IN), "estimate until lab confirms" | — |
| TRFForm | multi-step, Zod-validated, autosave draft | — |
| QrLabelPreview | A4 sheet / thermal, print action | — |
| DataTable | sortable, filterable, cursor pagination, compact density, row actions, responsive card mode on mobile | empty, loading skeleton, error |
| DiffViewer | before and after for change sets and versions | — |
| ImportPreview | counts by action, row errors, download error CSV | — |
| ApprovalPanel | maker summary, evidence, approve / return / hold with mandatory reason, self-approval explanation | allowed, blocked (self), MFA required |
| MfaPrompt | TOTP 6-digit input, step-up dialog | — |
| VerificationResult | big result state + metadata + local hash compare | genuine-current, superseded, not-found, revoked |
| NotificationBell + Inbox | unread count, action items pinned | — |
| EmptyState, ErrorState, PermissionDenied, OfflineBanner, PartnerOutageBanner | — | — |
| Money, DateTime, BookingNo, Masked (phone, bank) | formatting primitives | — |
