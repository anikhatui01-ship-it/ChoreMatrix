// src/optimizer/types.ts
var DAYS_OF_WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

// src/optimizer/weights.ts
var EFFORT_MULTIPLIERS = {
  1: 1,
  2: 1.25,
  3: 1.5,
  4: 1.85,
  5: 2.25
};
var OPTIMIZER_WEIGHTS = {
  WEIGHT_UTILIZATION: 1,
  PENALTY_AVOIDED_TASK: 50,
  BONUS_PREFERRED_TASK: 30,
  PENALTY_OFF_PREFERRED_DAY: 25,
  PENALTY_SPACING_VIOLATION: 100,
  PENALTY_ROTATION_STREAK: 45,
  PENALTY_DAILY_SPIKE: 60,
  PENALTY_CHURN: 35,
  // Churn penalty for moving an already assigned task during rebalance
  MAX_2OPT_ITERATIONS: 50
};
function getEffortMultiplier(effortLevel) {
  return EFFORT_MULTIPLIERS[effortLevel] ?? 1;
}
function calculateWeightedMinutes(durationMinutes, effortLevel) {
  const mult = getEffortMultiplier(effortLevel);
  return Math.round(durationMinutes * mult * 100) / 100;
}

// src/optimizer/normalizer.ts
function normalizeRequest(request) {
  const horizonWeeks = Math.max(1, Math.min(4, request.household.planningHorizonWeeks || 1));
  const memberMap = /* @__PURE__ */ new Map();
  for (const m of request.members) {
    const safeCapacity = Math.max(1, Number(m.weeklyCapacityMinutes) || 1);
    const unavailable = new Set(m.unavailableDays || []);
    const defaultDaily = Math.round(safeCapacity / 7 * 10) / 10;
    const dailyCap = {};
    for (const d of DAYS_OF_WEEK) {
      if (unavailable.has(d)) {
        dailyCap[d] = 0;
      } else if (m.dailyCapacityMinutes && m.dailyCapacityMinutes[d] !== void 0) {
        dailyCap[d] = Math.max(0, m.dailyCapacityMinutes[d]);
      } else {
        dailyCap[d] = defaultDaily;
      }
    }
    memberMap.set(m.id, {
      ...m,
      weeklyCapacityMinutes: safeCapacity,
      dailyCapacityMinutes: dailyCap,
      unavailableDays: Array.from(unavailable),
      preferredTaskIds: m.preferredTaskIds || [],
      avoidedTaskIds: m.avoidedTaskIds || []
    });
  }
  const validMemberIds = new Set(memberMap.keys());
  const taskMap = /* @__PURE__ */ new Map();
  const occurrences = [];
  let totalHouseholdWorkMinutes = 0;
  let totalHouseholdWeightedWork = 0;
  for (const t of request.tasks) {
    taskMap.set(t.id, t);
    const freq = Math.max(1, Math.min(14, Number(t.frequencyPerWeek) || 1));
    const duration = Math.max(1, Number(t.durationMinutes) || 1);
    const effortLevel = Math.max(1, Math.min(5, Number(t.effortLevel) || 1));
    const effortMultiplier = getEffortMultiplier(effortLevel);
    const weightedMinutes = calculateWeightedMinutes(duration, effortLevel);
    const exclusions = new Set(t.excludedMemberIds || []);
    let eligible = (t.eligibleMemberIds || []).filter(
      (id) => validMemberIds.has(id) && !exclusions.has(id)
    );
    const minSpacing = t.minSpacingDays !== void 0 ? t.minSpacingDays : freq > 1 ? Math.max(1, Math.floor(7 / freq)) : 0;
    for (let w = 0; w < horizonWeeks; w++) {
      for (let o = 0; o < freq; o++) {
        totalHouseholdWorkMinutes += duration;
        totalHouseholdWeightedWork += weightedMinutes;
        let fixedDay = void 0;
        if (t.fixedDays && t.fixedDays.length > 0) {
          fixedDay = t.fixedDays[o % t.fixedDays.length];
        }
        occurrences.push({
          occurrenceId: `${t.id}_w${w}_o${o}`,
          taskId: t.id,
          taskName: t.name,
          category: t.category,
          weekIndex: w,
          occurrenceIndex: o,
          durationMinutes: duration,
          effortLevel,
          effortMultiplier,
          weightedMinutes,
          eligibleMemberIds: eligible,
          fixedDay,
          preferredDays: t.preferredDays,
          minSpacingDays: minSpacing
        });
      }
    }
  }
  let totalWeeklyCapacity = 0;
  for (const m of memberMap.values()) {
    totalWeeklyCapacity += m.weeklyCapacityMinutes;
  }
  const totalHouseholdCapacityMinutes = totalWeeklyCapacity * horizonWeeks;
  const targetHouseholdUtilization = totalHouseholdCapacityMinutes > 0 ? totalHouseholdWeightedWork / totalHouseholdCapacityMinutes : 1;
  const capacityDeficitMinutes = Math.max(0, totalHouseholdWorkMinutes - totalHouseholdCapacityMinutes);
  return {
    horizonWeeks,
    totalHouseholdCapacityMinutes,
    totalHouseholdWorkMinutes,
    totalHouseholdWeightedWork,
    targetHouseholdUtilization,
    capacityDeficitMinutes,
    memberMap,
    taskMap,
    occurrences
  };
}

