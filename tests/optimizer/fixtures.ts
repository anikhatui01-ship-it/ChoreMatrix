import type { OptimizationRequest } from '../../src/optimizer/types.ts';

export const coupleHouseholdFixture: OptimizationRequest = {
  household: {
    id: 'h_couple',
    name: 'Alex & Sam',
    type: 'couple',
    mode: 'capacity_aware',
    planningHorizonWeeks: 1,
  },
  members: [
    { id: 'm_alex', name: 'Alex', role: 'Adult', weeklyCapacityMinutes: 240 },
    { id: 'm_sam', name: 'Sam', role: 'Adult', weeklyCapacityMinutes: 240 },
  ],
  tasks: [
    { id: 't_cooking', name: 'Dinner cooking', category: 'Food', frequencyPerWeek: 7, durationMinutes: 30, effortLevel: 3, eligibleMemberIds: ['m_alex', 'm_sam'] },
    { id: 't_dishes', name: 'Dishes', category: 'Kitchen', frequencyPerWeek: 7, durationMinutes: 15, effortLevel: 2, eligibleMemberIds: ['m_alex', 'm_sam'] },
    { id: 't_laundry', name: 'Laundry', category: 'Laundry', frequencyPerWeek: 2, durationMinutes: 35, effortLevel: 3, eligibleMemberIds: ['m_alex', 'm_sam'] },
    { id: 't_bath', name: 'Bathroom clean', category: 'Cleaning', frequencyPerWeek: 1, durationMinutes: 45, effortLevel: 4, eligibleMemberIds: ['m_alex', 'm_sam'] },
    { id: 't_vacuum', name: 'Vacuum', category: 'Cleaning', frequencyPerWeek: 2, durationMinutes: 30, effortLevel: 2, eligibleMemberIds: ['m_alex', 'm_sam'] },
  ],
};

export const familyHouseholdFixture: OptimizationRequest = {
  household: {
    id: 'h_family',
    name: 'Maya Family',
    type: 'family',
    mode: 'capacity_aware',
    planningHorizonWeeks: 1,
  },
  members: [
    { id: 'm_maya', name: 'Maya', role: 'Adult', weeklyCapacityMinutes: 300 },
    { id: 'm_arjun', name: 'Arjun', role: 'Adult', weeklyCapacityMinutes: 240 },
    { id: 'm_riya', name: 'Riya', role: 'Teen', weeklyCapacityMinutes: 120 },
    { id: 'm_kabir', name: 'Kabir', role: 'Child', weeklyCapacityMinutes: 60 },
  ],
  tasks: [
    { id: 't_cooking', name: 'Dinner cooking', category: 'Food', frequencyPerWeek: 7, durationMinutes: 30, effortLevel: 3, eligibleMemberIds: ['m_maya', 'm_arjun'] },
    { id: 't_dishes', name: 'Kitchen reset', category: 'Kitchen', frequencyPerWeek: 7, durationMinutes: 15, effortLevel: 2, eligibleMemberIds: ['m_maya', 'm_arjun', 'm_riya'] },
    { id: 't_trash', name: 'Trash & recycling', category: 'Errands', frequencyPerWeek: 3, durationMinutes: 10, effortLevel: 1, eligibleMemberIds: ['m_maya', 'm_arjun', 'm_riya', 'm_kabir'] },
    { id: 't_bath', name: 'Bathroom deep clean', category: 'Cleaning', frequencyPerWeek: 1, durationMinutes: 45, effortLevel: 5, eligibleMemberIds: ['m_maya', 'm_arjun'] },
    { id: 't_vacuum', name: 'Vacuum floors', category: 'Cleaning', frequencyPerWeek: 2, durationMinutes: 30, effortLevel: 2, eligibleMemberIds: ['m_maya', 'm_arjun', 'm_riya'] },
    { id: 't_groceries', name: 'Grocery run', category: 'Errands', frequencyPerWeek: 1, durationMinutes: 60, effortLevel: 3, eligibleMemberIds: ['m_maya', 'm_arjun'] },
  ],
};
