export const EFFORT_MULTIPLIERS: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 1.0,
  2: 1.25,
  3: 1.5,
  4: 1.85,
  5: 2.25,
};

export const OPTIMIZER_WEIGHTS = {
  WEIGHT_UTILIZATION: 1.0,
  PENALTY_AVOIDED_TASK: 50.0,
  BONUS_PREFERRED_TASK: 30.0,
  PENALTY_OFF_PREFERRED_DAY: 25.0,
  PENALTY_SPACING_VIOLATION: 100.0,
  PENALTY_ROTATION_STREAK: 45.0,
  PENALTY_DAILY_SPIKE: 60.0,
  PENALTY_CHURN: 35.0, // Churn penalty for moving an already assigned task during rebalance
  MAX_2OPT_ITERATIONS: 50,
} as const;

export function getEffortMultiplier(effortLevel: 1 | 2 | 3 | 4 | 5): number {
  return EFFORT_MULTIPLIERS[effortLevel] ?? 1.0;
}

export function calculateWeightedMinutes(durationMinutes: number, effortLevel: 1 | 2 | 3 | 4 | 5): number {
  const mult = getEffortMultiplier(effortLevel);
  return Math.round(durationMinutes * mult * 100) / 100;
}