// src/optimizer/evaluator.ts
function checkHardConstraints(occurrence, member, day, currentMemberDayMinutes) {
  if (!occurrence.eligibleMemberIds.includes(member.id)) {
    return { valid: false, errorCode: "ERR_INELIGIBLE" };
  }
  if (member.unavailableDays && member.unavailableDays.includes(day)) {
    return { valid: false, errorCode: "ERR_UNAVAILABLE_DAY" };
  }
  if (occurrence.fixedDay && occurrence.fixedDay !== day) {
    return { valid: false, errorCode: "ERR_FIXED_DAY_MISMATCH" };
  }
  if (currentMemberDayMinutes + occurrence.durationMinutes > 1440) {
    return { valid: false, errorCode: "ERR_HARD_CAP_EXCEEDED" };
  }
  return { valid: true };
}
function evaluateCandidateScore(occurrence, member, day, ctx) {
  const reasons = [];
  let score = 0;
  const currentLoad = ctx.currentMemberWeightedLoad;
  const addedLoad = occurrence.weightedMinutes;
  const memberCap = Math.max(1, ctx.memberCapacity);
  if (ctx.mode === "capacity_aware") {
    const marginalCost = (2 * currentLoad * addedLoad + addedLoad * addedLoad) / memberCap;
    score += marginalCost * OPTIMIZER_WEIGHTS.WEIGHT_UTILIZATION * 5;
    const projectedUtil = (currentLoad + addedLoad) / memberCap;
    if (projectedUtil <= ctx.targetHouseholdUtilization * 1.1) {
      reasons.push("proportional_capacity_fit");
    }
  } else {
    const marginalCost = (2 * currentLoad * addedLoad + addedLoad * addedLoad) / 100;
    score += marginalCost * OPTIMIZER_WEIGHTS.WEIGHT_UTILIZATION;
    const projectedLoad = currentLoad + addedLoad;
    if (projectedLoad <= ctx.targetAverageLoad * 1.1) {
      reasons.push("equal_workload_fit");
    }
  }
  const isAvoided = member.avoidedTaskIds?.includes(occurrence.taskId);
  const isPreferred = member.preferredTaskIds?.includes(occurrence.taskId);
  if (isAvoided) {
    score += OPTIMIZER_WEIGHTS.PENALTY_AVOIDED_TASK * occurrence.effortLevel;
    reasons.push("avoided_task_tradeoff");
  } else if (isPreferred) {
    score -= OPTIMIZER_WEIGHTS.BONUS_PREFERRED_TASK * occurrence.effortLevel;
    reasons.push("preferred_task_match");
  }
  if (ctx.isOffPreferredDay) {
    score += OPTIMIZER_WEIGHTS.PENALTY_OFF_PREFERRED_DAY;
  } else if (occurrence.preferredDays && occurrence.preferredDays.includes(day)) {
    reasons.push("preferred_day_alignment");
  }
  if (ctx.violatesSpacing) {
    score += OPTIMIZER_WEIGHTS.PENALTY_SPACING_VIOLATION;
  }
  const projectedDayMinutes = ctx.memberDailyMinutes + occurrence.durationMinutes;
  if (ctx.memberDailyCapacity > 0 && projectedDayMinutes > ctx.memberDailyCapacity * 1.3) {
    score += OPTIMIZER_WEIGHTS.PENALTY_DAILY_SPIKE;
  }
  if (ctx.hasPriorWeekAssignment) {
    score += OPTIMIZER_WEIGHTS.PENALTY_ROTATION_STREAK * occurrence.effortLevel;
  }
  if (ctx.previousAssignedMemberId && ctx.previousAssignedMemberId !== member.id) {
    score += OPTIMIZER_WEIGHTS.PENALTY_CHURN;
  } else if (ctx.previousAssignedMemberId && ctx.previousAssignedMemberId === member.id) {
    reasons.push("preserved_from_previous_plan");
  }
  if (occurrence.eligibleMemberIds.length === 1) {
    reasons.push("only_eligible_member");
  }
  return { score, reasons };
}

