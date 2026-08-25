export interface AllocationPolicy {
  version: string;
  creditLossBps: number;
  operatingBps: number;
  collectionBps: number;
  growthBps: number;
}

export interface AllocationResult {
  policyVersion: string;
  realizedCharge: number;
  creditLossReserve: number;
  operatingReserve: number;
  collectionCost: number;
  growthCapital: number;
  retainedProfit: number;
  deployableGrowthCapital: number;
}

function assertPolicy(policy: AllocationPolicy): void {
  const values = [policy.creditLossBps, policy.operatingBps, policy.collectionBps, policy.growthBps];
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 10_000)) throw new Error('INVALID_ALLOCATION_POLICY');
  if (values.reduce((sum, value) => sum + value, 0) > 10_000) throw new Error('ALLOCATION_POLICY_EXCEEDS_100_PERCENT');
}

function bps(amount: number, rate: number): number { return Math.floor((amount * rate) / 10_000); }

export function allocateRealizedSurplus(realizedCharge: number, policy: AllocationPolicy, existingGrowthCapital = 0): AllocationResult {
  assertPolicy(policy);
  if (!Number.isSafeInteger(realizedCharge) || realizedCharge < 0) throw new Error('INVALID_REALIZED_CHARGE');
  if (!Number.isSafeInteger(existingGrowthCapital) || existingGrowthCapital < 0) throw new Error('INVALID_EXISTING_GROWTH_CAPITAL');
  const creditLossReserve = bps(realizedCharge, policy.creditLossBps);
  const operatingReserve = bps(realizedCharge, policy.operatingBps);
  const collectionCost = bps(realizedCharge, policy.collectionBps);
  const growthCapital = bps(realizedCharge, policy.growthBps);
  const allocated = creditLossReserve + operatingReserve + collectionCost + growthCapital;
  const retainedProfit = realizedCharge - allocated;
  return { policyVersion: policy.version, realizedCharge, creditLossReserve, operatingReserve, collectionCost, growthCapital, retainedProfit, deployableGrowthCapital: existingGrowthCapital + growthCapital };
}
