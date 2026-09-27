export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export const DAYS_OF_WEEK: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export type HouseholdType = 'couple' | 'family' | 'roommates' | 'multigenerational' | 'custom';

export type OptimizationMode = 'balanced' | 'capacity_aware';

export interface HouseholdInput {
  id: string;
  name: string;
  type: HouseholdType;
  mode: OptimizationMode;
  planningHorizonWeeks: number; // 1 to 4
}

export interface MemberInput {
  id: string;
  name: string;
  role: string;
  weeklyCapacityMinutes: number;
  dailyCapacityMinutes?: Partial<Record<DayOfWeek, number>>;
  unavailableDays?: DayOfWeek[];
  preferredTaskIds?: string[];
  avoidedTaskIds?: string[];
}

export interface TaskInput {
  id: string;
  name: string;
  category: string;
  frequencyPerWeek: number; // 1 to 14
  durationMinutes: number; // per occurrence
  effortLevel: 1 | 2 | 3 | 4 | 5;
  eligibleMemberIds: string[];
  excludedMemberIds?: string[];
  fixedDays?: DayOfWeek[];
  preferredDays?: DayOfWeek[];
  minSpacingDays?: number;
}

export interface TaskOccurrence {
  occurrenceId: string;
  taskId: string;
  taskName: string;
  category: string;
  weekIndex: number;
  occurrenceIndex: number;
  durationMinutes: number;
  effortLevel: 1 | 2 | 3 | 4 | 5;
  effortMultiplier: number;
  weightedMinutes: number;
  eligibleMemberIds: string[];
  fixedDay?: DayOfWeek;
  preferredDays?: DayOfWeek[];
  minSpacingDays: number;
}

export interface AssignmentOutput {
  assignmentId: string;
  occurrenceId: string;
  taskId: string;
  taskName: string;
  category: string;
  weekIndex: number;
  dayOfWeek: DayOfWeek;
  memberId: string;
  memberName: string;
  durationMinutes: number;
  effortLevel: 1 | 2 | 3 | 4 | 5;
  weightedMinutes: number;
  reasonCodes: string[];
  isPinned?: boolean;
}

export type DiagnosticCode =
  | 'ERR_NO_ELIGIBLE_MEMBERS'
  | 'ERR_ALL_ELIGIBLE_UNAVAILABLE'
  | 'ERR_CAPACITY_DEFICIT'
  | 'ERR_CONFLICTING_FIXED_SCHEDULE'
  | 'ERR_HARD_CAP_EXCEEDED';

export interface UnassignedTask {
  occurrenceId: string;
  taskId: string;
  taskName: string;
  weekIndex: number;
  occurrenceIndex: number;
  durationMinutes: number;
  weightedMinutes: number;
  diagnosticCode: DiagnosticCode;
  remediation: string;
}

export interface MemberWorkloadSummary {
  memberId: string;
  memberName: string;
  role: string;
  weeklyCapacityMinutes: number;
  assignedMinutes: number;
  assignedWeightedLoad: number;
  utilizationRatio: number;
  taskCount: number;
  avoidedTasksAssigned: number;
  preferredTasksAssigned: number;
  dailyMinutes: Record<DayOfWeek, number>;
  dailyWeightedLoad: Record<DayOfWeek, number>;
}

export interface OptimizationDiagnostics {
  totalHouseholdCapacityMinutes: number;
  totalHouseholdWorkMinutes: number;
  totalHouseholdWeightedWork: number;
  targetHouseholdUtilization: number;
  capacityDeficitMinutes: number;
  utilizationSpread: number;
  balanceScore: number;
  hardConstraintViolations: number;
  totalAssignments: number;
  totalUnassigned: number;
}

export interface OptimizationRequest {
  household: HouseholdInput;
  members: MemberInput[];
  tasks: TaskInput[];
  previousRunAssignments?: AssignmentOutput[];
  pinnedAssignmentIds?: string[];
}

export interface OptimizationResult {
  runId: string;
  householdId: string;
  mode: OptimizationMode;
  weeks: number;
  assignments: AssignmentOutput[];
  unassignedTasks: UnassignedTask[];
  memberSummaries: MemberWorkloadSummary[];
  diagnostics: OptimizationDiagnostics;
  diffSummary?: string[];
}