// src/optimizer/scheduler.ts
function getDayIndex(day) {
  return DAYS_OF_WEEK.indexOf(day);
}
function getDayFromIndex(index) {
  const normalized = (index % 7 + 7) % 7;
  return DAYS_OF_WEEK[normalized];
}
function checkSpacingViolation(candidateDay, existingDaysForTask, minSpacingDays) {
  if (minSpacingDays <= 0 || existingDaysForTask.length === 0) {
    return false;
  }
  const candidateIndex = getDayIndex(candidateDay);
  for (const existing of existingDaysForTask) {
    const existingIndex = getDayIndex(existing);
    const diff = Math.abs(candidateIndex - existingIndex);
    if (diff < minSpacingDays) {
      return true;
    }
  }
  return false;
}
function getCandidateDays(fixedDay, preferredDays) {
  if (fixedDay) {
    return [fixedDay];
  }
  if (preferredDays && preferredDays.length > 0) {
    const set = new Set(preferredDays);
    const rest = DAYS_OF_WEEK.filter((d) => !set.has(d));
    return [...preferredDays, ...rest];
  }
  return [...DAYS_OF_WEEK];
}

// src/optimizer/rotation.ts
var RotationLedger = class {
  // Map<weekIndex, Map<taskId, Set<memberId>>>
  weeklyTaskOwners = /* @__PURE__ */ new Map();
  // Map<memberId, Map<taskId, number>>
  memberTaskCounts = /* @__PURE__ */ new Map();
  constructor(existingAssignments = []) {
    for (const a of existingAssignments) {
      this.recordAssignment(a.weekIndex, a.taskId, a.memberId);
    }
  }
  recordAssignment(weekIndex, taskId, memberId) {
    if (!this.weeklyTaskOwners.has(weekIndex)) {
      this.weeklyTaskOwners.set(weekIndex, /* @__PURE__ */ new Map());
    }
    const weekMap = this.weeklyTaskOwners.get(weekIndex);
    if (!weekMap.has(taskId)) {
      weekMap.set(taskId, /* @__PURE__ */ new Set());
    }
    weekMap.get(taskId).add(memberId);
    if (!this.memberTaskCounts.has(memberId)) {
      this.memberTaskCounts.set(memberId, /* @__PURE__ */ new Map());
    }
    const countMap = this.memberTaskCounts.get(memberId);
    countMap.set(taskId, (countMap.get(taskId) || 0) + 1);
  }
  hadAssignmentInWeek(weekIndex, taskId, memberId) {
    const weekMap = this.weeklyTaskOwners.get(weekIndex);
    if (!weekMap) return false;
    const owners = weekMap.get(taskId);
    return owners ? owners.has(memberId) : false;
  }
  hadAssignmentInPriorWeek(weekIndex, taskId, memberId) {
    if (weekIndex <= 0) return false;
    return this.hadAssignmentInWeek(weekIndex - 1, taskId, memberId);
  }
  getTaskCountForMember(memberId, taskId) {
    return this.memberTaskCounts.get(memberId)?.get(taskId) || 0;
  }
};

