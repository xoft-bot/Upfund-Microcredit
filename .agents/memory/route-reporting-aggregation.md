---
name: Route reporting aggregation
description: Prevent fan-out errors when combining client-level schedules with route-level collection actuals.
---

Route-level reporting must aggregate scheduled dues and collection actuals in separate route-level CTEs before joining them. Joining client-level schedule rows directly to route-level collection rows multiplies actuals by the number of scheduled clients.

**Why:** A route can contain multiple clients and multiple capture records; a mixed-grain join silently inflates progress and actual collection totals while still producing plausible-looking rows.

**How to apply:** Build assignment, schedule-by-route, and actuals-by-route scopes independently, then join on route code and derive totals/progress from that one-row-per-route result.