import type { AssignmentOutput } from './types.ts';

export class RotationLedger {
  // Map<weekIndex, Map<taskId, Set<memberId>>>
  private weeklyTaskOwners: Map<number, Map<string, Set<string>>> = new Map();
  // Map<memberId, Map<taskId, number>>
  private memberTaskCounts: Map<string, Map<string, number>> = new Map();

  constructor(existingAssignments: AssignmentOutput[] = []) {
    for (const a of existingAssignments) {
      this.recordAssignment(a.weekIndex, a.taskId, a.memberId);
    }
  }

  public recordAssignment(weekIndex: number, taskId: string, memberId: string): void {
    if (!this.weeklyTaskOwners.has(weekIndex)) {
      this.weeklyTaskOwners.set(weekIndex, new Map());
    }
    const weekMap = this.weeklyTaskOwners.get(weekIndex)!;
    if (!weekMap.has(taskId)) {
      weekMap.set(taskId, new Set());
    }
    weekMap.get(taskId)!.add(memberId);

    if (!this.memberTaskCounts.has(memberId)) {
      this.memberTaskCounts.set(memberId, new Map());
    }
    const countMap = this.memberTaskCounts.get(memberId)!;
    countMap.set(taskId, (countMap.get(taskId) || 0) + 1);
  }

  public hadAssignmentInWeek(weekIndex: number, taskId: string, memberId: string): boolean {
    const weekMap = this.weeklyTaskOwners.get(weekIndex);
    if (!weekMap) return false;
    const owners = weekMap.get(taskId);
    return owners ? owners.has(memberId) : false;
  }

  public hadAssignmentInPriorWeek(weekIndex: number, taskId: string, memberId: string): boolean {
    if (weekIndex <= 0) return false;
    return this.hadAssignmentInWeek(weekIndex - 1, taskId, memberId);
  }

  public getTaskCountForMember(memberId: string, taskId: string): number {
    return this.memberTaskCounts.get(memberId)?.get(taskId) || 0;
  }
}