// src/optimizer/engine.ts
function runOptimization(request) {
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const normalized = normalizeRequest(request);
  const {
    horizonWeeks,
    totalHouseholdCapacityMinutes,
    totalHouseholdWorkMinutes,
    totalHouseholdWeightedWork,
    targetHouseholdUtilization,
    capacityDeficitMinutes,
    memberMap,
    occurrences
  } = normalized;
  const mode = request.household.mode || "capacity_aware";
  const memberList = Array.from(memberMap.values());
  const memberCount = memberList.length;
  const assignments = [];
  const unassignedTasks = [];
  const rotationLedger = new RotationLedger(request.previousRunAssignments || []);
  if (memberCount === 0) {
    for (const occ of occurrences) {
      unassignedTasks.push({
        occurrenceId: occ.occurrenceId,
        taskId: occ.taskId,
        taskName: occ.taskName,
        weekIndex: occ.weekIndex,
        occurrenceIndex: occ.occurrenceIndex,
        durationMinutes: occ.durationMinutes,
        weightedMinutes: occ.weightedMinutes,
        diagnosticCode: "ERR_NO_ELIGIBLE_MEMBERS",
        remediation: "Add at least one household member."
      });
    }
    return buildResult({
      runId,
      request,
      assignments: [],
      unassignedTasks,
      normalized,
      memberStates: /* @__PURE__ */ new Map()
    });
  }
  const previousAssignmentMap = /* @__PURE__ */ new Map();
  if (request.previousRunAssignments) {
    for (const pa of request.previousRunAssignments) {
      previousAssignmentMap.set(pa.occurrenceId, pa.memberId);
    }
  }
  const targetAverageWeeklyLoad = totalHouseholdCapacityMinutes > 0 ? totalHouseholdWeightedWork / (memberCount * horizonWeeks) : 0;
  const globalMemberStates = /* @__PURE__ */ new Map();
  for (const m of memberList) {
    globalMemberStates.set(m.id, {
      memberId: m.id,
      assignedMinutes: 0,
      assignedWeightedLoad: 0,
      dailyMinutes: createEmptyDayRecord(),
      dailyWeightedLoad: createEmptyDayRecord(),
      avoidedTasksCount: 0,
      preferredTasksCount: 0,
      taskCount: 0
    });
  }
  for (let w = 0; w < horizonWeeks; w++) {
    const weekOccurrences = occurrences.filter((o) => o.weekIndex === w);
    const weekTaskDays = /* @__PURE__ */ new Map();
    const sortedOccurrences = [...weekOccurrences].sort((a, b) => {
      if (a.eligibleMemberIds.length === 0 && b.eligibleMemberIds.length > 0) return -1;
      if (b.eligibleMemberIds.length === 0 && a.eligibleMemberIds.length > 0) return 1;
      const aFixed = a.fixedDay ? 1 : 0;
      const bFixed = b.fixedDay ? 1 : 0;
      if (aFixed !== bFixed) return bFixed - aFixed;
      if (a.eligibleMemberIds.length !== b.eligibleMemberIds.length) {
        return a.eligibleMemberIds.length - b.eligibleMemberIds.length;
      }
      if (b.weightedMinutes !== a.weightedMinutes) {
        return b.weightedMinutes - a.weightedMinutes;
      }
      if (b.minSpacingDays !== a.minSpacingDays) {
        return b.minSpacingDays - a.minSpacingDays;
      }
      return a.occurrenceId.localeCompare(b.occurrenceId);
    });
    const weekAssignments = [];
    for (const occ of sortedOccurrences) {
      if (occ.eligibleMemberIds.length === 0) {
        unassignedTasks.push({
          occurrenceId: occ.occurrenceId,
          taskId: occ.taskId,
          taskName: occ.taskName,
          weekIndex: occ.weekIndex,
          occurrenceIndex: occ.occurrenceIndex,
          durationMinutes: occ.durationMinutes,
          weightedMinutes: occ.weightedMinutes,
          diagnosticCode: "ERR_NO_ELIGIBLE_MEMBERS",
          remediation: `Assign at least one eligible household member to "${occ.taskName}".`
        });
        continue;
      }
      if (occ.fixedDay) {
        const anyEligibleAvailable = occ.eligibleMemberIds.some((mid) => {
          const m = memberMap.get(mid);
          return m && (!m.unavailableDays || !m.unavailableDays.includes(occ.fixedDay));
        });
        if (!anyEligibleAvailable) {
          unassignedTasks.push({
            occurrenceId: occ.occurrenceId,
            taskId: occ.taskId,
            taskName: occ.taskName,
            weekIndex: occ.weekIndex,
            occurrenceIndex: occ.occurrenceIndex,
            durationMinutes: occ.durationMinutes,
            weightedMinutes: occ.weightedMinutes,
            diagnosticCode: "ERR_ALL_ELIGIBLE_UNAVAILABLE",
            remediation: `All eligible members are unavailable on ${occ.fixedDay} for "${occ.taskName}". Update availability or allow flexible scheduling.`
          });
          continue;
        }
      }
      const candidateDays = getCandidateDays(occ.fixedDay, occ.preferredDays);
      const existingDaysForTask = weekTaskDays.get(occ.taskId) || [];
      let bestCandidate = null;
      for (const day of candidateDays) {
        const isOffPreferred = !!(occ.preferredDays && occ.preferredDays.length > 0 && !occ.preferredDays.includes(day));
        const violatesSpacing = checkSpacingViolation(day, existingDaysForTask, occ.minSpacingDays);
        for (const mid of occ.eligibleMemberIds) {
          const member = memberMap.get(mid);
          const mState2 = globalMemberStates.get(mid);
          const currentDayMinutes = mState2.dailyMinutes[day];
          const hardCheck = checkHardConstraints(occ, member, day, currentDayMinutes);
          if (!hardCheck.valid) {
            continue;
          }
          const hasPriorWeek = rotationLedger.hadAssignmentInPriorWeek(w, occ.taskId, mid);
          const memberDailyCap = member.dailyCapacityMinutes?.[day] || member.weeklyCapacityMinutes / 7;
          const { score, reasons } = evaluateCandidateScore(occ, member, day, {
            mode,
            targetHouseholdUtilization,
            targetAverageLoad: targetAverageWeeklyLoad * (w + 1),
            currentMemberWeightedLoad: mState2.assignedWeightedLoad,
            currentMemberMinutes: mState2.assignedMinutes,
            memberCapacity: member.weeklyCapacityMinutes * (w + 1),
            memberDailyMinutes: currentDayMinutes,
            memberDailyCapacity: memberDailyCap,
            hasPriorWeekAssignment: hasPriorWeek,
            isOffPreferredDay: isOffPreferred,
            violatesSpacing,
            previousAssignedMemberId: previousAssignmentMap.get(occ.occurrenceId)
          });
          if (!bestCandidate || score < bestCandidate.score) {
            bestCandidate = { memberId: mid, day, score, reasons };
          }
        }
      }
      if (!bestCandidate) {
        unassignedTasks.push({
          occurrenceId: occ.occurrenceId,
          taskId: occ.taskId,
          taskName: occ.taskName,
          weekIndex: occ.weekIndex,
          occurrenceIndex: occ.occurrenceIndex,
          durationMinutes: occ.durationMinutes,
          weightedMinutes: occ.weightedMinutes,
          diagnosticCode: "ERR_CONFLICTING_FIXED_SCHEDULE",
          remediation: `No available day/member satisfied the constraints for "${occ.taskName}". Check day caps and availability.`
        });
        continue;
      }
      const chosenMember = memberMap.get(bestCandidate.memberId);
      const mState = globalMemberStates.get(bestCandidate.memberId);
      mState.assignedMinutes += occ.durationMinutes;
      mState.assignedWeightedLoad += occ.weightedMinutes;
      mState.dailyMinutes[bestCandidate.day] += occ.durationMinutes;
      mState.dailyWeightedLoad[bestCandidate.day] += occ.weightedMinutes;
      mState.taskCount += 1;
      if (chosenMember.avoidedTaskIds?.includes(occ.taskId)) {
        mState.avoidedTasksCount += 1;
      }
      if (chosenMember.preferredTaskIds?.includes(occ.taskId)) {
        mState.preferredTasksCount += 1;
      }
      rotationLedger.recordAssignment(w, occ.taskId, bestCandidate.memberId);
      if (!weekTaskDays.has(occ.taskId)) {
        weekTaskDays.set(occ.taskId, []);
      }
      weekTaskDays.get(occ.taskId).push(bestCandidate.day);
      const assignment = {
        assignmentId: `asgn_${occ.occurrenceId}`,
        occurrenceId: occ.occurrenceId,
        taskId: occ.taskId,
        taskName: occ.taskName,
        category: occ.category,
        weekIndex: w,
        dayOfWeek: bestCandidate.day,
        memberId: bestCandidate.memberId,
        memberName: chosenMember.name,
        durationMinutes: occ.durationMinutes,
        effortLevel: occ.effortLevel,
        weightedMinutes: occ.weightedMinutes,
        reasonCodes: bestCandidate.reasons
      };
      weekAssignments.push(assignment);
      assignments.push(assignment);
    }
    runLocalSwapRefinement(weekAssignments, memberMap, globalMemberStates, mode, targetHouseholdUtilization);
  }
  return buildResult({
    runId,
    request,
    assignments,
    unassignedTasks,
    normalized,
    memberStates: globalMemberStates
  });
}
function runLocalSwapRefinement(assignments, memberMap, memberStates, mode, targetUtil) {
  let iterations = 0;
  let improved = true;
  while (improved && iterations < OPTIMIZER_WEIGHTS.MAX_2OPT_ITERATIONS) {
    improved = false;
    iterations++;
    for (let i = 0; i < assignments.length; i++) {
      for (let j = i + 1; j < assignments.length; j++) {
        const a1 = assignments[i];
        const a2 = assignments[j];
        if (a1.memberId === a2.memberId) continue;
        const m1 = memberMap.get(a1.memberId);
        const m2 = memberMap.get(a2.memberId);
        if (!m1 || !m2) continue;
      }
    }
  }
}
function createEmptyDayRecord() {
  return { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 };
}
function buildResult(params) {
  const { runId, request, assignments, unassignedTasks, normalized, memberStates } = params;
  const horizonWeeks = normalized.horizonWeeks;
  const memberSummaries = [];
  const memberList = Array.from(normalized.memberMap.values());
  const utilRatios = [];
  for (const m of memberList) {
    const state = memberStates.get(m.id) || {
      memberId: m.id,
      assignedMinutes: 0,
      assignedWeightedLoad: 0,
      dailyMinutes: createEmptyDayRecord(),
      dailyWeightedLoad: createEmptyDayRecord(),
      avoidedTasksCount: 0,
      preferredTasksCount: 0,
      taskCount: 0
    };
    const totalCapacity = m.weeklyCapacityMinutes * horizonWeeks;
    const utilRatio = totalCapacity > 0 ? state.assignedWeightedLoad / totalCapacity : 0;
    utilRatios.push(utilRatio);
    memberSummaries.push({
      memberId: m.id,
      memberName: m.name,
      role: m.role,
      weeklyCapacityMinutes: m.weeklyCapacityMinutes,
      assignedMinutes: Math.round(state.assignedMinutes * 10) / 10,
      assignedWeightedLoad: Math.round(state.assignedWeightedLoad * 10) / 10,
      utilizationRatio: Math.round(utilRatio * 1e3) / 1e3,
      taskCount: state.taskCount,
      avoidedTasksAssigned: state.avoidedTasksCount,
      preferredTasksAssigned: state.preferredTasksCount,
      dailyMinutes: state.dailyMinutes,
      dailyWeightedLoad: state.dailyWeightedLoad
    });
  }
  const minUtil = utilRatios.length ? Math.min(...utilRatios) : 0;
  const maxUtil = utilRatios.length ? Math.max(...utilRatios) : 0;
  const spread = Math.round((maxUtil - minUtil) * 1e3) / 1e3;
  const balanceScore = Math.max(0, Math.min(100, Math.round((1 - spread) * 100)));
  const diagnostics = {
    totalHouseholdCapacityMinutes: normalized.totalHouseholdCapacityMinutes,
    totalHouseholdWorkMinutes: normalized.totalHouseholdWorkMinutes,
    totalHouseholdWeightedWork: normalized.totalHouseholdWeightedWork,
    targetHouseholdUtilization: Math.round(normalized.targetHouseholdUtilization * 1e3) / 1e3,
    capacityDeficitMinutes: normalized.capacityDeficitMinutes,
    utilizationSpread: spread,
    balanceScore: isNaN(balanceScore) ? 100 : balanceScore,
    hardConstraintViolations: 0,
    totalAssignments: assignments.length,
    totalUnassigned: unassignedTasks.length
  };
  return {
    runId,
    householdId: request.household.id,
    mode: request.household.mode,
    weeks: horizonWeeks,
    assignments,
    unassignedTasks,
    memberSummaries,
    diagnostics
  };
}

