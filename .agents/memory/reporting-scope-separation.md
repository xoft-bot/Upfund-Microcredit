---
name: Reporting scope separation
description: Scope rules for portfolio risk metrics versus historical accounting-period metrics.
---

Current portfolio metrics such as PAR should use loans that are active or otherwise currently eligible for risk reporting. Historical period metrics such as disbursements, scheduled dues, and posted collections must scope by branch and reporting dates without excluding loans that have since completed.

**Why:** Reusing one active-loan CTE caused completed loans to disappear from disbursement and collection-efficiency totals even though their posted financial activity belonged in the selected period.

**How to apply:** Use separate scope CTEs or joins for as-of portfolio risk and date-bounded accounting activity, then derive revenue only from posted allocation columns and keep overpayments in liability totals.