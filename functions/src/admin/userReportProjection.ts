export interface AdminUserProfileProjection {
  uid: string;
  email: string | null;
  full_name: string | null;
  company_name: string | null;
  role: string | null;
  subscription_status: string | null;
  credits: number | null;
  created_at: string | null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalTimestamp(value: unknown): string | null {
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
  }
  return null;
}

/**
 * Returns the strict profile allowlist consumed by the admin support panel.
 * New user-document fields stay private until explicitly reviewed and added here.
 */
export function projectAdminUserProfile(
  uid: string,
  data: Record<string, unknown>,
  verifiedEmail?: string | null,
): AdminUserProfileProjection {
  const credits = typeof data.credits === "number" && Number.isFinite(data.credits)
    ? data.credits
    : null;

  return {
    uid,
    email: optionalString(verifiedEmail) ?? optionalString(data.email),
    full_name: optionalString(data.full_name),
    company_name: optionalString(data.company_name),
    role: optionalString(data.role),
    subscription_status: optionalString(data.subscription_status),
    credits,
    created_at: optionalTimestamp(data.created_at),
  };
}
