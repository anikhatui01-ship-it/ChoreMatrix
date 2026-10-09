/**
 * ChoreMatrix Early Feedback Service
 * Validates and submits feedback privately to Supabase user_feedback table.
 */

import { supabase, isSupabaseConfigured } from '../config/supabase.ts';

export type HouseholdType = 'couple' | 'roommates' | 'family' | 'living_alone' | 'other';

export interface FeedbackSubmission {
  householdType: HouseholdType;
  experienceRating?: number | null;
  usefulFeedback?: string;
  confusingFeedback?: string;
  improvementFeedback?: string;
  email?: string | null;
  allowQuote?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

const VALID_HOUSEHOLD_TYPES: HouseholdType[] = ['couple', 'roommates', 'family', 'living_alone', 'other'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateFeedbackInput(input: Partial<FeedbackSubmission>): ValidationResult {
  const errors: Record<string, string> = {};

  if (!input.householdType || !VALID_HOUSEHOLD_TYPES.includes(input.householdType as HouseholdType)) {
    errors.householdType = 'Please select a household type.';
  }

  if (input.experienceRating !== undefined && input.experienceRating !== null) {
    const rating = Number(input.experienceRating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      errors.experienceRating = 'Rating must be an integer between 1 and 5.';
    }
  }

  if (input.usefulFeedback && input.usefulFeedback.length > 2000) {
    errors.usefulFeedback = 'Useful feedback must not exceed 2,000 characters.';
  }

  if (input.confusingFeedback && input.confusingFeedback.length > 2000) {
    errors.confusingFeedback = 'Confusing feedback must not exceed 2,000 characters.';
  }

  if (input.improvementFeedback && input.improvementFeedback.length > 2000) {
    errors.improvementFeedback = 'Improvement feedback must not exceed 2,000 characters.';
  }

  if (input.email && input.email.trim().length > 0) {
    const emailTrimmed = input.email.trim();
    if (emailTrimmed.length > 255) {
      errors.email = 'Email address must not exceed 255 characters.';
    } else if (!EMAIL_REGEX.test(emailTrimmed)) {
      errors.email = 'Please provide a valid email address.';
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export async function submitUserFeedback(
  submission: FeedbackSubmission,
  currentUserId?: string | null,
  customClient?: any
): Promise<{ success: boolean; error?: string }> {
  const validation = validateFeedbackInput(submission);
  if (!validation.valid) {
    const firstError = Object.values(validation.errors)[0] || 'Invalid input.';
    return { success: false, error: firstError };
  }

  const client = customClient || supabase;

  if (!isSupabaseConfigured && !customClient) {
    // If Supabase is unconfigured (offline demo), return success mock safely without error
    return { success: true };
  }

  try {
    const payload = {
      user_id: currentUserId || null,
      household_type: submission.householdType,
      experience_rating: submission.experienceRating || null,
      useful_feedback: submission.usefulFeedback?.trim() || null,
      confusing_feedback: submission.confusingFeedback?.trim() || null,
      improvement_feedback: submission.improvementFeedback?.trim() || null,
      email: submission.email?.trim() || null,
      allow_quote: Boolean(submission.allowQuote),
    };

    const { error } = await client.from('user_feedback').insert(payload);

    if (error) {
      return { success: false, error: error.message || 'Failed to record feedback.' };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error submitting feedback.' };
  }
}
