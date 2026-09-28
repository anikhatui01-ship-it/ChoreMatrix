/**
 * ChoreMatrix Outgoing Email & Marketing Compliance Configuration
 *
 * Current Architecture:
 * - Transactional / Authentication: Handled exclusively via Supabase Auth (email verification, password reset).
 * - Marketing / Commercial: Strictly DISABLED by default (MARKETING_EMAILS_ENABLED = false).
 *
 * CAN-SPAM & Legal Compliance Requirements:
 * To enable marketing emails in the future, the following prerequisites are mandatory:
 * 1. Valid, verified sender identity and operational sender email (not a placeholder or fabricated address).
 * 2. Valid physical postal address of the legal operating entity.
 * 3. Functional one-click or automated unsubscribe mechanism.
 * 4. Active suppression list synchronization and unsubscribe processing within statutory deadlines (e.g. 10 business days).
 * 5. Explicit technical prohibition on sending to unsubscribed recipients.
 * 6. Clear commercial identification and non-deceptive subject lines.
 */

export interface MarketingEmailComplianceConfig {
  marketingEmailsEnabled: boolean;
  senderName?: string;
  senderEmail?: string;
  physicalPostalAddress?: string;
  hasUnsubscribeMechanism: boolean;
  hasSuppressionList: boolean;
}

/**
 * Central master switch for marketing email dispatch.
 * Must remain FALSE unless all legal, postal, and unsubscribe compliance requirements are satisfied.
 */
export const MARKETING_EMAILS_ENABLED: boolean = false;

export const MARKETING_EMAIL_CONFIG: MarketingEmailComplianceConfig = {
  marketingEmailsEnabled: false,
  senderName: undefined,
  senderEmail: undefined,
  physicalPostalAddress: undefined,
  hasUnsubscribeMechanism: false,
  hasSuppressionList: false,
};

/**
 * Validates whether marketing emails are legally and technically permissible to dispatch.
 * Refuses dispatch if compliance configuration or required sender/legal parameters are absent or placeholders.
 */
export function canSendMarketingEmail(config: MarketingEmailComplianceConfig = MARKETING_EMAIL_CONFIG): boolean {
  if (!config.marketingEmailsEnabled) {
    return false;
  }
  if (!config.senderEmail || config.senderEmail.includes('placeholder') || config.senderEmail === 'support@chorematrix.com') {
    return false;
  }
  if (!config.physicalPostalAddress || config.physicalPostalAddress.includes('placeholder')) {
    return false;
  }
  if (!config.hasUnsubscribeMechanism || !config.hasSuppressionList) {
    return false;
  }
  return true;
}

/**
 * Guard function that blocks any attempted dispatch of marketing emails without full compliance configuration.
 */
export function sendMarketingEmailGuard(recipient: string, templateId: string): void {
  if (!canSendMarketingEmail()) {
    throw new Error(
      `[Marketing Email Refusal] Outgoing marketing emails are disabled (MARKETING_EMAILS_ENABLED = false). Dispatch to ${recipient} (template: ${templateId}) blocked.`
    );
  }
}
