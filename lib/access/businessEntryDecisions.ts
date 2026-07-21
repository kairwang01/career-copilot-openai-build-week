export type BusinessPortalActionDecision =
  | 'enter_portal'
  | 'open_signup'
  | 'open_business_access_prompt'
  | 'go_back';

export const DEFAULT_BUSINESS_ENTRY_PLAN = 'free';

export function requiresBusinessPlanPaymentConfirmation(planKey: string): boolean {
  return planKey !== DEFAULT_BUSINESS_ENTRY_PLAN;
}

export function shouldRedirectBusinessPlanToCheckout(
  planKey: string,
  status: string | null | undefined,
): boolean {
  return status === 'pending_payment' && requiresBusinessPlanPaymentConfirmation(planKey);
}

interface BusinessPortalActionInput {
  hasSession: boolean;
  canEnterBusinessPortal: boolean;
  hasPortalHandler: boolean;
}

export function decideBusinessPortalAction(input: BusinessPortalActionInput): BusinessPortalActionDecision {
  if (!input.hasSession) return 'open_signup';
  if (!input.canEnterBusinessPortal) return 'open_business_access_prompt';
  return input.hasPortalHandler ? 'enter_portal' : 'go_back';
}
