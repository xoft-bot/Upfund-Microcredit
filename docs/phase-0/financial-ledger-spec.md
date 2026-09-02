# Financial Ledger and Capital Allocation Specification

## Purpose

The ledger is the authoritative record for disbursements, collections, charges, reserves, costs, recoveries, write-offs, capital contributions, withdrawals, and deployable lending capacity. Dashboards, reports, risk metrics, CIR, and sustainability status must consume ledger-derived read models rather than implement separate calculations.

## Required distinctions

The system must distinguish the contractual loan obligation from money actually received. It must separately represent principal, contractual charge, collected charge, credit-loss reserve, collection cost, operating cost, tax or regulatory provision where applicable, realized net profit, retained profit, and deployable growth capital. Projected future collections and future charges are not cash and cannot increase current lending capacity.

## Logical pools

| Pool | Meaning | Can fund a new loan? |
|---|---|---:|
| Principal capital | Original external or designated lending principal | Yes, subject to liquidity and risk policy |
| Credit-loss reserve | Provision for defaults, fraud loss, unrecovered balances, and write-offs | No, except through an approved reserve-release treatment |
| Operating reserve | Salaries, transport, technology, administration, and operating obligations | No, except approved operating disbursement |
| Growth/reinvestment capital | Realized, retained, deployable surplus after required allocations | Yes, subject to capacity policy |

Each pool requires opening balance, additions, deductions, current balance, policy version, source transactions, and reconciliation status.

## Event-to-posting rules

| Business event | Minimum posting outcome |
|---|---|
| Capital contribution | Increase cash/bank and principal capital; audit source and contributor |
| Loan disbursement | Decrease cash/mobile-money; increase principal receivable; link provider reference |
| Scheduled charge accrual | Record contractual receivable or memo value; do not treat as cash |
| Collection received | Increase cash/mobile-money; reduce receivable according to configured waterfall; issue receipt |
| Charge collected | Move from collected receivable to realized income subject to policy |
| Reserve allocation | Increase credit-loss reserve and reduce allocable income |
| Operating/collection allocation | Increase operating reserve or expense classification and reduce allocable income |
| Growth allocation | Increase growth capital only from realized eligible surplus |
| Expense paid | Reduce cash/bank and record approved expense category |
| Default/write-off | Reduce or reclassify receivable and record loss/reserve treatment; retain history |
| Recovery | Increase cash/bank and record recovery against the relevant written-off or defaulted exposure |
| Reversal/adjustment | Create linked offsetting entries; never overwrite the original |

The exact waterfall must be configurable and approved. The default implementation should make the allocation basis explicit instead of assuming that every collection is allocated identically.

## Derived metrics

`Net Credit Loss = Defaulted Principal - Recoveries`, with the reporting period and portfolio denominator explicitly stated. `Net Credit Loss Rate = Net Credit Loss / Average Portfolio`. `Collection Efficiency = Collected Scheduled Amount / Scheduled Amount`, with treatment of partial and late payments defined. PAR metrics must define whether the denominator is outstanding principal, scheduled amount, or another approved basis.

`Capital Independence Ratio = Cumulative Retained Net Profit / Initial External Capital`. CIR is informative but cannot alone produce a self-sustaining status. The status engine must also consider liquidity, required reserves, operating sustainability, credit sustainability, portfolio demand, and planned disbursements.

## Financial safety controls

All postings require an actor, timestamp, currency, amount, account/pool, source event, policy version, correlation ID, and idempotency key. Amounts must be integer UGX values or integer minor units. Every journal entry must be balanced with strict double-entry invariants: total debits equal total credits, each line belongs to the same transaction, and no transaction may be posted partially. During payment posting and balance-affecting operations, use database transactions with row-level locks or an equivalent optimistic-version guard on the affected accounts/aggregates so concurrent submissions cannot create lost updates or negative capacity. No financial event may be physically deleted. A ledger period may be closed, after which changes require a controlled adjustment workflow.

A daily reconciliation compares expected collections, digital postings, physical receipts, cash submitted, and mobile-money/bank settlement. Variances require a reason and review status. The system must prevent duplicate receipt IDs, duplicate provider references, duplicate offline local IDs, and duplicate idempotency keys.

## Test cases

The initial test suite must cover a fully compliant loan, partial payment, late payment, default, recovery, write-off, reversal, duplicate offline submission, cash variance, zero default, 5%, 8%, 10%, 15%, 20%, and 30% net-credit-loss scenarios. It must assert that gross charge never equals growth capital unless the allocation policy explicitly produces that outcome and all required reserves/costs are zero or otherwise accounted for.