// src/optimizer/rebalancer.ts
function rebalanceHousehold(request, previousAssignments) {
  const requestWithPrevious = {
    ...request,
    previousRunAssignments: previousAssignments
  };
  const result = runOptimization(requestWithPrevious);
  const diff = computeAssignmentDiff(previousAssignments, result.assignments);
  result.diffSummary = diff.explanations;
  return result;
}
function computeAssignmentDiff(previous, current) {
  const prevMap = /* @__PURE__ */ new Map();
  for (const a of previous) {
    prevMap.set(a.occurrenceId, a);
  }
  const explanations = [];
  let changed = 0;
  let preserved = 0;
  for (const curr of current) {
    const prev = prevMap.get(curr.occurrenceId);
    if (!prev) {
      explanations.push(`New task occurrence "${curr.taskName}" assigned to ${curr.memberName} on ${curr.dayOfWeek.toUpperCase()}.`);
      continue;
    }
    if (prev.memberId !== curr.memberId || prev.dayOfWeek !== curr.dayOfWeek) {
      changed++;
      const reasonPart = curr.reasonCodes.length ? ` (reason: ${curr.reasonCodes.join(", ")})` : "";
      if (prev.memberId !== curr.memberId && prev.dayOfWeek !== curr.dayOfWeek) {
        explanations.push(`"${curr.taskName}" moved from ${prev.memberName} on ${prev.dayOfWeek.toUpperCase()} to ${curr.memberName} on ${curr.dayOfWeek.toUpperCase()}${reasonPart}.`);
      } else if (prev.memberId !== curr.memberId) {
        explanations.push(`"${curr.taskName}" reassigned from ${prev.memberName} to ${curr.memberName} on ${curr.dayOfWeek.toUpperCase()}${reasonPart}.`);
      } else {
        explanations.push(`"${curr.taskName}" rescheduled from ${prev.dayOfWeek.toUpperCase()} to ${curr.dayOfWeek.toUpperCase()} for ${curr.memberName}.`);
      }
    } else {
      preserved++;
    }
  }
  return {
    changedAssignmentsCount: changed,
    preservedAssignmentsCount: preserved,
    explanations
  };
}
export {
  DAYS_OF_WEEK,
  EFFORT_MULTIPLIERS,
  OPTIMIZER_WEIGHTS,
  RotationLedger,
  calculateWeightedMinutes,
  checkHardConstraints,
  checkSpacingViolation,
  computeAssignmentDiff,
  evaluateCandidateScore,
  getCandidateDays,
  getDayFromIndex,
  getDayIndex,
  getEffortMultiplier,
  normalizeRequest,
  rebalanceHousehold,
  runOptimization
};
