export function normalizeBusinessSubscriptionStatus(status?: string | null): string {
  return (status ?? '').replace(/^pending_biz_/, '');
}

export function isPendingBusinessSubscriptionStatus(status?: string | null): boolean {
  return (status ?? '').startsWith('pending_biz_');
}

export function hasBusinessPortalAccess(role?: string | null, _subscriptionStatus?: string | null): boolean {
  return role === 'employer';
}
