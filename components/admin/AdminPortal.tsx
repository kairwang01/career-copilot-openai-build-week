import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import * as Select from '@radix-ui/react-select';
import { AlertTriangle, ArrowRight, Calendar, Check, ChevronDown, CircleHelp, RotateCcw, Search, Star, Trash2, UserPlus, X, Zap } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, type TooltipContentProps } from 'recharts';
import { data } from '@/lib/data';
import AdminSignIn from './AdminSignIn';
import { AdminAccessDenied, AdminVerifying, resolveRoleWithFallback } from './AdminAccessGate';
import AdminShell, { type AdminNavHelp } from './AdminShell';
import {
  ActionBadge,
  AuditDetails,
  Card,
  EmptyState,
  FieldLabel,
  PlanBadge,
  SaveButton,
  SectionHeading,
  SubsectionHeading,
  textInput,
} from './adminUi';
import {
  adminAdjustCredits,
  adminCheckAccess,
  adminCreateSampleAccounts,
  adminDeleteUser,
  adminDeleteModel,
  adminGetAuditLog,
  adminGetDashboard,
  adminGetLlmConfig,
  adminGetPrompts,
  adminGetQuotas,
  adminGetUserReport,
  adminInviteAdmin,
  adminListAdmins,
  adminListModels,
  adminListPromptVersions,
  adminListUsers,
  adminPublishPrompt,
  adminRemoveAdmin,
  adminResetPrompt,
  adminRollbackPrompt,
  adminSavePromptDraft,
  adminSetAdmin,
  adminSetAdminRole,
  adminSetDefaultModel,
  adminSetSubscription,
  adminTestModel,
  adminUpdateModelRouting,
  adminUpdateLlmConfig,
  adminUpdatePrompt,
  adminUpdateQuotas,
  adminUpsertModel,
  adminWhoAmI,
  normalizeModelRouting,
  type AdminDashboard,
  type AdminAccountDeletionResult,
  type AdminUserFilters,
  type AdminPlanKey,
  type AdminPlanQuota,
  type AdminQuotas,
  type AdminRow,
  type AdminSampleAccount,
  type AdminToolQuota,
  type AdminUserRow,
  type AuditLogEntry,
  type ModelClearableField,
  type ModelEntry,
  type ModuleRoutes,
  type PromptEntry,
  type PromptVersion,
  type RoutingPool,
  type TestModelResult,
} from '../../services/adminClient';
import { TOOL_CREDIT_COSTS } from '../../config/credits';
import { ADMIN_ROLE_DESCRIPTIONS, hasAdminPermission, type AdminRole } from '../../lib/access/permissions';
import { assignableSubscriptionPlansForRole } from '../../lib/access/subscriptionPlans';
import { PermissionMatrix, ProductRoleOverview } from './AccessControlSections';
import { KeyPoolHealthSection } from './KeyPoolHealthSection';
import { RoutingPoolsSection } from './RoutingPoolsSection';
import { ApiPlatformPanel } from './ApiPlatformPanel';
import { Web3SettingsPanel } from './Web3SettingsPanel';
import { LlmProviderIcon } from './LlmProviderIcon';
import Avatar from '../Avatar';
import { ToastProvider } from '../Toast';
import ConfirmActionDialog from '../ConfirmActionDialog';
import { ViewportAwareDialog } from '../ViewportAwareDialog';
import { useModalBehavior } from '../../hooks/useModalBehavior';
import { useSession } from '../../contexts/SessionContext';
import {
  getAdminPromptAudience as getPromptAudience,
  type AdminPromptAudience,
} from '../../lib/adminPromptAudience';

// Minimal i18n stub ? keys returned in StructuredOutput.
const STRINGS: Record<string, string> = {
  'admin.role.super': 'Super',
  'admin.role.admin': 'Admin',
  'admin.role.reviewer': 'Reviewer',
  'admin.admins.title': 'Admin Management',
  'admin.admins.subtitle': 'Invite admins and reviewers. Super-only. Every action is audit-logged.',
  'admin.admins.invite_label': 'Invite by email',
  'admin.admins.invite_placeholder': 'person@company.com',
  'admin.admins.invite_role': 'Role',
  'admin.admins.invite_btn': 'Invite',
  'admin.admins.empty': 'No admins listed.',
  'admin.admins.remove_confirm': 'Remove this admin/reviewer? They will lose access immediately.',
  'admin.admins.remove_btn': 'Remove',
  'admin.admins.change_role': 'Change role',
  'admin.admins.invited_at': 'Invited',
  'admin.admins.status': 'Status',
  'admin.prompts.save_draft': 'Save as draft',
  'admin.prompts.change_summary': 'Change summary (optional)',
  'admin.prompts.change_summary_placeholder': 'What changed and why...',
  'admin.prompts.publish': 'Publish',
  'admin.prompts.publish_confirm': 'Publish this version? It will take effect immediately for all users.',
  'admin.prompts.rollback': 'Roll back',
  'admin.prompts.rollback_confirm': 'Roll back to this version? It will become the active prompt immediately.',
  'admin.prompts.versions': 'Version History',
  'admin.prompts.versions_empty': 'No versions yet.',
  'admin.prompts.status_draft': 'draft',
  'admin.prompts.status_published': 'published',
  'admin.prompts.status_rolled_back': 'rolled back',
  'admin.credits.reason_label': 'Reason (required, 10-300 chars)',
  'admin.credits.reason_placeholder': 'e.g. Refund for failed job scan on 2026-06-01',
  'admin.credits.delta_constraint': 'Max +/-5000 credits per adjustment.',
  'admin.credits.apply': 'Apply',
  'admin.model.api_keys_label': 'API keys (one per line)',
  'admin.model.api_keys_placeholder': 'sk-... (new keys; existing masked keys listed below)',
  'admin.model.fallback_chain': 'Explicit model fallback chain',
  'admin.model.fallback_chain_hint': 'Tried in order only after this model key pool is exhausted on availability errors. Custom BYOA is not a platform fallback target.',
  'admin.model.priority': 'Priority',
  'admin.model.priority_hint': 'Lower numbers are tried earlier for implicit fallback. This is not traffic weight.',
  'admin.model.test_key': 'Test',
  'admin.model.masked_keys': 'Saved keys (masked)',
  'admin.model.default_badge': 'Default',
  'admin.model.set_default_btn': 'Set as default',
  'admin.set_default_confirm': 'Set this model as the fallback default when no module routing pool can serve the request?',
  'admin.model.set_default_ok': 'Default model updated.',
  'admin.dashboard.model_routing_title': 'Model Routing',
  'admin.dashboard.model_routing_default': 'Default model',
  'admin.dashboard.model_routing_default_hint': 'Used only when no module route or routing-pool candidate can serve the request.',
  'admin.dashboard.model_routing_chain': 'Explicit fallback for default model',
  'admin.dashboard.model_routing_no_chain': 'No explicit fallback. Runtime may still use implicit fallback by priority.',
  'admin.dashboard.model_routing_implicit': 'Implicit fallback preview',
  'admin.dashboard.model_routing_implicit_inactive': 'Implicit fallback is inactive because an explicit fallback chain is configured.',
  'admin.dashboard.model_routing_none': 'Not configured',
  'admin.access.reviewer_only': 'You have reviewer access. Dashboard, read-only Models & Keys, and Audit Log are available.',
  'admin_free_cap_help': 'Free-plan output-token ceiling. Requests from users whose subscription_status is free are capped at this many output tokens. Default 8192 = Gemini Flash native max (no artificial truncation). Lower this value to create a clearer free vs paid quality boundary.',
  'admin.dashboard.model_routing_select': 'Change default model',
};
const t = (key: string) => STRINGS[key] ?? key;

const FALLBACK_PREVIEW_TIERS = ['free', 'paid', 'business'] as const;

type Tab = 'dashboard' | 'ai' | 'prompts' | 'quotas' | 'users' | 'admins' | 'billing' | 'apiplatform' | 'web3' | 'audit';
type AccessControlTab = 'permissions' | 'product' | 'console' | 'reviewers';
type ModelSectionId = 'routing' | 'health' | 'credentials' | 'registry';
type QuotaSectionId = 'global' | 'plans' | 'tools' | 'posting' | 'interview';
type SharedCredentialProvider = 'gemini' | 'kairllm' | 'deepseek';

const ModelFormSelect: React.FC<{
  id: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}> = ({ id, value, options, onChange }) => (
  <Select.Root value={value} onValueChange={onChange}>
    <Select.Trigger id={id} className={`${textInput} flex items-center justify-between gap-2 text-left`}>
      <Select.Value />
      <Select.Icon asChild>
        <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
      </Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Content
        position="popper"
        sideOffset={6}
        collisionPadding={8}
        className="z-[120] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl ring-1 ring-black/5"
      >
        <Select.Viewport className="p-1">
          {options.map((option) => (
            <Select.Item
              key={option.value}
              value={option.value}
              className="relative flex cursor-pointer select-none items-center rounded-md py-2 pl-8 pr-3 text-sm text-gray-700 outline-none data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-800"
            >
              <Select.ItemIndicator className="absolute left-2 inline-flex items-center">
                <Check className="h-4 w-4" />
              </Select.ItemIndicator>
              <Select.ItemText>{option.label}</Select.ItemText>
            </Select.Item>
          ))}
        </Select.Viewport>
      </Select.Content>
    </Select.Portal>
  </Select.Root>
);

// Ordered by how often an operator touches each surface: registry and routing
// first, health next, shared credentials last because most models use key pools.
const MODEL_SECTIONS: { id: ModelSectionId; label: string }[] = [
  { id: 'registry', label: 'Model Registry' },
  { id: 'routing', label: 'Routing Pools' },
  { id: 'health', label: 'Key Health' },
  { id: 'credentials', label: 'Shared Credentials' },
];

const QUOTA_SECTIONS: { id: QuotaSectionId; label: string }[] = [
  { id: 'global', label: 'Global Quotas' },
  { id: 'plans', label: 'Plan Quotas' },
  { id: 'posting', label: 'Employer Posting' },
  { id: 'tools', label: 'Tool Access' },
  { id: 'interview', label: 'Mock Interview' },
];

const TOOL_CHART_COLORS = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#4f46e5', '#65a30d'];

type ToolUsageRow = { tool: string; runs: number; credits?: number };

const usageEventStatusLabel = (event: Record<string, unknown>): string => {
  const status = typeof event.status === 'string' ? event.status : 'unknown';
  if (
    status === 'deducted' &&
    event.refund_status === 'refunded' &&
    (event.refund_usage_counter_status === 'counter_underflow' ||
      event.refund_usage_counter_status === 'unknown_day')
  ) {
    return 'deducted · refunded · counter review';
  }
  return status === 'deducted' && event.refund_status === 'refunded'
    ? 'deducted · refunded'
    : status;
};

const usageEventCreditLabel = (event: Record<string, unknown>): string => {
  const amount = Number(event.credit_cost ?? 0);
  const boundedAmount = Number.isFinite(amount) ? amount : 0;
  if (event.status === 'deducted' && event.refund_status === 'refunded') {
    return `-${boundedAmount} cr · restored`;
  }
  if (event.status === 'deducted') return `-${boundedAmount} cr`;
  if (event.status === 'refunded') return `+${boundedAmount} cr restored`;
  return `${boundedAmount} cr`;
};

const UsagePieChart: React.FC<{
  data: ToolUsageRow[];
  dataKey: 'runs' | 'credits';
  label: string;
  valueLabel: string;
}> = ({ data, dataKey, label, valueLabel }) => {
  const chartData = data.filter((row) => Number(row[dataKey] ?? 0) > 0);
  const total = chartData.reduce((sum, row) => sum + Number(row[dataKey] ?? 0), 0);
  const renderTooltip = ({ active, payload }: TooltipContentProps) => {
    const entry = payload?.[0];
    const value = Number(entry?.value ?? 0);
    if (!active || !entry || value <= 0) return null;
    const percent = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
    const row = entry.payload as ToolUsageRow | undefined;

    return (
      <div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg">
        <p className="mb-1 font-mono font-semibold text-gray-900">{row?.tool ?? entry.name}</p>
        <p className="text-gray-600">
          {valueLabel}: <span className="font-semibold tabular-nums text-gray-900">{value.toLocaleString()}</span>
        </p>
        <p className="text-gray-600">
          Share: <span className="font-semibold tabular-nums text-gray-900">{percent}%</span>
        </p>
      </div>
    );
  };

  if (chartData.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-gray-500">
        No chart data.
      </div>
    );
  }

  return (
    <div className="h-56 w-full min-w-0">
      <p className="mb-2 text-center text-[11px] font-medium uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <ResponsiveContainer width="100%" height="85%">
        <PieChart>
          <Pie
            data={chartData}
            dataKey={dataKey}
            nameKey="tool"
            innerRadius="56%"
            outerRadius="82%"
            paddingAngle={2}
            stroke="none"
          >
            {chartData.map((row, index) => (
              <Cell key={row.tool} fill={TOOL_CHART_COLORS[index % TOOL_CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={renderTooltip} />
        </PieChart>
      </ResponsiveContainer>
      <p className="text-center text-xs text-gray-500">
        Total {total.toLocaleString()}
      </p>
    </div>
  );
};

// Keep this in sync with admin page behavior, role permissions, and sidebar changes.
const ADMIN_TAB_HELP: Record<Tab, AdminNavHelp> = {
  dashboard: {
    description: 'Overview of bounded usage and user aggregates with explicit partial-data warnings, 7-day credit-metered-attempt and net-credit charts, separate uncharged call volume, revenue, quotas, read-only model routing status, pending usage-counter reconciliation alerts, and a fail-visible outage warning when no AI provider credential is configured for roles with model read access. Refunded failures keep an abuse-control attempt but contribute zero net credits. Linked dashboard titles open the relevant admin page when permitted. If fine-grained role lookup is unavailable, navigation fails closed to reviewer/read-only access.',
    roles: {
      super: 'View dashboard data, read-only model routing status, and the missing-provider-credential outage warning.',
      admin: 'View dashboard data, masked model routing status, and the missing-provider-credential outage warning.',
      reviewer: 'View dashboard data, masked model routing status, and the missing-provider-credential outage warning.',
    },
  },
  ai: {
    description: 'Manage the transaction-safe model registry, per-model caller access, API key pools, grouped module routing pools for candidate, employer, agency, and public API AI routes, explicit platform-model fallback, shared builtin credentials with explicit save feedback, backend-computed implicit fallback previews, strict timeout-bound live connection probes, and bounded best-effort runtime key-health checks for currently configured keys. The dashboard outage action opens the Shared Credentials section directly. Model deletion cleans saved references and requires selecting another default first. If the deployed backend omits the authoritative routing contract, the page fails closed instead of inventing client-side defaults.',
    roles: {
      super: 'View and transactionally edit models, per-model caller access, key pools, grouped module routing pools across product areas, explicit fallback chains, and shared builtin credentials with explicit save feedback; recover a missing-provider outage through the dashboard shortcut. Also run strict timeout-bound live connection probes and manage the platform default model used only as a fallback. Deletion removes routing/fallback references and cannot remove the active default. Module selections expand to the underlying tool routes; routing-pool failover order is separate from caller access; implicit fallback previews are read-only and computed by the backend.',
      admin: 'View masked model, caller-access, key-pool, routing-pool, fallback, implicit-preview, and runtime-health settings without editing.',
      reviewer: 'View masked model, caller-access, key-pool, routing-pool, fallback, implicit-preview, and runtime-health settings without editing.',
    },
  },
  prompts: {
    description: 'Review and maintain tool and handler prompts used by AI features, with type, module, and authoritative candidate, employer, agency, admin/internal, shared, and legacy audience labels and filters.',
    roles: {
      super: 'Filter prompts by type, module, and authoritative audience; edit drafts, publish versions, and roll back prompt history.',
      admin: 'Filter prompts by type, module, and authoritative audience; view prompts and save draft changes.',
    },
  },
  quotas: {
    description: 'Manage configurable global quota enforcement, role-aware subscription plan quotas, credit grants, metered-attempt limits, net credit-spend limits, tool credit costs, employer posting caps, and mock-interview access with sticky section shortcuts and unsaved-change warnings. Refunded failures retain an abuse-control attempt while their credits are removed from spend limits. Configurable zero/unlimited values and the off switch never disable the server safety ceilings of 10,000 platform attempts and 500 attempts per user per UTC day. Deprecated one-time posting SKUs remain visible only to support existing legacy entitlements and are closed to new assignment or checkout.',
    roles: {
      super: 'View and update quota enforcement, subscription plan limits, tool access, posting caps, and mock-interview access.',
      admin: 'View and update quota enforcement, subscription plan limits, tool access, posting caps, and mock-interview access.',
    },
  },
  users: {
    description: 'Search users, use role-aware plan filters, inspect metered attempts without double-counting refund or observation records, make atomically audited credit adjustments within daily safety caps, override currently assignable subscriptions within each user product role, and remove Auth access, private BYOA credentials, plus the parent user profile. Deprecated one-time posting SKUs can be filtered for legacy support but cannot be newly assigned. Account removal is blocked by active or unresolved recurring billing, rejects delayed checkout activation and credential recreation with a deletion tombstone, and explicitly inventories retained shared, financial, audit, Storage, and Stripe records; it is not full data erasure. Sample-account reset is super-only and server-environment gated.',
    roles: {
      super: 'View users, make atomically audited credit adjustments, override role-compatible subscriptions, remove non-console Auth/profile accounts after billing checks while reviewing retained cleanup items, manage admin access, and use sample-account reset only when explicitly enabled on the server.',
      admin: 'View users, make atomically audited credit adjustments, override role-compatible subscriptions, and remove non-console Auth/profile accounts after billing checks while reviewing retained cleanup items.',
    },
  },
  admins: {
    description: 'Control console access with the collapsible invitation form and review product/admin permission matrices, including the currently exposed product surfaces and quota boundaries.',
    roles: {
      super: 'Invite, remove, and change admin/reviewer roles for console users; view permission matrices.',
      admin: 'View reviewer accounts.',
    },
  },
  billing: {
    description: 'Feature in development and intentionally hidden from the production sidebar. Current role-compatible subscription overrides remain available from Users; there is no standalone billing-control surface yet.',
    roles: {
      super: 'Use audited role-compatible subscription overrides from Users. The standalone billing page remains hidden until it has complete controls and release approval.',
    },
  },
  apiplatform: {
    description: 'Manage server-backed API applications, scoped one-time keys, recent request logs, and exact sharded usage/quota summaries. Summary counters update asynchronously and may briefly lag the newest request log.',
    roles: {
      super: 'View usage and recent logs; create applications, issue scoped keys, change key status, and revoke keys.',
      admin: 'View API platform usage, recent logs, applications, and masked key metadata without issuing or mutating keys.',
    },
  },
  web3: {
    description: 'Manage the optional Web3 identity module, candidate wallet visibility, Sepolia preview/live runtime mode, and Proof-of-Talent contract address.',
    roles: {
      super: 'View and update Web3 module visibility and runtime contract settings.',
    },
  },
  audit: {
    description: 'Read paginated admin action logs for operational review.',
    roles: {
      super: 'View audit log entries.',
      admin: 'View audit log entries.',
      reviewer: 'View audit log entries.',
    },
  },
};

/** Per-key/model test result: key is a provider slug ('gemini'|'kairllm'|'deepseek') or a model id. */
type TestStatus = { state: 'idle' } | { state: 'running' } | ({ state: 'done' } & TestModelResult);

type AdminConfirmState = {
  title: string;
  description: string;
  detail?: string;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  run: () => Promise<void> | void;
};

const PLAN_KEYS: AdminPlanKey[] = [
  'free',
  'essentials',
  'accelerator',
  'executive',
  'starter',
  'growth',
  'pro',
  'single_post',
  'job_pack',
];

const PLAN_LABELS: Record<AdminPlanKey, string> = {
  free: 'Free',
  essentials: 'Essentials',
  accelerator: 'Accelerator',
  executive: 'Executive',
  starter: 'Business Starter',
  growth: 'Business Growth',
  pro: 'Business Pro',
  single_post: 'Single Post',
  job_pack: 'Job Pack',
};

const PLAN_GROUPS: { label: string; description: string; plans: AdminPlanKey[] }[] = [
  {
    label: 'Shared free plan',
    description: 'Used by candidate, employer, and agency accounts until a role-specific paid plan is active.',
    plans: ['free'],
  },
  {
    label: 'Candidate subscriptions',
    description: 'Jobseeker plans that control saved AI results, credits, and candidate tool access.',
    plans: ['essentials', 'accelerator', 'executive'],
  },
  {
    label: 'Employer subscriptions',
    description: 'Business plans and posting packs that control hiring tools, credits, and active job caps.',
    plans: ['starter', 'growth', 'pro', 'single_post', 'job_pack'],
  },
];

const PLAN_GROUP_LABEL_BY_PLAN = Object.fromEntries(
  PLAN_GROUPS.flatMap((group) => group.plans.map((plan) => [plan, group.label])),
) as Record<AdminPlanKey, string>;

type UserFilterOption =
  | { type?: 'option'; value: string; label: string }
  | { type: 'header'; label: string; description?: string; dividerBefore?: boolean };

const USER_PLAN_FILTER_OPTIONS: readonly UserFilterOption[] = [
  {
    type: 'header',
    label: 'Shared free plan',
    description: 'Free is shared; combine with Role to isolate candidate, employer, or agency free users.',
  },
  { value: 'free', label: 'Free (shared: candidate / employer / agency)' },
  {
    type: 'header',
    label: 'Candidate role plans',
    description: 'Use with Role = candidate for candidate-only views.',
    dividerBefore: true,
  },
  { value: 'essentials', label: 'Candidate Essentials' },
  { value: 'accelerator', label: 'Candidate Accelerator' },
  { value: 'executive', label: 'Candidate Executive' },
  {
    type: 'header',
    label: 'Employer role plans',
    description: 'Use with Role = employer for employer-only views.',
    dividerBefore: true,
  },
  { value: 'starter', label: 'Employer Starter' },
  { value: 'growth', label: 'Employer Growth' },
  { value: 'pro', label: 'Employer Pro' },
  { value: 'single_post', label: 'Employer Single Post' },
  { value: 'job_pack', label: 'Employer Job Pack' },
];

const USER_PLAN_FILTER_LABELS = Object.fromEntries(
  USER_PLAN_FILTER_OPTIONS
    .filter((option): option is Extract<UserFilterOption, { value: string }> => option.type !== 'header')
    .map((option) => [option.value, option.label]),
) as Record<string, string>;

const USER_ROLE_OPTIONS = ['candidate', 'employer', 'agency'] as const;
type UserRole = (typeof USER_ROLE_OPTIONS)[number];

const USER_ROLE_BADGE_STYLES: Record<UserRole, string> = {
  candidate: 'border-blue-200 bg-blue-50 text-blue-700 ring-blue-100',
  employer: 'border-emerald-200 bg-emerald-50 text-emerald-700 ring-emerald-100',
  agency: 'border-violet-200 bg-violet-50 text-violet-700 ring-violet-100',
};

const formatUserRoleLabel = (role: string) =>
  USER_ROLE_OPTIONS.includes(role as UserRole)
    ? role.charAt(0).toUpperCase() + role.slice(1)
    : role;

const USER_CREATED_FILTERS = [
  { value: '', label: 'Any time' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
] as const;

const USER_PAGE_SIZE = 10;
const AUDIT_PAGE_SIZE = 25;

const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  reviewer: 'Reviewer',
  admin: 'Admin',
  super: 'Super',
};

const formatAdminPortalError = (
  error: unknown,
  currentRole: AdminRole | null,
  action: string,
  fallback: string,
) => {
  const message = error instanceof Error ? error.message : '';
  const code = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : '';
  const permissionError =
    code === 'functions/permission-denied' ||
    message.includes('This admin action is blocked.') ||
    message.includes('This action requires the');

  if (!permissionError) return message || fallback;

  const roleLabel = currentRole ? ADMIN_ROLE_LABELS[currentRole] : 'Unknown';
  const roleSummary = currentRole ? ADMIN_ROLE_DESCRIPTIONS[currentRole] : 'Your current admin role could not be confirmed.';
  return [
    `Action blocked: ${action}.`,
    `Current admin role: ${roleLabel}.`,
    roleSummary,
    message || fallback,
  ].join(' ');
};

const UserAvatarThumb: React.FC<{ url?: string | null; label?: string | null; roleLabel?: string | null; size?: 'sm' | 'md' }> = ({ url, label, roleLabel, size = 'md' }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const classes = size === 'sm' ? 'h-8 w-8 text-xs' : 'h-9 w-9 text-sm';
  const initial = (label?.trim()?.[0] || '?').toUpperCase();
  const showImage = Boolean(url && !failed);
  const role = roleLabel?.trim();
  const roleBadgeClass = role && USER_ROLE_OPTIONS.includes(role as UserRole)
    ? USER_ROLE_BADGE_STYLES[role as UserRole]
    : 'border-slate-200 bg-slate-50 text-slate-600 ring-slate-100';
  return (
    <span className={`${classes} relative flex shrink-0 items-center justify-center`}>
      <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-slate-100 font-semibold text-slate-600 ring-1 ring-slate-200">
        {showImage ? (
          <img
            src={url ?? ''}
            alt={label ? `${label} avatar` : 'User avatar'}
            className="h-full w-full object-cover"
            onError={() => setFailed(true)}
          />
        ) : (
          initial
        )}
      </span>
      {role && size !== 'sm' && (
        <span className={`absolute -bottom-1.5 left-1/2 max-w-[4.75rem] -translate-x-1/2 truncate rounded-full border px-1.5 py-0.5 text-[9px] font-semibold leading-none shadow-sm ring-2 ring-white ${roleBadgeClass}`}>
          {formatUserRoleLabel(role)}
        </span>
      )}
    </span>
  );
};

const DEFAULT_PLAN_QUOTAS: Record<AdminPlanKey, AdminPlanQuota> = {
  free: { daily_run_limit: 10, daily_credit_limit: 0, monthly_credit_grant: 30, active_job_limit: 3 },
  essentials: { daily_run_limit: 0, daily_credit_limit: 0, monthly_credit_grant: 300, active_job_limit: 0 },
  accelerator: { daily_run_limit: 0, daily_credit_limit: 0, monthly_credit_grant: 1000, active_job_limit: 0 },
  executive: { daily_run_limit: 0, daily_credit_limit: 0, monthly_credit_grant: 3000, active_job_limit: 0 },
  starter: { daily_run_limit: 0, daily_credit_limit: 0, monthly_credit_grant: 3000, active_job_limit: 8 },
  growth: { daily_run_limit: 0, daily_credit_limit: 0, monthly_credit_grant: 8000, active_job_limit: 20 },
  pro: { daily_run_limit: 0, daily_credit_limit: 0, monthly_credit_grant: 20000, active_job_limit: 100 },
  single_post: { daily_run_limit: 0, daily_credit_limit: 0, monthly_credit_grant: 0, active_job_limit: 1 },
  job_pack: { daily_run_limit: 0, daily_credit_limit: 0, monthly_credit_grant: 0, active_job_limit: 5 },
};

const TOOL_KEYS = Object.keys(TOOL_CREDIT_COSTS).sort();

const PROMPT_GROUP_HELP: Record<string, string> = {
  'Tool prompts': 'Prompts used by model-backed tools routed through aiProxy/toolRegistry, usually tied to a visible tool or helper step.',
  'Handler prompts': 'Prompts used by dedicated backend handlers with their own auth, credit, or workflow logic, such as resume analysis, coach, cover letters, career path, and interviews.',
};

const PROMPT_TYPE_OPTIONS = [
  { value: 'tool', label: 'Tool prompts' },
  { value: 'handler', label: 'Handler prompts' },
] as const;

type PromptAudience = AdminPromptAudience;

const PROMPT_AUDIENCE_OPTIONS: Array<{ value: PromptAudience; label: string }> = [
  { value: 'candidate', label: 'Candidate' },
  { value: 'employer', label: 'Employer' },
  { value: 'agency', label: 'Agency' },
  { value: 'admin', label: 'Admin/Internal' },
  { value: 'shared', label: 'Shared' },
  { value: 'legacy', label: 'Legacy/Unused' },
];

const PROMPT_META: Record<string, { module: string; purpose: string }> = {
  extractTalentProfile: {
    module: 'Talent Profile',
    purpose: 'Parses a resume into the structured candidate profile used by apply flows and employer matching.',
  },
  applyResumeImprovements: {
    module: 'Resume Analysis',
    purpose: 'Rewrites the resume after the analysis flow suggests concrete improvements.',
  },
  convertResumeFormat: {
    module: 'Resume Formatter',
    purpose: 'Localizes a resume for a target job market while keeping it ATS-readable and factual.',
  },
  calculateCompatibility: {
    module: 'Resume Match',
    purpose: 'Scores a resume against one job description for candidate-job fit.',
  },
  findOpportunities: {
    module: 'Opportunity Finder',
    purpose: 'Finds broader job opportunities and job-search strategies, optionally with live search grounding.',
  },
  findOpportunitiesOffline: {
    module: 'Opportunity Finder',
    purpose: 'Fallback opportunity prompt used when live search grounding is disabled or quota-limited.',
  },
  optimizeLinkedInProfile: {
    module: 'LinkedIn Optimizer',
    purpose: 'Generates LinkedIn headline, summary, and experience improvements from the user resume.',
  },
  optimizeLinkedInProfileFromText: {
    module: 'LinkedIn Optimizer',
    purpose: 'Improves an existing LinkedIn profile using profile text, resume context, and optional admin/user guidance.',
  },
  generateSkillBridgeProject: {
    module: 'Skill Learning Planner',
    purpose: 'Suggests a portfolio project that bridges one target skill toward a desired role.',
  },
  generateAgilePracticeTest: {
    module: 'Agile Coach',
    purpose: 'Creates agile certification practice questions, answers, and study tips.',
  },
  generateSalaryNegotiationStrategy: {
    module: 'Salary Negotiator',
    purpose: 'Builds a negotiation strategy for a specific offer, company, location, and candidate background.',
  },
  analyzeEnglishProficiency: {
    module: 'English Pro',
    purpose: 'Reviews professional email writing and returns IELTS-style level, corrections, and cultural guidance.',
  },
  generateSpeakingTopics: {
    module: 'English Pro',
    purpose: 'Creates speaking-practice topics for the user target IELTS band.',
  },
  analyzeSpokenEnglish: {
    module: 'English Pro',
    purpose: 'Scores a spoken transcript for clarity, pace, filler words, and improvement areas.',
  },
  generateReadingPracticePassage: {
    module: 'English Pro',
    purpose: 'Creates a reading passage and comprehension questions for IELTS-style practice.',
  },
  analyzeEnglishReading: {
    module: 'English Pro',
    purpose: 'Summarizes a reading text and extracts vocabulary plus comprehension questions.',
  },
  evaluateReadingComprehension: {
    module: 'English Pro',
    purpose: 'Grades user answers against generated reading-comprehension questions.',
  },
  analyzeEnglishListening: {
    module: 'English Pro',
    purpose: 'Compares a user transcription with the source text and explains listening mistakes.',
  },
  generateVocabularyFlashcards: {
    module: 'English Pro',
    purpose: 'Creates vocabulary flashcards and distractors for IELTS-level practice.',
  },
  generateProfessionalEmail: {
    module: 'Email Crafter',
    purpose: 'Drafts a professional email from scenario, tone, style, market, and resume context.',
  },
  generateOutreachEmail: {
    module: 'Legacy Outreach',
    purpose: 'Legacy candidate-to-employer outreach template. Current employer outreach uses generateEmployerOutreachEmail.',
  },
  generateEmployerOutreachEmail: {
    module: 'Employer Outreach',
    purpose: 'Writes employer-to-candidate outreach email from the hiring portal Talent Discovery flow.',
  },
  generatePortfolioWebsite: {
    module: 'Portfolio Website Builder',
    purpose: 'Turns resume facts into structured content for a candidate portfolio website.',
  },
  generateWeeklySummary: {
    module: 'Dashboard Summary',
    purpose: 'Summarizes weekly usage/activity data for reporting surfaces.',
  },
  generateJobDescription: {
    module: 'Employer Job Posting',
    purpose: 'Drafts a job description from title, company, responsibilities, and company context.',
  },
  analyzeSalary: {
    module: 'Employer Job Posting',
    purpose: 'Estimates salary ranges for a job title and location, with optional job-description context.',
  },
  checkInclusivity: {
    module: 'Employer Job Posting',
    purpose: 'Flags biased or exclusionary wording in a job description and suggests inclusive alternatives.',
  },
  formatJobDescription: {
    module: 'Employer Job Posting',
    purpose: 'Cleans and structures a raw job description for publishing.',
  },
  analyzeCandidateMatch: {
    module: 'Applicant Funnel',
    purpose: 'Scores an applicant resume against a job and returns strengths, gaps, and screening questions.',
  },
  generateNetworkingStrategy: {
    module: 'Networking Assistant',
    purpose: 'Creates a networking plan and outreach messages for a target company, role, and location.',
  },
  generatePerformanceReviewPrep: {
    module: 'Performance Review Prep',
    purpose: 'Turns role and accomplishment notes into review talking points and growth areas.',
  },
  generateLearningPlan: {
    module: 'Skill Learning Planner',
    purpose: 'Builds a phased learning plan and project ideas for one target skill.',
  },
  findIndustryEvents: {
    module: 'Industry Event Scout',
    purpose: 'Finds relevant industry events by field and location using live search.',
  },
  anonymizeResume: {
    module: 'Agency Hub',
    purpose: 'Creates an anonymized candidate resume for recruiting agency sharing.',
  },
  generateClientPitchEmail: {
    module: 'Agency Hub',
    purpose: 'Drafts a client-facing pitch email for a candidate, optionally tied to a job description.',
  },
  generateCandidatePrepKit: {
    module: 'Agency Hub + Interview Prep',
    purpose: 'Shared prep-kit prompt. Agency Hub uses the flat weak-spots/key-projects/predicted-questions summary; the candidate Interview Prep tool uses the evidence-driven layer (evidence-ranked questions, resume anchors, project follow-up chains, gap risks, practice plan).',
  },
  handler_resume_analysis: {
    module: 'Resume Analysis',
    purpose: 'Dedicated text-resume analysis handler that scores, critiques, and extracts improvement guidance.',
  },
  handler_resume_analysis_image: {
    module: 'Resume Analysis',
    purpose: 'Dedicated image-resume handler that transcribes resume images before scoring and critique.',
  },
  handler_mock_interview_generate: {
    module: 'Mock Interview',
    purpose: 'Generates role-specific interview questions from resume and job description.',
  },
  handler_mock_interview_eval: {
    module: 'Mock Interview',
    purpose: 'Grades one interview answer and returns focused coaching plus a model answer.',
  },
  handler_mock_interview_session_eval: {
    module: 'Mock Interview',
    purpose: 'Evaluates the full timed interview transcript and returns a hire-style verdict.',
  },
  handler_career_coach_base: {
    module: 'Career Coach',
    purpose: 'Base system instruction for the general AI career coach chat.',
  },
  handler_career_coach_candidate: {
    module: 'Career Coach',
    purpose: 'Candidate-specific coach instruction that uses resume context for job-search advice.',
  },
  handler_career_coach_employer: {
    module: 'Career Coach',
    purpose: 'Employer-specific coach instruction for hiring, sourcing, screening, and talent advice.',
  },
  handler_cover_letter: {
    module: 'Cover Letter Generator',
    purpose: 'Dedicated handler prompt for writing a tailored cover letter from resume and job description.',
  },
  handler_career_path: {
    module: 'Career Path Planner',
    purpose: 'Dedicated handler prompt for career transition analysis, skill gaps, roadmap, and bridge roles.',
  },
  handler_extract_url: {
    module: 'URL Resume Import',
    purpose: 'Extracts resume/profile content from fetched HTML while removing site chrome and unrelated text.',
  },
};

const PROMPT_MODULE_STYLES = [
  'border-blue-200 bg-blue-50 text-blue-800',
  'border-emerald-200 bg-emerald-50 text-emerald-800',
  'border-amber-200 bg-amber-50 text-amber-800',
  'border-violet-200 bg-violet-50 text-violet-800',
  'border-cyan-200 bg-cyan-50 text-cyan-800',
  'border-rose-200 bg-rose-50 text-rose-800',
  'border-indigo-200 bg-indigo-50 text-indigo-800',
  'border-teal-200 bg-teal-50 text-teal-800',
] as const;

const getPromptMeta = (key: string) => PROMPT_META[key] ?? {
  module: 'Unmapped',
  purpose: 'No module mapping found yet. Check functions/src/llm/prompts.ts and toolRegistry.ts.',
};

const getPromptType = (key: string) => (key.startsWith('handler_') ? 'handler' : 'tool');

const getPromptAudienceLabel = (audience: PromptAudience) =>
  PROMPT_AUDIENCE_OPTIONS.find((option) => option.value === audience)?.label ?? audience;

const PROMPT_AUDIENCE_STYLES: Record<PromptAudience, string> = {
  candidate: 'border-blue-200 bg-blue-50 text-blue-800',
  employer: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  agency: 'border-violet-200 bg-violet-50 text-violet-800',
  admin: 'border-slate-200 bg-slate-50 text-slate-700',
  shared: 'border-amber-200 bg-amber-50 text-amber-800',
  legacy: 'border-gray-200 bg-gray-50 text-gray-600',
};

const getPromptModuleStyle = (module: string) => {
  const index = module.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % PROMPT_MODULE_STYLES.length;
  return PROMPT_MODULE_STYLES[index];
};

// Per-field semantics for the plan-quota table. CRITICAL: `0` means different things -
// for daily runs/credits the runtime gate is `> 0` (so 0 = unlimited), but active_job
// uses `active >= limit` (so 0 = NONE allowed, blocks posting). monthly_grant is an
// amount, not a limit. Surfacing this prevents the classic "I set it to 0 = unlimited"
// misconfiguration.
const PLAN_QUOTA_FIELDS: { key: keyof AdminPlanQuota; header: string; tip: string; zeroLabel: string | null }[] = [
  { key: 'daily_run_limit', header: 'Daily attempts', tip: 'Max configurable metered tool attempts per day for this plan, including failures later refunded. 0 removes the plan cap but not the server safety ceiling of 500 attempts per user per UTC day; live plans should still use a deliberate nonzero value.', zeroLabel: 'Safety ceiling only' },
  { key: 'daily_credit_limit', header: 'Daily credits', tip: 'Max net credits a user on this plan can spend per day; settled refunds are removed. 0 = Unlimited.', zeroLabel: 'Unlimited' },
  { key: 'monthly_credit_grant', header: 'Monthly grant', tip: 'Credits granted at the start of each billing cycle. 0 = no grant.', zeroLabel: null },
  { key: 'active_job_limit', header: 'Active jobs', tip: 'Max simultaneously open job posts. 0 = none allowed, so employer posting is blocked until this is positive.', zeroLabel: 'None' },
];

const effectivePlanQuota = (quotas: AdminQuotas, plan: AdminPlanKey): AdminPlanQuota => ({
  ...DEFAULT_PLAN_QUOTAS[plan],
  ...(quotas.plan_quotas?.[plan] ?? {}),
});

const effectiveToolQuota = (quotas: AdminQuotas, tool: string): AdminToolQuota => ({
  enabled: quotas.tool_quotas?.[tool]?.enabled ?? true,
  credit_cost: Number(
    quotas.tool_quotas?.[tool]?.credit_cost ??
      TOOL_CREDIT_COSTS[tool as keyof typeof TOOL_CREDIT_COSTS] ??
      0,
  ),
  allowed_plans: (quotas.tool_quotas?.[tool]?.allowed_plans as AdminPlanKey[] | undefined) ?? [...PLAN_KEYS],
});

const normalizeQuotaSection = (quotas: AdminQuotas, section: QuotaSectionId) => {
  if (section === 'global') {
    return {
      daily_tool_run_limit: Number(quotas.daily_tool_run_limit ?? 0),
      daily_credit_spend_limit: Number(quotas.daily_credit_spend_limit ?? 0),
      per_user_daily_credit_limit: Number(quotas.per_user_daily_credit_limit ?? 0),
      enabled: quotas.enabled !== false,
      free_max_output_tokens: Number(quotas.free_max_output_tokens ?? 8192),
    };
  }
  if (section === 'plans') {
    return Object.fromEntries(
      PLAN_KEYS.map((plan) => [plan, effectivePlanQuota(quotas, plan)]),
    );
  }
  if (section === 'tools') {
    return Object.fromEntries(
      TOOL_KEYS.map((tool) => {
        const row = effectiveToolQuota(quotas, tool);
        return [tool, { ...row, allowed_plans: [...row.allowed_plans].sort() }];
      }),
    );
  }
  if (section === 'interview') {
    return {
      mi_min_tier: quotas.mi_min_tier === 'free' ? 'free' : 'paid',
      mi_report_unlock_credits: Number(quotas.mi_report_unlock_credits ?? 500),
    };
  }
  return {};
};

const quotaSectionChanged = (current: AdminQuotas, saved: AdminQuotas, section: QuotaSectionId) =>
  JSON.stringify(normalizeQuotaSection(current, section)) !== JSON.stringify(normalizeQuotaSection(saved, section));

const userFilterControl =
  'h-10 w-full rounded-lg border border-gray-200 bg-white text-sm text-gray-900 shadow-sm ' +
  'transition focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/10';

const userFilterIcon = 'pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400';

const formatCountLabel = (label: string, selectedLabels: string[]) => {
  if (selectedLabels.length === 0) return `All ${label.toLowerCase()}s`;
  if (selectedLabels.length === 1) return selectedLabels[0];
  return `${selectedLabels[0]} +${selectedLabels.length - 1}`;
};

const UserFilterDropdown: React.FC<{
  label: string;
  options: readonly UserFilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}> = ({ label, options, selected, onChange }) => {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const selectedLabels = options
    .filter((option): option is Extract<UserFilterOption, { value: string }> => option.type !== 'header')
    .filter((option) => selected.includes(option.value))
    .map((option) => option.label);

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      const details = detailsRef.current;
      if (details && !details.contains(event.target as Node)) details.removeAttribute('open');
    };

    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, []);

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  };

  return (
    <details ref={detailsRef} className="group relative">
      <summary
        className={`${userFilterControl} flex cursor-pointer list-none items-center justify-between gap-3 px-3 [&::-webkit-details-marker]:hidden`}
        aria-label={`Filter users by ${label.toLowerCase()}`}
      >
        <span className="min-w-0">
          <span className="block text-[11px] font-medium leading-3 text-gray-500">{label}</span>
          <span className="block truncate text-sm leading-5">{formatCountLabel(label, selectedLabels)}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-gray-400 transition group-open:rotate-180" />
      </summary>
      <div
        className="absolute left-0 top-full z-30 mt-2 w-60 overflow-hidden rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg"
        role="group"
        aria-label={`${label} filter options`}
      >
        {options.map((option) => {
          if (option.type === 'header') {
            return (
              <div key={`header-${option.label}`} className={option.dividerBefore ? 'mt-1.5 border-t border-gray-100 pt-2' : 'pb-1'}>
                <p className="px-2.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">{option.label}</p>
                {option.description && (
                  <p className="px-2.5 pt-0.5 text-[10px] leading-4 text-gray-400">{option.description}</p>
                )}
              </div>
            );
          }
          const checked = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => toggle(option.value)}
              aria-pressed={checked}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded border ${
                  checked ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-transparent'
                }`}
                aria-hidden="true"
              >
                <Check className="h-3 w-3" />
              </span>
              {option.label}
            </button>
          );
        })}
      </div>
    </details>
  );
};

const UserSingleFilterDropdown: React.FC<{
  label: string;
  options: readonly { value: string; label: string; icon?: React.ReactNode }[];
  value: string;
  onChange: (next: string) => void;
  leadingIcon?: React.ReactNode;
  ariaLabel?: string;
  menuClassName?: string;
}> = ({ label, options, value, onChange, leadingIcon, ariaLabel, menuClassName = 'w-60' }) => {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const groupName = useId();
  const selectedOption = options.find((option) => option.value === value) ?? options[0];
  const selectedLabel = selectedOption?.label ?? label;
  const closeAndRestoreFocus = () => {
    const details = detailsRef.current;
    details?.removeAttribute('open');
    details?.querySelector<HTMLElement>('summary')?.focus();
  };

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      const details = detailsRef.current;
      if (details && !details.contains(event.target as Node)) details.removeAttribute('open');
    };

    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, []);

  return (
    <details ref={detailsRef} className="group relative">
      <summary
        className={`${userFilterControl} flex cursor-pointer list-none items-center justify-between gap-3 px-3 [&::-webkit-details-marker]:hidden`}
        aria-label={ariaLabel ?? `Filter users by ${label.toLowerCase()}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {leadingIcon ?? selectedOption?.icon ?? <Calendar className="h-4 w-4 shrink-0 text-gray-400" />}
          <span className="min-w-0">
            <span className="block text-[11px] font-medium leading-3 text-gray-500">{label}</span>
            <span className="block truncate text-sm leading-5">{selectedLabel}</span>
          </span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-gray-400 transition group-open:rotate-180" />
      </summary>
      <div
        className={`absolute left-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg ${menuClassName}`}
        role="radiogroup"
        aria-label={`${label} filter options`}
      >
        {options.map((option) => {
          const checked = value === option.value;
          return (
            <label
              key={option.value}
              className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-50 focus-within:bg-gray-50"
            >
              <input
                type="radio"
                name={groupName}
                value={option.value}
                checked={checked}
                aria-checked={checked}
                onChange={() => {
                  onChange(option.value);
                  closeAndRestoreFocus();
                }}
                onClick={() => {
                  if (checked) closeAndRestoreFocus();
                }}
                className="peer sr-only"
              />
              <span
                className={`flex h-4 w-4 items-center justify-center rounded border peer-focus-visible:ring-2 peer-focus-visible:ring-blue-600 peer-focus-visible:ring-offset-2 ${
                  checked ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-transparent'
                }`}
                aria-hidden="true"
              >
                <Check className="h-3 w-3" />
              </span>
              {option.icon}
              {option.label}
            </label>
          );
        })}
      </div>
    </details>
  );
};

// Main component.

const AdminPortal: React.FC = () => {
  const { session, sessionResolved } = useSession();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [adminRole, setAdminRole] = useState<AdminRole | null>(null);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [accessTab, setAccessTab] = useState<AccessControlTab>('console');
  const [error, setError] = useState<string | null>(null);
  const [accountDeletionResult, setAccountDeletionResult] = useState<AdminAccountDeletionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  // per-tab data
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [llm, setLlm] = useState<Record<string, string>>({});
  const [llmLoaded, setLlmLoaded] = useState(false);
  const [quotas, setQuotas] = useState<AdminQuotas>({});
  const [savedQuotas, setSavedQuotas] = useState<AdminQuotas | null>(null);
  const [quotasLoadedAt, setQuotasLoadedAt] = useState<number | null>(null);
  const [activeModelSection, setActiveModelSection] = useState<ModelSectionId>('registry');
  const [modelNavScrolled, setModelNavScrolled] = useState(false);
  const [activeQuotaSection, setActiveQuotaSection] = useState<QuotaSectionId>('global');
  const [quotaNavScrolled, setQuotaNavScrolled] = useState(false);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [userCursor, setUserCursor] = useState<string | null>(null);
  const [userPageIndex, setUserPageIndex] = useState(0);
  const [userPageCursors, setUserPageCursors] = useState<(string | undefined)[]>([undefined]);
  const [userListLoading, setUserListLoading] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [debouncedUserSearch, setDebouncedUserSearch] = useState('');
  const [userRoleFilters, setUserRoleFilters] = useState<string[]>([]);
  const [userPlanFilters, setUserPlanFilters] = useState<string[]>([]);
  const [userCreatedFilter, setUserCreatedFilter] = useState('');
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  // Tracks the latest selected user so a slow report fetch for a previous user can't
  // paint its data under a user the admin has since switched to.
  const selectedUidRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const accountDialogRef = useRef<HTMLDivElement | null>(null);
  const modelPanelRef = useRef<HTMLDivElement | null>(null);
  const modelSectionRefs = useRef<Partial<Record<ModelSectionId, HTMLElement | null>>>({});
  const modelScrollTargetRef = useRef<ModelSectionId | null>(null);
  const quotaPanelRef = useRef<HTMLDivElement | null>(null);
  const quotaSectionRefs = useRef<Partial<Record<QuotaSectionId, HTMLElement | null>>>({});
  const quotaScrollTargetRef = useRef<QuotaSectionId | null>(null);
  const [userReport, setUserReport] = useState<Record<string, unknown> | null>(null);
  const [subStatus, setSubStatus] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [sampleAccounts, setSampleAccounts] = useState<AdminSampleAccount[] | null>(null);
  const [sampleAccountsLoading, setSampleAccountsLoading] = useState(false);
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [newAdmin, setNewAdmin] = useState('');
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const [auditPageIndex, setAuditPageIndex] = useState(0);
  const [auditPageCursors, setAuditPageCursors] = useState<(string | undefined)[]>([undefined]);
  const [auditLoaded, setAuditLoaded] = useState(false);

  // test-connection status: keyed by 'gemini'|'kairllm'|'deepseek' or model id
  const [testStatus, setTestStatus] = useState<Record<string, TestStatus>>({});

  const setTest = (key: string, status: TestStatus) =>
    setTestStatus((prev) => ({ ...prev, [key]: status }));

  // models tab
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null);
  const [routingPools, setRoutingPools] = useState<RoutingPool[]>([]);
  const [moduleRoutes, setModuleRoutes] = useState<ModuleRoutes>({});
  const [setDefaultFeedback, setSetDefaultFeedback] = useState<{ ok?: string; err?: string } | null>(null);
  // null = list view; 'new' = blank add form; ModelEntry = edit form
  const [modelForm, setModelForm] = useState<ModelEntry | 'new' | null>(null);
  const [modelSaving, setModelSaving] = useState(false);

  // prompts tab
  const [prompts, setPrompts] = useState<PromptEntry[]>([]);
  const [promptsLoaded, setPromptsLoaded] = useState(false);
  const [promptSearch, setPromptSearch] = useState('');
  const [promptTypeFilters, setPromptTypeFilters] = useState<string[]>([]);
  const [promptAudienceFilters, setPromptAudienceFilters] = useState<PromptAudience[]>([]);
  const [promptModuleFilters, setPromptModuleFilters] = useState<string[]>([]);
  const [expandedPromptKey, setExpandedPromptKey] = useState<string | null>(null);
  // per-row draft text (only kept for the currently-expanded row)
  const [promptDraft, setPromptDraft] = useState('');
  // per-row inline feedback: key -> { ok: string } | { err: string }
  const [promptFeedback, setPromptFeedback] = useState<Record<string, { ok?: string; err?: string }>>({});
  const [promptSaving, setPromptSaving] = useState(false);

  // model form fields (controlled separately so we don't mutate ModelEntry directly)
  const [mfId, setMfId] = useState('');
  const [mfLabel, setMfLabel] = useState('');
  const [mfProvider, setMfProvider] = useState<ModelEntry['provider']>('gemini');
  const [mfBuiltin, setMfBuiltin] = useState<ModelEntry['builtin'] | ''>('');
  const [mfBaseUrl, setMfBaseUrl] = useState('');
  const [mfApiKey, setMfApiKey] = useState('');
  const [mfProviderModel, setMfProviderModel] = useState('');
  const [mfMinTier, setMfMinTier] = useState<ModelEntry['minTier']>('free');
  const [mfEnabled, setMfEnabled] = useState(true);
  const [mfSupportsImageInput, setMfSupportsImageInput] = useState(false);

  // LLM form fields
  const [geminiKey, setGeminiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('');
  const [geminiFallbackModel, setGeminiFallbackModel] = useState('');
  const [kairllmKey, setKairllmKey] = useState('');
  const [kairllmUrl, setKairllmUrl] = useState('');
  const [deepseekKey, setDeepseekKey] = useState('');
  const [deepseekUrl, setDeepseekUrl] = useState('');
  // Which provider's credentials are shown ? single-select, like mainstream API
  // consoles, so only the chosen provider's config renders (no 3-card clutter).
  const [providerTab, setProviderTab] = useState<SharedCredentialProvider>('gemini');
  const [sharedCredentialFeedback, setSharedCredentialFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const [creditDelta, setCreditDelta] = useState('100');
  const [creditReason, setCreditReason] = useState('');
  const [creditAdjusting, setCreditAdjusting] = useState(false);

  // prompt lifecycle state
  const [promptChangeSummary, setPromptChangeSummary] = useState('');
  const [promptVersionsKey, setPromptVersionsKey] = useState<string | null>(null);
  const [promptVersions, setPromptVersions] = useState<PromptVersion[]>([]);
  const [promptVersionsLoading, setPromptVersionsLoading] = useState(false);
  const [promptVersionsFeedback, setPromptVersionsFeedback] = useState<{ ok?: string; err?: string } | null>(null);

  // model form extended fields
  const [mfApiKeys, setMfApiKeys] = useState(''); // textarea: one per line (new keys)
  const [mfFallbackChain, setMfFallbackChain] = useState<string[]>([]);
  const [mfPriority, setMfPriority] = useState('');

  // invite-admin form (super only)
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'reviewer'>('admin');
  const [inviteFeedback, setInviteFeedback] = useState<{ ok?: string; err?: string } | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [adminRoleFilters, setAdminRoleFilters] = useState<string[]>([]);

  // Current admin account panel.
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountName, setAccountName] = useState('');
  const [accountAvatarUrl, setAccountAvatarUrl] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [accountPasswordConfirm, setAccountPasswordConfirm] = useState('');
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountPasswordSaving, setAccountPasswordSaving] = useState(false);
  const [accountMessage, setAccountMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const closeAccountDialog = useCallback(() => setAccountOpen(false), []);
  useModalBehavior(closeAccountDialog, accountOpen, true, accountDialogRef);

  const [adminConfirm, setAdminConfirm] = useState<AdminConfirmState | null>(null);
  const [adminConfirmLoading, setAdminConfirmLoading] = useState(false);

  const userFilters = useMemo<AdminUserFilters>(() => {
    const filters: AdminUserFilters = {
      search: debouncedUserSearch.trim() || undefined,
      roles: userRoleFilters,
      plans: userPlanFilters,
    };
    const days = Number(userCreatedFilter.replace('d', ''));
    if (days > 0) {
      filters.created_after = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    }
    return filters;
  }, [debouncedUserSearch, userRoleFilters, userPlanFilters, userCreatedFilter]);

  const activeUserFilterTags = useMemo(() => [
    ...(debouncedUserSearch.trim()
      ? [{ key: 'search', label: `Search: ${debouncedUserSearch.trim()}` }]
      : []),
    ...userRoleFilters.map((role) => ({ key: `role:${role}`, label: `Role: ${role}` })),
    ...userPlanFilters.map((plan) => ({ key: `plan:${plan}`, label: `Plan: ${USER_PLAN_FILTER_LABELS[plan] ?? PLAN_LABELS[plan as AdminPlanKey] ?? plan}` })),
    ...(userCreatedFilter
      ? [{ key: 'created', label: `Joined: ${USER_CREATED_FILTERS.find((f) => f.value === userCreatedFilter)?.label ?? userCreatedFilter}` }]
      : []),
  ], [debouncedUserSearch, userRoleFilters, userPlanFilters, userCreatedFilter]);

  const weekToolRows = useMemo<ToolUsageRow[]>(
    () => Object.entries(dashboard?.week_tool_breakdown ?? {})
      .map(([tool, stats]) => ({ tool, runs: stats.runs, credits: stats.credits }))
      .sort((a, b) => b.runs - a.runs),
    [dashboard?.week_tool_breakdown],
  );

  const freeToolRows = useMemo<ToolUsageRow[]>(
    () => Object.entries(dashboard?.free_tool_breakdown ?? {})
      .map(([tool, stats]) => ({ tool, runs: stats.runs }))
      .sort((a, b) => b.runs - a.runs),
    [dashboard?.free_tool_breakdown],
  );

  const dirtyQuotaSections = useMemo(
    () => savedQuotas
      ? QUOTA_SECTIONS.filter((section) => section.id !== 'posting' && quotaSectionChanged(quotas, savedQuotas, section.id))
      : [],
    [quotas, savedQuotas],
  );
  const hasDirtyQuotas = dirtyQuotaSections.length > 0;

  const clearUserFilters = () => {
    setUserSearch('');
    setDebouncedUserSearch('');
    setUserRoleFilters([]);
    setUserPlanFilters([]);
    setUserCreatedFilter('');
  };

  const removeUserFilter = (key: string) => {
    if (key === 'search') {
      setUserSearch('');
      setDebouncedUserSearch('');
    } else if (key.startsWith('role:')) {
      setUserRoleFilters((prev) => prev.filter((role) => role !== key.slice(5)));
    } else if (key.startsWith('plan:')) {
      setUserPlanFilters((prev) => prev.filter((plan) => plan !== key.slice(5)));
    } else if (key === 'created') {
      setUserCreatedFilter('');
    }
  };

  const promptModuleOptions = useMemo(
    () => Array.from(new Set(prompts.map((prompt) => getPromptMeta(prompt.key).module)))
      .sort()
      .map((module) => ({ value: module, label: module })),
    [prompts],
  );

  const promptAudienceOptions = useMemo(
    () => Array.from(new Set(prompts.map((prompt) => {
      const meta = getPromptMeta(prompt.key);
      return getPromptAudience(prompt.key, meta.module);
    })))
      .sort((a, b) => getPromptAudienceLabel(a).localeCompare(getPromptAudienceLabel(b)))
      .map((audience) => ({ value: audience, label: getPromptAudienceLabel(audience) })),
    [prompts],
  );

  useEffect(() => {
    const valid = new Set(promptAudienceOptions.map((option) => option.value));
    setPromptAudienceFilters((prev) => prev.filter((audience) => valid.has(audience)));
  }, [promptAudienceOptions]);

  const activePromptFilterTags = useMemo(() => [
    ...(promptSearch.trim()
      ? [{ key: 'search', label: `Search: ${promptSearch.trim()}` }]
      : []),
    ...promptTypeFilters.map((type) => ({
      key: `type:${type}`,
      label: `Type: ${PROMPT_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type}`,
    })),
    ...promptAudienceFilters.map((audience) => ({
      key: `audience:${audience}`,
      label: `Audience: ${getPromptAudienceLabel(audience)}`,
    })),
    ...promptModuleFilters.map((module) => ({ key: `module:${module}`, label: `Module: ${module}` })),
  ], [promptSearch, promptTypeFilters, promptAudienceFilters, promptModuleFilters]);

  const clearPromptFilters = () => {
    setPromptSearch('');
    setPromptTypeFilters([]);
    setPromptAudienceFilters([]);
    setPromptModuleFilters([]);
  };

  const removePromptFilter = (key: string) => {
    if (key === 'search') {
      setPromptSearch('');
    } else if (key.startsWith('type:')) {
      setPromptTypeFilters((prev) => prev.filter((type) => type !== key.slice(5)));
    } else if (key.startsWith('audience:')) {
      setPromptAudienceFilters((prev) => prev.filter((audience) => audience !== key.slice(9)));
    } else if (key.startsWith('module:')) {
      setPromptModuleFilters((prev) => prev.filter((module) => module !== key.slice(7)));
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setIsAdmin(null);
      setAdminRole(null);
      return;
    }
    let active = true;
    setIsAdmin(null);
    setAdminRole(null);
    adminCheckAccess()
      .then((r) => {
        if (active) setIsAdmin(r.admin);
      })
      .catch(() => {
        if (active) setIsAdmin(false);
      });
    // Fetch the authoritative fine-grained role. During a staged rollout, known
    // endpoint errors fail closed to reviewer/read-only navigation.
    resolveRoleWithFallback(adminWhoAmI)
      .then((role) => {
        if (active) setAdminRole(role);
      })
      .catch(() => {
        if (active) setAdminRole('reviewer');
      });
    return () => {
      active = false;
    };
  }, [session]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedUserSearch(userSearch), 400);
    return () => window.clearTimeout(timer);
  }, [userSearch]);

  useEffect(() => {
    if (!session) return;
    let active = true;
    data.profiles.get(session.user.id).then(({ data: profileData }) => {
      if (!active || !mountedRef.current) return;
      setAccountName(profileData?.full_name || session.user.user_metadata?.full_name || session.user.displayName || '');
      setAccountAvatarUrl(profileData?.avatar_url || session.user.user_metadata?.avatar_url || session.user.photoURL || '');
    });
    return () => {
      active = false;
    };
  }, [session]);

  const saveAccountProfile = async (avatarUrl = accountAvatarUrl) => {
    if (!session) return false;
    setAccountSaving(true);
    setAccountMessage(null);
    try {
      const { error } = await data.profiles.upsert({
        id: session.user.id,
        full_name: accountName,
        avatar_url: avatarUrl,
        updated_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
      if (mountedRef.current) setAccountMessage({ type: 'success', text: 'Profile updated.' });
      return true;
    } catch (e) {
      if (mountedRef.current) setAccountMessage({ type: 'error', text: e instanceof Error ? e.message : 'Profile update failed.' });
      return false;
    } finally {
      if (mountedRef.current) setAccountSaving(false);
    }
  };

  const updateAccountPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (accountPassword !== accountPasswordConfirm) {
      setAccountMessage({ type: 'error', text: 'Passwords do not match.' });
      return;
    }
    if (accountPassword.length < 6) {
      setAccountMessage({ type: 'error', text: 'Password must be at least 6 characters.' });
      return;
    }
    setAccountPasswordSaving(true);
    setAccountMessage(null);
    try {
      const { error } = await data.auth.updatePassword(accountPassword);
      if (error) throw new Error(error.message);
      if (mountedRef.current) {
        setAccountPassword('');
        setAccountPasswordConfirm('');
        setAccountMessage({ type: 'success', text: 'Password updated.' });
      }
    } catch (e) {
      if (mountedRef.current) setAccountMessage({ type: 'error', text: e instanceof Error ? e.message : 'Password update failed.' });
    } finally {
      if (mountedRef.current) setAccountPasswordSaving(false);
    }
  };

  // Data loaders.

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const dashboardData = await adminGetDashboard();
      if (!mountedRef.current) return;
      setDashboard(dashboardData);
      setLastRefreshed(new Date());
    } catch (e) {
      if (mountedRef.current) setError(formatAdminPortalError(e, adminRole, 'Load dashboard', 'Failed to load dashboard'));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [adminRole]);

  const loadLlm = useCallback(async () => {
    setError(null);
    setLlmLoaded(false);
    try {
      const cfg = await adminGetLlmConfig();
      if (!mountedRef.current) return;
      setLlm(cfg);
      setGeminiModel(cfg.gemini_model ?? '');
      setGeminiFallbackModel(cfg.gemini_fallback_model ?? '');
      setKairllmUrl(cfg.kairllm_base_url ?? '');
      setDeepseekUrl(cfg.deepseek_base_url ?? '');
    } catch (e) {
      if (mountedRef.current) setError(formatAdminPortalError(e, adminRole, 'Load model and key settings', 'Failed to load LLM config'));
    } finally {
      if (mountedRef.current) setLlmLoaded(true);
    }
  }, [adminRole]);

  const loadQuotas = useCallback(async () => {
    setError(null);
    try {
      const quotaData = await adminGetQuotas();
      if (!mountedRef.current) return;
      setQuotas(quotaData);
      setSavedQuotas(quotaData);
      setQuotasLoadedAt(Date.now());
    } catch (e) {
      if (mountedRef.current) setError(formatAdminPortalError(e, adminRole, 'Load quotas', 'Failed to load quotas'));
    }
  }, [adminRole]);

  // cursor-as-argument (NOT closed over userCursor) keeps this callback []-stable,
  // so the loader effect below doesn't re-fire when userCursor changes (would loop).
  const loadUsers = useCallback(
    async (cursor?: string, pageIndex = 0) => {
      setError(null);
      setUserListLoading(true);
      try {
        const res = await adminListUsers(USER_PAGE_SIZE, cursor, userFilters);
        if (!mountedRef.current) return;
        setUsers(res.users);
        setUserCursor(res.next_cursor);
        setUserPageIndex(pageIndex);
        if (pageIndex === 0) setUserPageCursors([undefined]);
      } catch (e) {
        if (mountedRef.current) setError(formatAdminPortalError(e, adminRole, 'Load users', 'Failed to load users'));
      } finally {
        if (mountedRef.current) setUserListLoading(false);
      }
    },
    [adminRole, userFilters],
  );

  const loadNextUserPage = () => {
    if (!userCursor) return;
    const nextPage = userPageIndex + 1;
    setUserPageCursors((prev) => {
      const next = prev.slice(0, nextPage);
      next[nextPage] = userCursor;
      return next;
    });
    loadUsers(userCursor, nextPage);
  };

  const loadPreviousUserPage = () => {
    if (userPageIndex === 0) return;
    const previousPage = userPageIndex - 1;
    loadUsers(userPageCursors[previousPage], previousPage);
  };

  const loadAdmins = useCallback(async () => {
    setError(null);
    try {
      const res = await adminListAdmins();
      if (!mountedRef.current) return;
      setAdmins(res.admins);
    } catch (e) {
      if (mountedRef.current) setError(formatAdminPortalError(e, adminRole, 'Load Access Control users', 'Failed to load admins'));
    }
  }, [adminRole]);

  const loadAuditLog = useCallback(async (cursor?: string, pageIndex = 0) => {
    setError(null);
    setAuditLoaded(false);
    try {
      const res = await adminGetAuditLog(AUDIT_PAGE_SIZE, cursor);
      if (!mountedRef.current) return;
      setAuditLog(res.entries);
      setAuditCursor(res.next_cursor);
      setAuditPageIndex(pageIndex);
      if (pageIndex === 0) setAuditPageCursors([undefined]);
      setLastRefreshed(new Date());
    } catch (e) {
      if (mountedRef.current) setError(formatAdminPortalError(e, adminRole, 'Load audit log', 'Failed to load audit log'));
    } finally {
      if (mountedRef.current) setAuditLoaded(true);
    }
  }, [adminRole]);

  const loadNextAuditPage = () => {
    if (!auditCursor) return;
    const nextPage = auditPageIndex + 1;
    setAuditPageCursors((prev) => {
      const next = prev.slice(0, nextPage);
      next[nextPage] = auditCursor;
      return next;
    });
    loadAuditLog(auditCursor, nextPage);
  };

  const loadPreviousAuditPage = () => {
    if (auditPageIndex === 0) return;
    const previousPage = auditPageIndex - 1;
    loadAuditLog(auditPageCursors[previousPage], previousPage);
  };

  const loadModels = useCallback(async () => {
    setError(null);
    setModelsLoaded(false);
    try {
      const res = await adminListModels();
      if (!mountedRef.current) return;
      const routing = normalizeModelRouting(res.models, res.routingPools, res.moduleRoutes);
      setModels(res.models);
      setDefaultModelId(res.defaultModelId ?? null);
      setRoutingPools(routing.routingPools);
      setModuleRoutes(routing.moduleRoutes);
    } catch (e) {
      if (mountedRef.current) setError(formatAdminPortalError(e, adminRole, 'Load models', 'Failed to load models'));
    } finally {
      if (mountedRef.current) setModelsLoaded(true);
    }
  }, [adminRole]);

  const loadPrompts = useCallback(async () => {
    setError(null);
    setPromptsLoaded(false);
    try {
      const res = await adminGetPrompts();
      if (!mountedRef.current) return;
      setPrompts(res.prompts);
    } catch (e) {
      if (mountedRef.current) setError(formatAdminPortalError(e, adminRole, 'Load prompts', 'Failed to load prompts'));
    } finally {
      if (mountedRef.current) setPromptsLoaded(true);
    }
  }, [adminRole]);

  const loadPromptVersions = useCallback(async (promptKey: string) => {
    setPromptVersionsLoading(true);
    setPromptVersionsFeedback(null);
    setPromptVersions([]);
    try {
      const res = await adminListPromptVersions({ promptKey });
      if (!mountedRef.current) return;
      setPromptVersions(res.versions);
    } catch (e) {
      if (mountedRef.current) {
        setPromptVersionsFeedback({ err: e instanceof Error ? e.message : 'Failed to load versions' });
      }
    } finally {
      if (mountedRef.current) setPromptVersionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    if (tab === 'dashboard') {
      loadDashboard();
      if (hasAdminPermission(adminRole, 'admin.models.read')) { loadLlm(); loadModels(); }
    }
    if (tab === 'ai' && hasAdminPermission(adminRole, 'admin.models.read')) { loadLlm(); loadModels(); }
    if (tab === 'prompts') loadPrompts();
    if (tab === 'quotas') loadQuotas();
    if (tab === 'users') {
      loadUsers();
      loadAdmins();
    }
    if (tab === 'admins' && hasAdminPermission(adminRole, 'admin.admins.read')) loadAdmins();
    if (tab === 'audit') loadAuditLog();
  }, [isAdmin, adminRole, tab, loadDashboard, loadLlm, loadModels, loadPrompts, loadQuotas, loadUsers, loadAdmins, loadAuditLog]);

  useEffect(() => {
    if (tab !== 'ai') return;
    const scrollRoot = modelPanelRef.current?.closest('main') as HTMLElement | null;
    if (!scrollRoot) return;

    // A dashboard recovery shortcut can open this tab with a section target.
    // Refs are attached after the tab render, so perform the actual scroll here.
    const initialTarget = modelScrollTargetRef.current;
    if (initialTarget) {
      modelSectionRefs.current[initialTarget]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    let frame = 0;
    const updateModelNav = () => {
      frame = 0;
      setModelNavScrolled(scrollRoot.scrollTop > 8);

      const marker = scrollRoot.getBoundingClientRect().top + 128;
      const target = modelScrollTargetRef.current;
      if (target) {
        setActiveModelSection(target);
        const targetNode = modelSectionRefs.current[target];
        if (targetNode && targetNode.getBoundingClientRect().top <= marker) {
          modelScrollTargetRef.current = null;
        } else {
          return;
        }
      }

      const current = MODEL_SECTIONS.reduce<ModelSectionId>((active, section) => {
        const node = modelSectionRefs.current[section.id];
        return node && node.getBoundingClientRect().top <= marker ? section.id : active;
      }, MODEL_SECTIONS[0].id);
      setActiveModelSection(current);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(updateModelNav);
    };

    updateModelNav();
    scrollRoot.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      scrollRoot.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [tab]);

  useEffect(() => {
    if (tab !== 'quotas') return;
    const scrollRoot = quotaPanelRef.current?.closest('main') as HTMLElement | null;
    if (!scrollRoot) return;

    let frame = 0;
    const updateQuotaNav = () => {
      frame = 0;
      setQuotaNavScrolled(scrollRoot.scrollTop > 8);

      const marker = scrollRoot.getBoundingClientRect().top + 128;
      const target = quotaScrollTargetRef.current;
      if (target) {
        setActiveQuotaSection(target);
        const targetNode = quotaSectionRefs.current[target];
        if (targetNode && targetNode.getBoundingClientRect().top <= marker) {
          quotaScrollTargetRef.current = null;
        } else {
          return;
        }
      }

      const current = QUOTA_SECTIONS.reduce<QuotaSectionId>((active, section) => {
        const node = quotaSectionRefs.current[section.id];
        return node && node.getBoundingClientRect().top <= marker ? section.id : active;
      }, QUOTA_SECTIONS[0].id);
      setActiveQuotaSection(current);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(updateQuotaNav);
    };

    updateQuotaNav();
    scrollRoot.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      scrollRoot.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [tab]);

  const scrollToModelSection = (sectionId: ModelSectionId) => {
    modelScrollTargetRef.current = sectionId;
    setActiveModelSection(sectionId);
    modelSectionRefs.current[sectionId]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const scrollToQuotaSection = (sectionId: QuotaSectionId) => {
    quotaScrollTargetRef.current = sectionId;
    setActiveQuotaSection(sectionId);
    quotaSectionRefs.current[sectionId]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Mutators.

  const saveQuotas = async () => {
    setLoading(true);
    setError(null);
    try {
      const fmot = Number(quotas.free_max_output_tokens ?? 8192);
      if (!Number.isInteger(fmot) || fmot < 256 || fmot > 32768) {
        setError('Free-tier max output tokens must be an integer between 256 and 32768.');
        return;
      }
      const plan_quotas = Object.fromEntries(
        PLAN_KEYS.map((plan) => [plan, effectivePlanQuota(quotas, plan)]),
      ) as Record<AdminPlanKey, AdminPlanQuota>;
      const tool_quotas = Object.fromEntries(
        TOOL_KEYS.map((tool) => [tool, effectiveToolQuota(quotas, tool)]),
      ) as Record<string, AdminToolQuota>;
      const updated = await adminUpdateQuotas({
        daily_tool_run_limit: Number(quotas.daily_tool_run_limit ?? 0),
        daily_credit_spend_limit: Number(quotas.daily_credit_spend_limit ?? 0),
        per_user_daily_credit_limit: Number(quotas.per_user_daily_credit_limit ?? 0),
        enabled: quotas.enabled !== false,
        free_max_output_tokens: fmot,
        mi_min_tier: quotas.mi_min_tier === 'free' ? 'free' : 'paid',
        mi_report_unlock_credits: Number(quotas.mi_report_unlock_credits ?? 500),
        plan_quotas,
        tool_quotas,
      });
      setQuotas(updated);
      setSavedQuotas(updated);
    } catch (e) {
      setError(formatAdminPortalError(e, adminRole, 'Save quotas', 'Save failed'));
    } finally {
      setLoading(false);
    }
  };

  const setPlanQuotaField = (
    plan: AdminPlanKey,
    field: keyof AdminPlanQuota,
    value: number,
  ) => {
    setQuotas((q) => ({
      ...q,
      plan_quotas: {
        ...(q.plan_quotas ?? {}),
        [plan]: {
          ...effectivePlanQuota(q, plan),
          [field]: Math.max(0, Number.isFinite(value) ? Math.floor(value) : 0),
        },
      },
    }));
  };

  const setToolQuotaField = (
    tool: string,
    patch: Partial<AdminToolQuota>,
  ) => {
    setQuotas((q) => ({
      ...q,
      tool_quotas: {
        ...(q.tool_quotas ?? {}),
        [tool]: {
          ...effectiveToolQuota(q, tool),
          ...patch,
        },
      },
    }));
  };

  const toggleToolPlan = (tool: string, plan: AdminPlanKey) => {
    setQuotas((q) => {
      const current = effectiveToolQuota(q, tool);
      const allowed = new Set(current.allowed_plans);
      if (allowed.has(plan)) allowed.delete(plan);
      else allowed.add(plan);
      return {
        ...q,
        tool_quotas: {
          ...(q.tool_quotas ?? {}),
          [tool]: {
            ...current,
            allowed_plans: PLAN_KEYS.filter((p) => allowed.has(p)),
          },
        },
      };
    });
  };

  const openUser = async (uid: string) => {
    setError(null);
    setSelectedUid(uid);
    setDeleteReason('');
    selectedUidRef.current = uid;
    setUserReport(null);
    setSubStatus('');
    try {
      const report = await adminGetUserReport(uid);
      if (!mountedRef.current || selectedUidRef.current !== uid) return; // admin switched users mid-fetch
      setUserReport(report);
      const profile = (report as { profile?: { role?: string | null; subscription_status?: string } }).profile;
      const allowedPlans = assignableSubscriptionPlansForRole(profile?.role);
      const currentPlan = profile?.subscription_status ?? '';
      setSubStatus(allowedPlans.includes(currentPlan) ? currentPlan : '');
    } catch (e) {
      if (!mountedRef.current || selectedUidRef.current !== uid) return;
      setError(formatAdminPortalError(e, adminRole, 'Open user detail', 'Failed to load user report'));
    }
  };

  const adjustCredits = async () => {
    if (!selectedUid || creditAdjusting) return;
    const delta = Number(creditDelta);
    if (!Number.isInteger(delta) || delta === 0) {
      setError('Credit adjustment must be a non-zero whole number.');
      return;
    }
    if (Math.abs(delta) > 5000) {
      setError('Credit adjustment cannot exceed +/-5000.');
      return;
    }
    const reason = creditReason.trim();
    if (reason.length < 10 || reason.length > 300) {
      setError('Reason must be between 10 and 300 characters.');
      return;
    }
    setError(null);
    setCreditAdjusting(true);
    const uid = selectedUid;
    try {
      await adminAdjustCredits(uid, delta, reason);
      const report = await adminGetUserReport(uid);
      if (selectedUidRef.current === uid) {
        setUserReport(report);
        setCreditReason('');
      }
      await loadUsers(userPageCursors[userPageIndex], userPageIndex);
    } catch (e) {
      if (selectedUidRef.current === uid) setError(formatAdminPortalError(e, adminRole, 'Adjust user credits', 'Failed to adjust credits'));
    } finally {
      setCreditAdjusting(false);
    }
  };

  const applySubscription = async () => {
    if (!selectedUid || !subStatus) return;
    setError(null);
    const uid = selectedUid;
    try {
      await adminSetSubscription(uid, subStatus);
      const report = await adminGetUserReport(uid);
      if (selectedUidRef.current === uid) setUserReport(report);
      await loadUsers(userPageCursors[userPageIndex], userPageIndex);
    } catch (e) {
      if (selectedUidRef.current === uid) setError(formatAdminPortalError(e, adminRole, 'Set user subscription', 'Failed to set subscription'));
    }
  };

  const selectedIsAdmin = !!selectedUid && admins.some((a) => a.uid === selectedUid);
  const selectedProductRole = ((userReport as { profile?: { role?: string | null } } | null)?.profile?.role) ?? null;
  const selectedSubscriptionPlans = assignableSubscriptionPlansForRole(selectedProductRole);

  const createSampleAccounts = async () => {
    setAdminConfirm({
      title: 'Create sample accounts',
      description: 'Create or reset the demo Job Seeker and Employer accounts with full product access and credits.',
      detail: 'Existing sample accounts keep the same email and receive a new password. The server permits this only in the emulator or when both project-specific safety flags are configured.',
      confirmLabel: 'Create / reset',
      run: async () => {
        setError(null);
        setSampleAccountsLoading(true);
        try {
          const result = await adminCreateSampleAccounts();
          setSampleAccounts(result.accounts);
          await loadUsers(userPageCursors[userPageIndex], userPageIndex);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to create sample accounts');
        } finally {
          setSampleAccountsLoading(false);
        }
      },
    });
  };

  const deleteSelectedUser = async () => {
    if (!selectedUid || !userReport) return;
    const reason = deleteReason.trim();
    if (reason.length < 10 || reason.length > 300) {
      setError('Deletion reason must be between 10 and 300 characters.');
      return;
    }
    const profile = ((userReport as { profile?: Record<string, unknown> }).profile ?? {}) as Record<string, unknown>;
    const auth = (userReport as { auth?: Record<string, unknown> | null }).auth ?? null;
    const str = (value: unknown) => (typeof value === 'string' && value ? value : null);
    const email = str(profile.email) ?? (auth ? str(auth.email) : null);
    const displayName = str(profile.full_name) ?? str(profile.company_name) ?? (auth ? str(auth.display_name) : null);
    const label = displayName || email || selectedUid;
    const uid = selectedUid;

    setAdminConfirm({
      title: 'Remove login and profile',
      description: 'This removes Firebase Auth access and the parent users profile after recurring-billing checks. Shared hiring, financial, audit, Storage, and Stripe records are retained for policy or external follow-up; this is not full data erasure.',
      detail: `${label}\n${email ?? 'No email'}\n${uid}`,
      confirmLabel: 'Remove login & profile',
      tone: 'danger',
      run: async () => {
        setError(null);
        setAccountDeletionResult(null);
        try {
          const result = await adminDeleteUser({ uid, reason });
          setAccountDeletionResult(result);
          if (selectedUidRef.current === uid) {
            selectedUidRef.current = null;
            setSelectedUid(null);
            setUserReport(null);
            setSubStatus('');
            setDeleteReason('');
          }
          await loadUsers(userPageCursors[userPageIndex], userPageIndex);
          await loadAdmins();
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to delete account');
        }
      },
    });
  };

  const toggleSelectedAdmin = async () => {
    if (!selectedUid) return;
    setError(null);
    try {
      await adminSetAdmin({ uid: selectedUid, makeAdmin: !selectedIsAdmin });
      await loadAdmins();
    } catch (e) {
      setError(formatAdminPortalError(e, adminRole, 'Update admin access', 'Failed to update admin access'));
    }
  };

  const addAdmin = async () => {
    const value = newAdmin.trim();
    if (!value) return;
    setError(null);
    try {
      await adminSetAdmin(
        value.includes('@') ? { email: value, makeAdmin: true } : { uid: value, makeAdmin: true },
      );
      setNewAdmin('');
      await loadAdmins();
    } catch (e) {
      setError(formatAdminPortalError(e, adminRole, 'Add legacy admin access', 'Failed to add admin'));
    }
  };

  const revokeAdmin = async (uid: string) => {
    setError(null);
    try {
      await adminSetAdmin({ uid, makeAdmin: false });
      await loadAdmins();
    } catch (e) {
      setError(formatAdminPortalError(e, adminRole, 'Revoke legacy admin access', 'Failed to revoke admin'));
    }
  };

  const inviteAdmin = async () => {
    const email = inviteEmail.trim();
    if (!email || inviteLoading) return;
    setInviteFeedback(null);
    setInviteLoading(true);
    try {
      await adminInviteAdmin({ email, role: inviteRole });
      setInviteEmail('');
      setInviteFeedback({ ok: `Invited ${email} as ${inviteRole}.` });
      await loadAdmins();
    } catch (e) {
      setInviteFeedback({ err: e instanceof Error ? e.message : 'Invite failed' });
    } finally {
      setInviteLoading(false);
    }
  };

  const changeAdminRole = async (uid: string, role: 'admin' | 'reviewer') => {
    setError(null);
    try {
      await adminSetAdminRole({ uid, role });
      await loadAdmins();
    } catch (e) {
      setError(formatAdminPortalError(e, adminRole, 'Change console user role', 'Failed to change role'));
    }
  };

  const runAdminConfirm = async () => {
    if (!adminConfirm || adminConfirmLoading) return;
    const action = adminConfirm.run;
    setAdminConfirmLoading(true);
    try {
      await action();
      if (mountedRef.current) setAdminConfirm(null);
    } finally {
      if (mountedRef.current) setAdminConfirmLoading(false);
    }
  };

  const removeAdminEntry = async (uid: string) => {
    setAdminConfirm({
      title: t('admin.admins.remove_btn'),
      description: t('admin.admins.remove_confirm'),
      detail: uid,
      confirmLabel: t('admin.admins.remove_btn'),
      tone: 'danger',
      run: async () => {
        setError(null);
        try {
          await adminRemoveAdmin({ uid });
          await loadAdmins();
        } catch (e) {
          setError(formatAdminPortalError(e, adminRole, 'Remove console user access', 'Failed to remove admin'));
        }
      },
    });
  };

  const closeModelForm = () => {
    if (modelSaving) return;
    setModelForm(null);
    setError(null);
    setTest('__form__', { state: 'idle' });
  };

  /** Open the add/edit form, seeding controlled fields from entry (or blank for new). */
  const openModelForm = (entry: ModelEntry | 'new') => {
    if (entry === 'new') {
      setMfId('');
      setMfLabel('');
      setMfProvider('gemini');
      setMfBuiltin('');
      setMfBaseUrl('');
      setMfApiKey('');
      setMfApiKeys('');
      setMfFallbackChain([]);
      setMfPriority('');
      setMfProviderModel('');
      setMfMinTier('free');
      setMfEnabled(true);
      setMfSupportsImageInput(false);
    } else {
      setMfId(entry.id);
      setMfLabel(entry.label);
      setMfProvider(entry.provider);
      setMfBuiltin(entry.provider === 'openai-compatible' ? entry.builtin ?? '' : '');
      setMfBaseUrl(entry.provider === 'openai-compatible' && !entry.builtin ? entry.base_url ?? '' : '');
      setMfApiKey(''); // never pre-fill ? masked value is display-only
      setMfApiKeys(''); // new keys textarea starts empty
      setMfFallbackChain((entry.fallbackChain ?? []).filter((id) => id !== 'custom'));
      setMfPriority(entry.priority !== undefined ? String(entry.priority) : '');
      setMfProviderModel(entry.providerModel);
      setMfMinTier(entry.minTier);
      setMfEnabled(entry.enabled);
      setMfSupportsImageInput(entry.supportsImageInput === true);
    }
    setModelForm(entry);
  };

  const saveModel = async () => {
    const id = mfId.trim();
    const label = mfLabel.trim();
    const baseUrl = mfBaseUrl.trim();

    // client-side validation
    if (!id) { setError('Model id is required.'); return; }
    if (!label) { setError('Display label is required.'); return; }
    const isCustomSentinel = id === 'custom';
    if (
      mfProvider === 'openai-compatible' &&
      !mfBuiltin &&
      !isCustomSentinel &&
      (!baseUrl || !baseUrl.startsWith('https://'))
    ) {
      setError('Base URL must start with https:// for openai-compatible models without a builtin.');
      return;
    }

    // parse multi-key textarea: non-empty trimmed lines
    const newKeys = mfApiKeys
      .split('\n')
      .map((k) => k.trim())
      .filter(Boolean);

    const original = modelForm !== 'new' ? modelForm : null;
    const usesDirectCredentials =
      mfProvider === 'openai-compatible' && !mfBuiltin && !isCustomSentinel;
    const originalUsesDirectCredentials = !!original &&
      original.provider === 'openai-compatible' && !original.builtin;
    const hasSavedDirectKey = !!original?.api_key || (original?.api_keys?.length ?? 0) > 0;
    if (
      usesDirectCredentials &&
      !mfApiKey.trim() &&
      newKeys.length === 0 &&
      (!originalUsesDirectCredentials || !hasSavedDirectKey)
    ) {
      setError('At least one API key is required for an openai-compatible model without a builtin.');
      return;
    }

    const clearFields: ModelClearableField[] = [];
    const clearIfStored = (field: ModelClearableField, stored: boolean) => {
      if (original && stored && !clearFields.includes(field)) clearFields.push(field);
    };

    if (mfProvider === 'gemini') {
      clearIfStored('builtin', !!original?.builtin);
      clearIfStored('base_url', !!original?.base_url);
      clearIfStored('api_key', !!original?.api_key);
      clearIfStored('api_keys', (original?.api_keys?.length ?? 0) > 0);
      clearIfStored('supportsImageInput', original?.supportsImageInput !== undefined);
    } else if (mfBuiltin) {
      clearIfStored('base_url', !!original?.base_url);
      clearIfStored('api_key', !!original?.api_key);
      clearIfStored('api_keys', (original?.api_keys?.length ?? 0) > 0);
    } else {
      clearIfStored('builtin', !!original?.builtin);
    }
    if (mfFallbackChain.length === 0) {
      clearIfStored('fallbackChain', (original?.fallbackChain?.length ?? 0) > 0);
    }
    if (mfPriority === '') {
      clearIfStored('priority', original?.priority !== undefined);
    }

    const removesSavedCredentials = !!original && !usesDirectCredentials &&
      (!!original.api_key || (original.api_keys?.length ?? 0) > 0);
    if (
      removesSavedCredentials &&
      !window.confirm('Changing this connection mode will permanently remove its saved direct API keys. Continue?')
    ) {
      return;
    }

    const entry: ModelEntry = {
      id,
      label,
      provider: mfProvider,
      ...(mfProvider === 'openai-compatible' && mfBuiltin
        ? { builtin: mfBuiltin as ModelEntry['builtin'] }
        : {}),
      ...(usesDirectCredentials && baseUrl ? { base_url: baseUrl } : {}),
      // send api_key only if non-empty; empty = keep existing
      ...(usesDirectCredentials && mfApiKey.trim() ? { api_key: mfApiKey.trim() } : {}),
      // send api_keys only if new keys were typed
      ...(usesDirectCredentials && newKeys.length > 0 ? { api_keys: newKeys } : {}),
      ...(mfFallbackChain.length > 0 ? { fallbackChain: mfFallbackChain } : {}),
      ...(mfPriority !== '' ? { priority: Number(mfPriority) } : {}),
      ...(mfProvider === 'openai-compatible'
        ? { supportsImageInput: mfSupportsImageInput }
        : {}),
      providerModel: mfProviderModel.trim(),
      minTier: mfMinTier,
      enabled: mfEnabled,
    };

    setModelSaving(true);
    setError(null);
    try {
      const res = await adminUpsertModel(entry, { clearFields });
      setModels(res.models);
      setModelForm(null);
    } catch (e) {
      setError(formatAdminPortalError(e, adminRole, 'Save model', 'Failed to save model'));
    } finally {
      setModelSaving(false);
    }
  };

  const saveModelRouting = async (nextPools: RoutingPool[], nextRoutes: ModuleRoutes) => {
    setError(null);
    try {
      const res = await adminUpdateModelRouting({
        routingPools: nextPools,
        moduleRoutes: nextRoutes,
      });
      const routing = normalizeModelRouting(models, res.routingPools, res.moduleRoutes);
      setRoutingPools(routing.routingPools);
      setModuleRoutes(routing.moduleRoutes);
    } catch (e) {
      const message = formatAdminPortalError(e, adminRole, 'Save model routing', 'Failed to save model routing');
      setError(message);
      throw new Error(message);
    }
  };

  const deleteModel = async (id: string) => {
    setAdminConfirm({
      title: 'Delete model',
      description: `Delete model "${id}"? This cannot be undone.`,
      detail: id,
      confirmLabel: 'Delete model',
      tone: 'danger',
      run: async () => {
        setError(null);
        try {
          const res = await adminDeleteModel(id);
          setModels(res.models);
        } catch (e) {
          setError(formatAdminPortalError(e, adminRole, 'Delete model', 'Failed to delete model'));
        }
      },
    });
  };

  const setModelAsDefault = async (id: string) => {
    if (!id || id === defaultModelId) return;
    setAdminConfirm({
      title: t('admin.model.set_default_btn'),
      description: t('admin.set_default_confirm'),
      detail: id,
      confirmLabel: t('admin.model.set_default_btn'),
      run: async () => {
        setSetDefaultFeedback(null);
        try {
          const res = await adminSetDefaultModel(id);
          setDefaultModelId(res.defaultModelId);
          setSetDefaultFeedback({ ok: t('admin.model.set_default_ok') });
        } catch (e) {
          setSetDefaultFeedback({ err: e instanceof Error ? e.message : 'Failed to set default model' });
        }
      },
    });
  };

  // Auth gates.

  if (!sessionResolved) {
    return <AdminVerifying />;
  }

  if (!session) {
    return <AdminSignIn />;
  }

  if (isAdmin === null || adminRole === null) {
    return <AdminVerifying />;
  }

  if (!isAdmin) {
    return <AdminAccessDenied />;
  }

  // Role-gating helpers.
  // Server is authoritative; these just drive UI visibility.
  // reviewer: Dashboard, Audit Log, and read-only Models & Keys
  // admin:    + Users (with credits), Prompts (draft-only), Quotas, API Platform read-only
  // super:    everything + write access for Models & Keys, Admins, Publish/Rollback

  const role = adminRole;
  const isReviewer = role === 'reviewer';
  // Derived capabilities ? single source: lib/access/permissions.ts.
  const canReadModels = hasAdminPermission(role, 'admin.models.read');
  const hasConfiguredProviderCredential = Boolean(
    llm.gemini_api_key_masked ||
    llm.kairllm_api_key_masked ||
    llm.deepseek_api_key_masked ||
    models.some((model) =>
      Boolean(model.api_key || model.api_keys?.length || model.key_previews?.length),
    ),
  );
  const canWriteModels = hasAdminPermission(role, 'admin.models.write');
  const canPublishPrompts = hasAdminPermission(role, 'admin.prompts.publish');
  const canReadAdmins = hasAdminPermission(role, 'admin.admins.read');
  const canManageAdmins = hasAdminPermission(role, 'admin.admins.manage');
  const canDeleteUsers = hasAdminPermission(role, 'admin.users.delete');
  const canCreateSampleAccounts = hasAdminPermission(role, 'admin.users.sample.create');
  const visibleAdminBase = canManageAdmins ? admins : admins.filter((entry) => entry.role === 'reviewer');
  const visibleAdmins = adminRoleFilters.length === 0
    ? visibleAdminBase
    : visibleAdminBase.filter((entry) => entry.role && adminRoleFilters.includes(entry.role));
  const adminByUid = new Map(visibleAdminBase.map((entry) => [entry.uid, entry]));
  const accountDisplayName = accountName || session.user.email || 'Admin';
  const accessTabs: { id: AccessControlTab; label: string }[] = canManageAdmins
    ? [
        { id: 'console', label: 'Console users' },
        { id: 'permissions', label: 'Permissions' },
        { id: 'product', label: 'Product roles' },
      ]
    : [{ id: 'reviewers', label: 'Reviewers' }];
  const activeAccessTab = accessTabs.some((item) => item.id === accessTab)
    ? accessTab
    : accessTabs[0].id;

  const modelLabel = (id: string) => models.find((m) => m.id === id)?.label ?? id;
  const currentDefaultModel = models.find((m) => m.id === defaultModelId);
  const renderImplicitFallbackPreview = (preview?: ModelEntry['implicitFallbackPreviewByTier']) => (
    <div className="space-y-0.5 font-mono text-[11px] text-gray-600 dark:text-gray-300">
      {FALLBACK_PREVIEW_TIERS.map((tier) => {
        const chain = preview?.[tier] ?? [];
        return (
          <div key={tier}>
            <span className="font-sans text-[10px] font-semibold uppercase text-gray-400">{tier}</span>
            <span className="ml-2">{chain.length ? chain.map(modelLabel).join(' -> ') : 'none'}</span>
          </div>
        );
      })}
    </div>
  );

  // Tab definitions.
  // Visibility is driven by the central registry (lib/access/permissions.ts);
  // the server re-checks every action regardless of what renders here.

  const allTabs: { id: Tab; label: string; visible: boolean; superOnly?: boolean; help: AdminNavHelp }[] = [
    { id: 'dashboard', label: 'Dashboard', visible: hasAdminPermission(role, 'admin.dashboard.read'), help: ADMIN_TAB_HELP.dashboard },
    { id: 'ai', label: 'Models & Keys', visible: hasAdminPermission(role, 'admin.models.read'), help: ADMIN_TAB_HELP.ai },
    { id: 'prompts', label: 'Prompts', visible: hasAdminPermission(role, 'admin.prompts.read'), superOnly: true, help: ADMIN_TAB_HELP.prompts },
    { id: 'quotas', label: 'Quotas', visible: hasAdminPermission(role, 'admin.quotas.read'), help: ADMIN_TAB_HELP.quotas },
    { id: 'users', label: 'Users', visible: hasAdminPermission(role, 'admin.users.read'), help: ADMIN_TAB_HELP.users },
    { id: 'admins', label: 'Access Control', visible: canReadAdmins, superOnly: true, help: ADMIN_TAB_HELP.admins },
    // Do not expose an empty production destination. Users contains the
    // currently supported, audited subscription override workflow.
    { id: 'billing', label: 'Billing', visible: false, superOnly: true, help: ADMIN_TAB_HELP.billing },
    { id: 'apiplatform', label: 'API Platform', visible: hasAdminPermission(role, 'admin.apiplatform.read'), superOnly: true, help: ADMIN_TAB_HELP.apiplatform },
    { id: 'web3', label: 'Web3', visible: hasAdminPermission(role, 'admin.web3.manage'), superOnly: true, help: ADMIN_TAB_HELP.web3 },
    { id: 'audit', label: 'Audit Log', visible: hasAdminPermission(role, 'admin.audit.read'), help: ADMIN_TAB_HELP.audit },
  ];

  const tabs = allTabs.filter((t) => t.visible).map(({ id, label, superOnly, help }) => ({ id, label, superOnly, help }));
  const canOpenTab = (target: Tab) => tabs.some((item) => item.id === target);
  const openAdminTab = (target: Tab, options?: { modelSection?: ModelSectionId; quotaSection?: QuotaSectionId }) => {
    if (!canOpenTab(target)) return;
    if (options?.modelSection) {
      modelScrollTargetRef.current = options.modelSection;
      setActiveModelSection(options.modelSection);
    }
    if (options?.quotaSection) {
      quotaScrollTargetRef.current = options.quotaSection;
      setActiveQuotaSection(options.quotaSection);
    }
    setTab(target);
  };
  const renderDashboardTitle = (
    label: string,
    target: Tab,
    options?: { modelSection?: ModelSectionId; quotaSection?: QuotaSectionId },
  ) => {
    if (!canOpenTab(target)) return <SubsectionHeading>{label}</SubsectionHeading>;
    const targetLabel = tabs.find((item) => item.id === target)?.label ?? 'admin page';
    return (
      <button
        type="button"
        onClick={() => openAdminTab(target, options)}
        className="group inline-flex items-center gap-1.5 text-left text-sm font-semibold text-gray-900 transition-colors hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
        aria-label={`Open ${targetLabel}`}
      >
        <span>{label}</span>
        <ArrowRight className="h-3.5 w-3.5 text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-blue-600" aria-hidden="true" />
      </button>
    );
  };

  const refreshForTab = () => {
    if (tab === 'dashboard') {
      loadDashboard();
      if (canReadModels) { loadLlm(); loadModels(); }
    }
    else if (tab === 'ai' && canReadModels) { loadLlm(); loadModels(); }
    else if (tab === 'prompts') loadPrompts();
    else if (tab === 'quotas') loadQuotas();
    else if (tab === 'users') {
      loadUsers();
      loadAdmins();
    }
    else if (tab === 'admins' && canReadAdmins) loadAdmins();
    else if (tab === 'audit') loadAuditLog();
  };

  // Render.

  return (
    <ToastProvider>
      <AdminShell
      activeTab={tab}
      tabs={tabs}
      onTabChange={(id) => setTab(id as Tab)}
      userEmail={session.user.email}
      userName={accountDisplayName}
      userAvatarUrl={accountAvatarUrl}
      adminRole={role}
      lastRefreshed={lastRefreshed}
      loading={loading}
      onAccountOpen={() => setAccountOpen(true)}
      onRefresh={refreshForTab}
      onSignOut={() => data.auth.signOut()}
    >
        {accountOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4" role="presentation">
            <div
              ref={accountDialogRef}
              className="w-full max-w-lg rounded-lg bg-white shadow-xl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-account-title"
              aria-describedby="admin-account-description"
              tabIndex={-1}
            >
              <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
                <div>
                  <h2 id="admin-account-title" className="text-base font-semibold text-gray-900">Account details</h2>
                  <p id="admin-account-description" className="mt-0.5 text-xs text-gray-500">Signed in to the admin console.</p>
                </div>
                <button
                  type="button"
                  onClick={closeAccountDialog}
                  className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  aria-label="Close account details"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="max-h-[80vh] space-y-5 overflow-y-auto px-5 py-4">
                {accountMessage && (
                  <div className={`rounded-md px-3 py-2 text-sm ${accountMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`} role="alert">
                    {accountMessage.text}
                  </div>
                )}

                <div className="grid gap-3 text-sm">
                  <div className="flex items-center gap-4">
                    <Avatar
                      url={accountAvatarUrl}
                      size={88}
                      onUpload={async ({ url }) => {
                        const ok = await saveAccountProfile(url);
                        if (ok && mountedRef.current) setAccountAvatarUrl(url);
                        return ok;
                      }}
                      altText="Admin avatar"
                      uploadLabel=""
                      uploadingLabel="Uploading..."
                      uploadControlClassName="p-1.5"
                      uploadIconClassName="h-3.5 w-3.5"
                      selectImageMessage="Select an image first."
                      signInRequiredMessage="You must be signed in to upload an avatar."
                      maxSizeMessage="Image must be 2MB or smaller."
                      maxUploadBytes={2 * 1024 * 1024}
                      timeoutMessage="Upload timed out."
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-gray-900">{accountDisplayName}</p>
                      <p className="truncate text-xs text-gray-500">{session.user.email}</p>
                      <span className="mt-2 inline-flex rounded bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-800">
                        {role}
                      </span>
                    </div>
                  </div>
                  <div>
                    <FieldLabel>Email</FieldLabel>
                    <input className={textInput} value={session.user.email ?? ''} disabled />
                  </div>
                  <div>
                    <FieldLabel>UID</FieldLabel>
                    <input className={`${textInput} font-mono text-xs`} value={session.user.id} disabled />
                  </div>
                </div>

                <form
                  className="space-y-3 border-t border-gray-200 pt-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveAccountProfile();
                  }}
                >
                  <FieldLabel htmlFor="admin-account-name">Name</FieldLabel>
                  <input
                    id="admin-account-name"
                    className={textInput}
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    maxLength={120}
                    autoComplete="name"
                  />
                  <button
                    type="submit"
                    disabled={accountSaving}
                    className="rounded-md bg-blue-700 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {accountSaving ? 'Saving...' : 'Save profile'}
                  </button>
                </form>

                <form className="space-y-3 border-t border-gray-200 pt-4" onSubmit={updateAccountPassword}>
                  <SubsectionHeading>Change Password</SubsectionHeading>
                  <div>
                    <FieldLabel htmlFor="admin-account-password">New password</FieldLabel>
                    <input
                      id="admin-account-password"
                      type="password"
                      className={textInput}
                      value={accountPassword}
                      onChange={(e) => setAccountPassword(e.target.value)}
                      autoComplete="new-password"
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor="admin-account-password-confirm">Confirm password</FieldLabel>
                    <input
                      id="admin-account-password-confirm"
                      type="password"
                      className={textInput}
                      value={accountPasswordConfirm}
                      onChange={(e) => setAccountPasswordConfirm(e.target.value)}
                      autoComplete="new-password"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={accountPasswordSaving || !accountPassword}
                    className="rounded-md bg-gray-800 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {accountPasswordSaving ? 'Saving...' : 'Update password'}
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        {accountDeletionResult && (
          <div
            role="status"
            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Login, private credentials, and parent profile removed</p>
                <p className="mt-1 leading-5">
                  This was not full data erasure. {accountDeletionResult.pending_cleanup.length.toLocaleString()} retained cleanup item{accountDeletionResult.pending_cleanup.length === 1 ? '' : 's'} require an approved retention/anonymization policy or external action.
                </p>
                {accountDeletionResult.pending_cleanup.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer font-medium underline decoration-amber-500 underline-offset-2">
                      Review retained resources
                    </summary>
                    <ul className="mt-2 max-h-52 space-y-1 overflow-auto rounded-md border border-amber-200 bg-white/70 p-2 text-xs dark:border-amber-800 dark:bg-black/20">
                      {accountDeletionResult.pending_cleanup.map((item) => (
                        <li key={`${item.category}:${item.resource}:${item.selector}`} className="break-words">
                          <span className="font-mono font-semibold">{item.resource}</span>
                          {' — '}{item.disposition === 'external_action_required' ? 'external action required' : 'retained pending policy'}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
              <button
                type="button"
                onClick={() => setAccountDeletionResult(null)}
                className="shrink-0 text-amber-800 transition-colors hover:text-amber-950 dark:text-amber-300 dark:hover:text-amber-100"
                aria-label="Dismiss account removal result"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div
            role="alert"
            className="flex items-start gap-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300 px-4 py-3 rounded-lg text-sm"
          >
            <X className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="ml-auto text-red-600 hover:text-red-800 transition-colors shrink-0"
              aria-label="Dismiss error"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Reviewer notice */}
        {isReviewer && (
          <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 px-4 py-2.5 rounded-lg text-sm">
            <span aria-hidden="true">i</span>
            <span>{t('admin.access.reviewer_only')}</span>
          </div>
        )}

        {/* DASHBOARD */}
        {tab === 'dashboard' && (
          <>
            {!dashboard && !loading && (
              <EmptyState message="No dashboard data available yet." />
            )}

            {dashboard && (
              <>
                {canReadModels && modelsLoaded && llmLoaded && !hasConfiguredProviderCredential && (
                  <div role="alert" className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-950 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-100 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-300" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="font-semibold">No AI provider keys are configured.</p>
                        <p className="mt-1 text-sm leading-5 text-red-800 dark:text-red-200">
                          AI-assisted tools are unavailable until an authorized administrator adds a shared or model-specific credential.
                        </p>
                      </div>
                    </div>
                    {canOpenTab('ai') && (
                      <button
                        type="button"
                        onClick={() => openAdminTab('ai', { modelSection: 'credentials' })}
                        className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:border-red-800 dark:bg-slate-950 dark:text-red-200 dark:hover:bg-red-950/60"
                      >
                        Open Models &amp; Keys
                      </button>
                    )}
                  </div>
                )}

                {(dashboard.pending_usage_counter_reviews ?? 0) > 0 && (
                  <div role="alert" className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="font-semibold">Usage counters require reconciliation.</p>
                      <p className="mt-1 text-sm leading-5 text-amber-800 dark:text-amber-200">
                        {dashboard.pending_usage_counter_reviews}
                        {dashboard.pending_usage_counter_reviews_truncated ? '+' : ''} refunded usage record(s) have an invalid or unknown source-day counter. Keep credit caps conservative and resolve the server-only reconciliation queue before relying on these counters.
                      </p>
                    </div>
                  </div>
                )}

                {/* Stat cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {([
                    { label: 'Total users', value: `${dashboard.user_count}${dashboard.users_truncated ? '+' : ''}`, target: 'users' },
                    { label: 'Metered attempts today', value: String(dashboard.today_runs), target: 'audit' },
                    { label: 'Net credits today', value: String(dashboard.today_credits), target: 'audit' },
                    {
                      label: 'Quotas',
                      value: dashboard.quotas?.enabled === false ? 'Safety only' : 'Enforced',
                      accent: dashboard.quotas?.enabled === false ? 'text-amber-400' : 'text-emerald-700 dark:text-emerald-400',
                      target: 'quotas',
                      targetOptions: { quotaSection: 'global' },
                    },
                  ] satisfies Array<{
                    label: string;
                    value: string;
                    accent?: string;
                    target: Tab;
                    targetOptions?: { quotaSection?: QuotaSectionId };
                  }>).map((c) => (
                    <Card key={c.label} className="p-5">
                      {canOpenTab(c.target) ? (
                        <button
                          type="button"
                          onClick={() => openAdminTab(c.target, c.targetOptions)}
                          className="group inline-flex items-center gap-1 text-left text-[11px] font-medium uppercase tracking-wide text-gray-500 transition-colors hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
                          aria-label={`Open ${tabs.find((item) => item.id === c.target)?.label ?? c.label}`}
                        >
                          <span>{c.label}</span>
                          <ArrowRight className="h-3 w-3 text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-blue-600" aria-hidden="true" />
                        </button>
                      ) : (
                        <p className="text-[11px] font-medium tracking-wide text-gray-500 dark:text-gray-400 uppercase">
                          {c.label}
                        </p>
                      )}
                      <p className={`text-2xl font-bold mt-1.5 tabular-nums text-gray-900 dark:text-gray-100 ${c.accent ?? ''}`}>
                        {c.value}
                      </p>
                    </Card>
                  ))}
                </div>

                {(dashboard.users_truncated || dashboard.week_usage_truncated || dashboard.free_usage_truncated) && (
                  <p role="status" className="text-xs text-amber-700 flex items-center gap-1.5 dark:text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                    Showing partial data
                    {dashboard.users_truncated ? ' - user count capped at 2,000' : ''}
                    {dashboard.week_usage_truncated ? ' - metered attempts capped at 5,000 events' : ''}
                    {dashboard.free_usage_truncated ? ' - uncharged usage capped at 5,000 events' : ''}
                  </p>
                )}

                {/* Model Routing status card */}
                {canReadModels && modelsLoaded && (
                  <Card className="p-5">
                    <div className="mb-3">
                      {renderDashboardTitle(t('admin.dashboard.model_routing_title'), 'ai', { modelSection: 'routing' })}
                    </div>
                    <div className="flex flex-wrap gap-6 items-start">
                      {/* Default model is read-only here; editing lives in Models & Keys. */}
                      <div className="min-w-[180px]">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 mb-1">
                          {t('admin.dashboard.model_routing_default')}
                        </p>
                        {defaultModelId ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                              {currentDefaultModel?.label ?? defaultModelId}
                            </span>
                          </span>
                        ) : (
                          <span className="text-sm text-gray-400">{t('admin.dashboard.model_routing_none')}</span>
                        )}
                      </div>

                      {/* Fallback chain for the default model */}
                      {defaultModelId && (() => {
                        const defaultModel = models.find((m) => m.id === defaultModelId);
                        const chain = defaultModel?.fallbackChain ?? [];
                        return (
                          <div className="min-w-[220px]">
                            <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 mb-1">
                              {t('admin.dashboard.model_routing_chain')}
                            </p>
                            {chain.length === 0 ? (
                              <div className="space-y-2">
                                <p className="max-w-sm text-xs text-gray-500">
                                  {t('admin.dashboard.model_routing_no_chain')}
                                </p>
                                <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                                  {t('admin.dashboard.model_routing_implicit')}
                                </p>
                                {renderImplicitFallbackPreview(defaultModel?.implicitFallbackPreviewByTier)}
                              </div>
                            ) : (
                              <div className="space-y-1.5">
                                <div className="flex items-center flex-wrap gap-1 text-xs">
                                  <span className="bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded font-medium">
                                    {defaultModel?.label ?? defaultModelId}
                                  </span>
                                  {chain.map((chainId) => (
                                    <React.Fragment key={chainId}>
                                      <ArrowRight className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
                                      <span className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded font-mono">
                                        {modelLabel(chainId)}
                                      </span>
                                    </React.Fragment>
                                  ))}
                                </div>
                                <p className="max-w-sm text-xs text-gray-500">
                                  {t('admin.dashboard.model_routing_implicit_inactive')}
                                </p>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </Card>
                )}

                {/* 7-day breakdown */}
                <Card>
                  <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
                    {renderDashboardTitle('7-Day Credit-Metered Usage by Tool', 'audit')}
                  </div>
                  <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-center">
                    {weekToolRows.length === 0 ? (
                      <EmptyState message="No tool usage recorded in the past 7 days." />
                    ) : (
                      <>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[360px] text-sm">
                            <thead>
                              <tr className="text-left border-b border-gray-200 dark:border-gray-700">
                                <th className="px-5 py-3 text-[11px] font-medium tracking-wide text-gray-500 dark:text-gray-400 uppercase">
                                  Tool
                                </th>
                                <th className="px-5 py-3 text-[11px] font-medium tracking-wide text-gray-500 dark:text-gray-400 uppercase text-right">
                                  Attempts
                                </th>
                                <th className="px-5 py-3 text-[11px] font-medium tracking-wide text-gray-500 dark:text-gray-400 uppercase text-right">
                                  Net credits
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                              {weekToolRows.map((row) => (
                                <tr key={row.tool} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                                  <td className="px-5 py-3 font-mono text-xs text-gray-700 dark:text-gray-300">{row.tool}</td>
                                  <td className="px-5 py-3 text-right tabular-nums text-gray-800 dark:text-gray-200">{row.runs}</td>
                                  <td className="px-5 py-3 text-right tabular-nums text-gray-600 dark:text-gray-400">
                                    {row.credits}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="min-w-0 lg:border-l lg:border-gray-100 lg:pl-4">
                          <UsagePieChart data={weekToolRows} dataKey="runs" label="Attempts share" valueLabel="Attempts" />
                        </div>
                      </>
                    )}
                  </div>
                </Card>

                {/* Free / uncharged tool volume ? observability only, never billed or capped */}
                <Card>
                  <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
                    {renderDashboardTitle('7-Day Free Tool Usage (No Charge)', 'audit')}
                  </div>
                  <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-center">
                    {freeToolRows.length === 0 ? (
                      <EmptyState message="No uncharged tool usage recorded in the past 7 days." />
                    ) : (
                      <>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[300px] text-sm">
                            <thead>
                              <tr className="text-left border-b border-gray-200 dark:border-gray-700">
                                <th className="px-5 py-3 text-[11px] font-medium tracking-wide text-gray-500 dark:text-gray-400 uppercase">
                                  Tool
                                </th>
                                <th className="px-5 py-3 text-[11px] font-medium tracking-wide text-gray-500 dark:text-gray-400 uppercase text-right">
                                  Calls
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                              {freeToolRows.map((row) => (
                                <tr key={row.tool} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                                  <td className="px-5 py-3 font-mono text-xs text-gray-700 dark:text-gray-300">{row.tool}</td>
                                  <td className="px-5 py-3 text-right tabular-nums text-gray-800 dark:text-gray-200">{row.runs}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="min-w-0 lg:border-l lg:border-gray-100 lg:pl-4">
                          <UsagePieChart data={freeToolRows} dataKey="runs" label="Calls share" valueLabel="Calls" />
                        </div>
                      </>
                    )}
                  </div>
                </Card>

                {/* Recent events */}
                <Card>
                  <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
                    {renderDashboardTitle('Recent Events', 'audit')}
                  </div>
                  <div className="p-4">
                    {dashboard.recent_events.length === 0 ? (
                      <EmptyState message="No recent events." />
                    ) : (
                      <ul className="text-[11px] font-mono space-y-1 text-gray-600 dark:text-gray-400 max-h-52 overflow-y-auto">
                        {dashboard.recent_events.map((ev) => (
                          <li
                            key={String(ev.id)}
                            className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1 border-b border-gray-200/40 dark:border-gray-700/40 last:border-0"
                          >
                            <span className="text-gray-500 dark:text-gray-500 shrink-0">
                              {String(ev.created_at).slice(0, 19).replace('T', ' ')}
                            </span>
                            <span className="text-gray-500 dark:text-gray-500 shrink-0">{String(ev.uid ?? '')}</span>
                            <span className="min-w-0 break-all text-blue-600 dark:text-blue-400">{String(ev.tool)}</span>
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                              {usageEventStatusLabel(ev)}
                            </span>
                            <span className="sm:ml-auto text-gray-500 dark:text-gray-500">{usageEventCreditLabel(ev)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Card>
              </>
            )}
          </>
        )}

        {/* MODELS & KEYS */}
        {tab === 'ai' && (
          <div ref={modelPanelRef} className="space-y-10 pb-24">
            <div
              className={`sticky top-0 z-20 -mx-1 rounded-full border border-gray-200 p-1 transition-all duration-200 ${
                modelNavScrolled ? 'bg-white/85 shadow-md backdrop-blur' : 'bg-white shadow-sm'
              }`}
            >
              <div className="flex gap-1 overflow-x-auto">
                {MODEL_SECTIONS.map((section) => {
                  const active = section.id === activeModelSection;
                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => scrollToModelSection(section.id)}
                      className={`shrink-0 rounded-full px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 sm:flex-1 ${
                        active ? 'bg-blue-700 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                      }`}
                      aria-pressed={active}
                    >
                      {section.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* OVERVIEW STRIP — the at-a-glance state everything below manages */}
            {false && modelsLoaded && models.length > 0 && (() => {
              const enabledModels = models.filter((m) => m.enabled);
              const healthTrackedModels = enabledModels.filter((m) => m.id !== 'custom');
              const cooling = healthTrackedModels.filter((m) => m.keyHealth?.anyCooled).length;
              const hasKeyHealthData = healthTrackedModels.some((m) => m.keyHealth);
              const defaultModel = models.find((m) => m.id === defaultModelId);
              // Each card is a shortcut to the section that manages it — same
              // visual language as Card, but an actual button for a11y.
              const statCard =
                'bg-white border border-gray-200 rounded-lg shadow-sm px-4 py-3 text-left transition-colors ' +
                'hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600';
              return (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => scrollToModelSection('registry')}
                    className={statCard}
                    aria-label="Jump to the model registry"
                  >
                    <span className="block text-[11px] font-medium uppercase tracking-wide text-gray-400">Default model</span>
                    <span className="mt-1 flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100">
                      {defaultModel ? (
                        <>
                          <LlmProviderIcon text={`${defaultModel.id} ${defaultModel.label}`} />
                          <span className="truncate">{defaultModel.label}</span>
                        </>
                      ) : (
                        <span className="text-gray-400">not set</span>
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollToModelSection('health')}
                    className={statCard}
                    aria-label="Jump to the key health section"
                  >
                    <span className="block text-[11px] font-medium uppercase tracking-wide text-gray-400">Key health</span>
                    <span className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium">
                      <span className={`h-2 w-2 rounded-full ${!hasKeyHealthData ? 'bg-gray-300' : cooling ? 'bg-amber-400' : 'bg-emerald-500'}`} aria-hidden="true" />
                      <span className={!hasKeyHealthData ? 'text-gray-500 dark:text-gray-400' : cooling ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}>
                        {!hasKeyHealthData ? 'no health data' : cooling ? `${cooling} model${cooling > 1 ? 's' : ''} cooling down` : 'all keys healthy'}
                      </span>
                    </span>
                  </button>
                </div>
              );
            })()}

            {/* SECTION A: MODEL REGISTRY (primary working surface) */}
            <section
              ref={(node) => { modelSectionRefs.current.registry = node; }}
              className="scroll-mt-32"
            >
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <SectionHeading>Model Registry</SectionHeading>
                  <p className="mt-1 text-xs text-gray-500">
                    Changes propagate to every user's model picker within ~60 seconds.
                  </p>
                </div>
                {canWriteModels && modelForm === null && (
                  <button
                    type="button"
                    onClick={() => openModelForm('new')}
                    className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 hover:bg-emerald-800 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
                  >
                    <span className="text-base leading-none">+</span>
                    Add model
                  </button>
                )}
              </div>
              {modelsLoaded && (
                <Card className="mb-4 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 mb-1">
                        {t('admin.dashboard.model_routing_default')}
                      </p>
                      <p className="max-w-xl text-xs text-gray-500">
                        {t('admin.dashboard.model_routing_default_hint')}
                      </p>
                    </div>
                    {canWriteModels ? (
                      <div className="w-full sm:w-[28rem]">
                        <UserSingleFilterDropdown
                          label={t('admin.dashboard.model_routing_select')}
                          options={[
                            { value: '', label: t('admin.dashboard.model_routing_none') },
                            ...models
                              .filter((m) => m.enabled || m.id === defaultModelId)
                              .map((m) => ({
                                value: m.id,
                                label: m.label,
                                icon: <LlmProviderIcon text={`${m.id} ${m.label} ${m.builtin ?? ''} ${m.providerModel ?? ''}`} />,
                              })),
                          ]}
                          value={defaultModelId ?? ''}
                          onChange={(id) => void setModelAsDefault(id)}
                          menuClassName="w-[28rem] max-w-[calc(100vw-2rem)]"
                        />
                      </div>
                    ) : defaultModelId ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {currentDefaultModel?.label ?? defaultModelId}
                        </span>
                      </span>
                    ) : (
                      <span className="text-sm text-gray-400">{t('admin.dashboard.model_routing_none')}</span>
                    )}
                  </div>
                  <span role="status" aria-live="polite">
                    {setDefaultFeedback?.ok && (
                      <span className="mt-3 flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        {setDefaultFeedback.ok}
                        <button
                          type="button"
                          onClick={() => setSetDefaultFeedback(null)}
                          className="ml-auto text-emerald-600 hover:text-emerald-800 focus:outline-none"
                          aria-label="Dismiss"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </span>
                    )}
                    {setDefaultFeedback?.err && (
                      <span className="mt-3 flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                        {setDefaultFeedback.err}
                        <button
                          type="button"
                          onClick={() => setSetDefaultFeedback(null)}
                          className="ml-auto text-red-600 hover:text-red-800 focus:outline-none"
                          aria-label="Dismiss"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </span>
                    )}
                  </span>
                </Card>
              )}

              {/* ADD / EDIT DIALOG */}
              {modelForm !== null && (
                <ViewportAwareDialog
                  open
                  onClose={closeModelForm}
                  closeOnBackdrop={!modelSaving}
                  closeOnEscape={!modelSaving}
                  ariaLabel={modelForm === 'new' ? 'Add new model' : `Edit model ${mfId}`}
                  maxWidth={980}
                  zIndex={105}
                >
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
                  <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-gray-200 bg-white/95 px-5 py-4 backdrop-blur dark:border-gray-700 dark:bg-gray-900/95">
                    <SubsectionHeading>
                      {modelForm === 'new' ? 'Add New Model' : `Edit ${mfId}`}
                    </SubsectionHeading>
                    <button
                      type="button"
                      onClick={closeModelForm}
                      disabled={modelSaving}
                      className="rounded-full p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                    >
                      <X className="h-5 w-5" aria-hidden="true" />
                      <span className="sr-only">Close</span>
                    </button>
                  </div>
                  <div className="max-h-[calc(100dvh-8rem)] space-y-5 overflow-y-auto px-5 py-5">

                  {/* ── Identity ─────────────────────────────────────────── */}
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-3">Identity</p>
                    <div className="grid sm:grid-cols-2 gap-4">
                    {/* ID */}
                    <div>
                      <FieldLabel htmlFor="mf-id">
                        Model id{' '}
                        <span className="font-normal text-gray-500 text-xs">
                          (immutable once created)
                        </span>
                      </FieldLabel>
                      <input
                        id="mf-id"
                        value={mfId}
                        onChange={(e) => setMfId(e.target.value)}
                        disabled={modelForm !== 'new'}
                        placeholder="my-model"
                        className={`${textInput} ${modelForm !== 'new' ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : ''}`}
                      />
                    </div>

                    {/* Label */}
                    <div>
                      <FieldLabel htmlFor="mf-label">Display label</FieldLabel>
                      <input
                        id="mf-label"
                        value={mfLabel}
                        onChange={(e) => setMfLabel(e.target.value)}
                        placeholder="KairLLM (Fast)"
                        className={textInput}
                      />
                    </div>
                    </div>
                  </div>

                  {/* ── Connection — provider, endpoint, and keys ─────────── */}
                  <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-3">Connection</p>
                    <div className="grid sm:grid-cols-2 gap-4">

                    {/* Provider */}
                    <div>
                      <FieldLabel htmlFor="mf-provider">Provider</FieldLabel>
                      <ModelFormSelect
                        id="mf-provider"
                        value={mfProvider}
                        onChange={(value) => {
                          const provider = value as ModelEntry['provider'];
                          setMfProvider(provider);
                          setTest('__form__', { state: 'idle' });
                          if (provider === 'gemini') {
                            setMfBuiltin('');
                            setMfBaseUrl('');
                            setMfApiKey('');
                            setMfApiKeys('');
                            setMfSupportsImageInput(false);
                          }
                        }}
                        options={[
                          { value: 'gemini', label: 'gemini' },
                          { value: 'openai-compatible', label: 'openai-compatible' },
                        ]}
                      />
                    </div>

                    {/* Builtin */}
                    {mfProvider === 'openai-compatible' && mfId !== 'custom' && (
                      <div>
                        <FieldLabel htmlFor="mf-builtin">
                          Built-in{' '}
                          <span className="font-normal text-gray-500 text-xs">
                            (inherits platform key/url)
                          </span>
                        </FieldLabel>
                        <ModelFormSelect
                          id="mf-builtin"
                          value={mfBuiltin || '__none__'}
                          onChange={(value) => {
                            const builtin = value === '__none__' ? '' : value as ModelEntry['builtin'];
                            setMfBuiltin(builtin);
                            setTest('__form__', { state: 'idle' });
                            if (builtin) {
                              setMfBaseUrl('');
                              setMfApiKey('');
                              setMfApiKeys('');
                            }
                          }}
                          options={[
                            { value: '__none__', label: 'none' },
                            { value: 'kairllm', label: 'kairllm' },
                            { value: 'deepseek', label: 'deepseek' },
                          ]}
                        />
                      </div>
                    )}

                    {/* Base URL ? only relevant for openai-compatible non-builtin */}
                    {mfProvider === 'openai-compatible' && !mfBuiltin && mfId !== 'custom' && (
                      <div className="sm:col-span-2">
                        <FieldLabel htmlFor="mf-base-url">Base URL</FieldLabel>
                        <input
                          id="mf-base-url"
                          value={mfBaseUrl}
                          onChange={(e) => setMfBaseUrl(e.target.value)}
                          placeholder="https://api.example.com/v1"
                          className={textInput}
                        />
                      </div>
                    )}

                    {/* API Key ? only for openai-compatible non-builtin */}
                    {mfProvider === 'openai-compatible' && !mfBuiltin && mfId !== 'custom' && (
                      <div className="sm:col-span-2 space-y-3">
                        <div>
                          <FieldLabel htmlFor="mf-api-key">API key (single)</FieldLabel>
                          <input
                            id="mf-api-key"
                            type="password"
                            value={mfApiKey}
                            onChange={(e) => setMfApiKey(e.target.value)}
                            placeholder={modelForm !== 'new' ? 'leave blank to keep existing key' : 'sk-...'}
                            className={textInput}
                            autoComplete="off"
                          />
                        </div>

                        {/* Multi-key pool: masked saved keys listed read-only with per-key Test */}
                        {modelForm !== 'new' && (modelForm as ModelEntry).api_keys && (modelForm as ModelEntry).api_keys!.length > 0 && (
                          <div>
                            <FieldLabel>{t('admin.model.masked_keys')}</FieldLabel>
                            <ul className="space-y-1 mt-1">
                              {(modelForm as ModelEntry).api_keys!.map((k, idx) => {
                                const keyTestId = `${mfId}__key_${idx}`;
                                const kts = testStatus[keyTestId] ?? { state: 'idle' };
                                const runKeyTest = async () => {
                                  setTest(keyTestId, { state: 'running' });
                                  try {
                                    const res = await adminTestModel({ id: mfId, keyIndex: idx });
                                    setTest(keyTestId, { state: 'done', ...res });
                                  } catch (e) {
                                    setTest(keyTestId, { state: 'done', ok: false, error: e instanceof Error ? e.message : 'Test failed' });
                                  }
                                };
                                return (
                                  <li key={idx} className="flex items-center gap-2 text-xs font-mono text-gray-600 dark:text-gray-300">
                                    <span className="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded flex-1 truncate">{k}</span>
                                    <button
                                      type="button"
                                      disabled={kts.state === 'running'}
                                      onClick={runKeyTest}
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 text-[11px] font-medium text-gray-600 transition-colors focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                                    >
                                      {kts.state === 'running' ? <span className="w-2.5 h-2.5 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" /> : <Zap className="h-3 w-3" aria-hidden="true" />}
                                      {t('admin.model.test_key')}
                                    </button>
                                    {kts.state === 'done' && (
                                      <span className={`inline-flex items-center gap-1 ${kts.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                                        {kts.ok ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <X className="h-3.5 w-3.5" aria-hidden="true" />}
                                        {kts.ok && kts.latencyMs !== undefined ? `${kts.latencyMs}ms` : null}
                                      </span>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}

                        {/* New keys textarea */}
                        <div>
                          <FieldLabel htmlFor="mf-api-keys">{t('admin.model.api_keys_label')}</FieldLabel>
                          <textarea
                            id="mf-api-keys"
                            value={mfApiKeys}
                            onChange={(e) => setMfApiKeys(e.target.value)}
                            rows={3}
                            placeholder={t('admin.model.api_keys_placeholder')}
                            className={`${textInput} font-mono text-xs resize-y`}
                            autoComplete="off"
                            spellCheck={false}
                          />
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            One key per line. These keys rotate inside this model before any model fallback is tried. New keys are appended; existing keys are not removed.
                          </p>
                        </div>
                      </div>
                    )}

                    {mfProvider === 'openai-compatible' && mfId !== 'custom' && (
                      <label className="sm:col-span-2 flex items-start gap-3 text-sm text-gray-700 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={mfSupportsImageInput}
                          onChange={(e) => setMfSupportsImageInput(e.target.checked)}
                          className="mt-0.5 w-4 h-4 rounded accent-blue-600"
                        />
                        <span>
                          Supports image input
                          <span className="block text-[11px] font-normal text-gray-500">
                            Enable only when this provider model accepts inline image parts.
                          </span>
                        </span>
                      </label>
                    )}
                    </div>
                  </div>

                  {/* ── Access & routing — who can pick it, how it fails over ── */}
                  <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-3">Access &amp; routing</p>
                    <div className="grid sm:grid-cols-2 gap-4">

                    {/* Fallback chain + priority ? available for all provider types */}
                    <div className="sm:col-span-2">
                      <FieldLabel htmlFor="mf-fallback">{t('admin.model.fallback_chain')}</FieldLabel>
                      <p className="text-[11px] text-gray-500 mb-1">{t('admin.model.fallback_chain_hint')}</p>
                      <select
                        id="mf-fallback"
                        multiple
                        value={mfFallbackChain}
                        onChange={(e) => {
                          const selected = Array.from<HTMLOptionElement>(e.target.selectedOptions).map((o) => o.value);
                          setMfFallbackChain(selected);
                        }}
                        size={Math.min(4, models.length + 1)}
                        className={`${textInput} h-auto rounded-lg`}
                      >
                        {models
                          .filter((m) => m.id !== mfId && m.id !== 'custom')
                          .map((m) => (
                            <option key={m.id} value={m.id}>{m.label} ({m.id})</option>
                          ))}
                      </select>
                      <div className="mt-2 rounded border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-900/50">
                        {mfFallbackChain.length > 0 ? (
                          <p className="text-xs text-gray-500">
                            Explicit fallback is configured; implicit fallback by priority will not be used for this model.
                          </p>
                        ) : (
                          <>
                            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                              Implicit fallback preview
                            </p>
                            {renderImplicitFallbackPreview(models.find((m) => m.id === mfId)?.implicitFallbackPreviewByTier)}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Provider model */}
                    <div>
                      <FieldLabel htmlFor="mf-pm">
                        Provider model{' '}
                        <span className="font-normal text-gray-500 text-xs">
                          (empty = provider default)
                        </span>
                      </FieldLabel>
                      <input
                        id="mf-pm"
                        value={mfProviderModel}
                        onChange={(e) => setMfProviderModel(e.target.value)}
                        placeholder="gpt-4o-mini"
                        className={textInput}
                      />
                    </div>

                    {/* Caller access */}
                    <div>
                      <FieldLabel htmlFor="mf-tier">Minimum model access group</FieldLabel>
                      <p className="text-[11px] text-gray-500 mb-1">
                        Server-side access gate for model use. This is separate from subscription plan names and routing-pool failover order.
                      </p>
                      <ModelFormSelect
                        id="mf-tier"
                        value={mfMinTier}
                        onChange={(value) => setMfMinTier(value as ModelEntry['minTier'])}
                        options={[
                          { value: 'free', label: 'Free and signed-in users' },
                          { value: 'paid', label: 'Paid candidate plans' },
                          { value: 'business', label: 'Employer/business access' },
                        ]}
                      />
                    </div>

                    {/* Priority */}
                    <div>
                      <FieldLabel htmlFor="mf-priority">{t('admin.model.priority')}</FieldLabel>
                      <p className="text-[11px] text-gray-500 mb-1">{t('admin.model.priority_hint')}</p>
                      <input
                        id="mf-priority"
                        type="number"
                        min={0}
                        value={mfPriority}
                        onChange={(e) => setMfPriority(e.target.value)}
                        placeholder="0"
                        className={textInput}
                      />
                    </div>
                    </div>

                    {/* Enabled toggle */}
                    <label className="mt-4 flex items-center gap-3 text-sm text-gray-700 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={mfEnabled}
                        onChange={(e) => setMfEnabled(e.target.checked)}
                        className="w-4 h-4 rounded accent-blue-600"
                      />
                      Enabled (visible in the user picker)
                    </label>
                  </div>

                  {/* Form Test + Save row */}
                  {(() => {
                    const fts = testStatus['__form__'] ?? { state: 'idle' };
                    const original = modelForm !== 'new' ? modelForm : null;
                    const pendingPoolKey = mfApiKeys
                      .split('\n')
                      .map((key) => key.trim())
                      .find(Boolean);
                    const pendingTestKey = mfApiKey.trim() || pendingPoolKey || '';
                    const connectionChanged = !!original && (
                      mfProvider !== original.provider ||
                      (mfProvider === 'openai-compatible' ? mfBuiltin : '') !== (original.builtin ?? '') ||
                      (mfProvider === 'openai-compatible' && !mfBuiltin ? mfBaseUrl.trim() : '') !== (original.base_url ?? '') ||
                      mfProviderModel.trim() !== original.providerModel
                    );
                    const originalUsesDirectCredentials = !!original && original.id !== 'custom' &&
                      original.provider === 'openai-compatible' && !original.builtin;
                    const usesDirectCredentials =
                      mfId !== 'custom' && mfProvider === 'openai-compatible' && !mfBuiltin;
                    const testsSavedConnection = !!original && !pendingTestKey && (
                      !connectionChanged ||
                      (usesDirectCredentials && originalUsesDirectCredentials)
                    );
                    const runFormTest = async () => {
                      setTest('__form__', { state: 'running' });
                      try {
                        if (
                          usesDirectCredentials &&
                          !pendingTestKey &&
                          (!original || !originalUsesDirectCredentials)
                        ) {
                          throw new Error('Enter an API key to test this unsaved direct connection.');
                        }
                        const input = testsSavedConnection
                          // Stored secrets are intentionally masked. Test the saved
                          // registry entry unless a fresh raw key makes ad-hoc testing possible.
                          ? { id: mfId }
                          : {
                              config: {
                                provider: mfProvider,
                                ...(mfBuiltin ? { builtin: mfBuiltin as 'kairllm' | 'deepseek' } : {}),
                                ...(usesDirectCredentials && mfBaseUrl.trim() ? { base_url: mfBaseUrl.trim() } : {}),
                                ...(usesDirectCredentials && pendingTestKey ? { api_key: pendingTestKey } : {}),
                                ...(mfProviderModel ? { providerModel: mfProviderModel } : {}),
                              },
                            };
                        const res = await adminTestModel(input);
                        setTest('__form__', { state: 'done', ...res });
                      } catch (e) {
                        setTest('__form__', { state: 'done', ok: false, error: e instanceof Error ? e.message : 'Test failed' });
                      }
                    };
                    return (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            disabled={fts.state === 'running'}
                            onClick={runFormTest}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-gray-300 bg-white hover:bg-gray-50 text-xs font-medium text-gray-700 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {fts.state === 'running' ? (
                              <span className="w-3 h-3 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
                            ) : (
                              <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            {testsSavedConnection ? 'Test saved connection' : 'Test connection'}
                          </button>
                          <SaveButton onClick={saveModel} loading={modelSaving} label="Save model" />
                        </div>
                        {testsSavedConnection && connectionChanged && (
                          <p className="text-[11px] text-amber-700">
                            Unsaved endpoint or model changes require a fresh API key to test; this checks the currently saved connection.
                          </p>
                        )}
                        {fts.state === 'done' && (
                          <div className={`rounded-md px-3 py-2 text-xs flex flex-col gap-0.5 ${fts.ok ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                            <span className="inline-flex items-center gap-1.5 font-medium">
                              {fts.ok ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <X className="h-3.5 w-3.5" aria-hidden="true" />}
                              {fts.ok ? 'Connected' : 'Failed'}
                              {fts.ok && fts.latencyMs !== undefined ? ` - ${fts.latencyMs}ms` : ''}
                            </span>
                            {fts.ok && fts.text && (
                              <span className="text-emerald-700 font-mono text-[11px] truncate" title={fts.text}>
                                reply: {fts.text}
                              </span>
                            )}
                            {!fts.ok && fts.error && (
                              <span className="text-red-700 font-mono text-[11px] break-all">{fts.error}</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  </div>
                </div>
                </ViewportAwareDialog>
              )}

              {/* MODEL LIST TABLE */}
              <Card>
                <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3">
                  <SubsectionHeading>Configured Models</SubsectionHeading>
                  <button
                    type="button"
                    onClick={loadModels}
                    className="text-xs text-blue-600 hover:text-blue-700 transition-colors focus:outline-none focus:underline"
                  >
                    Refresh
                  </button>
                </div>

                {!modelsLoaded ? (
                  <div className="flex items-center gap-2 px-5 py-8 text-sm text-gray-500">
                    <span className="w-3 h-3 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
                    Loading models...
                  </div>
                ) : models.length === 0 ? (
                  <EmptyState message="No models configured yet. Use 'Add model' to create one." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-[900px] w-full table-fixed text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700">
                          {/* 6 columns: identity · connection · access · state · test · actions.
                              Key-pool detail lives in the Key health section below; per-key
                              config is inside Edit — neither is duplicated here. */}
                          <th className="w-[25%] px-3 py-3 text-left text-[11px] font-medium tracking-wide text-gray-500 dark:text-gray-400 uppercase">
                            Model
                          </th>
                          <th className="w-[24%] px-3 py-3 text-left text-[11px] font-medium tracking-wide text-gray-500 dark:text-gray-400 uppercase">
                            Provider / key
                          </th>
                          <th className="w-[10%] px-3 py-3 text-left text-[11px] font-medium tracking-wide text-gray-500 dark:text-gray-400 uppercase">
                            Access
                          </th>
                          <th className="w-[14%] px-3 py-3 text-left text-[11px] font-medium tracking-wide text-gray-500 dark:text-gray-400 uppercase">
                            Key Health
                          </th>
                          <th className="w-[15%] px-3 py-3 text-left text-[11px] font-medium tracking-wide text-gray-500 dark:text-gray-400 uppercase">
                            Connectivity
                          </th>
                          <th className="w-[12%] px-3 py-3 text-right text-[11px] font-medium tracking-wide text-gray-500 dark:text-gray-400 uppercase">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {models.map((m) => {
                          const isStructural = m.id === 'gemini' || m.id === 'custom';
                          const iconText = [m.id, m.label, m.builtin, m.providerModel, m.base_url].filter(Boolean).join(' ');
                          const rts = testStatus[m.id] ?? { state: 'idle' };
                          const runRowTest = async () => {
                            setTest(m.id, { state: 'running' });
                            try {
                              const res = await adminTestModel({ id: m.id });
                              setTest(m.id, { state: 'done', ...res });
                            } catch (e) {
                              setTest(m.id, { state: 'done', ok: false, error: e instanceof Error ? e.message : 'Test failed' });
                            }
                          };
                          return (
                            <tr key={m.id} className="hover:bg-gray-50 transition-colors align-middle">
                              {/* Model — identity: icon, label, default badge, id */}
                              <td className="px-3 py-3">
                                <div className="flex items-start gap-2">
                                  <LlmProviderIcon text={iconText} className="mt-0.5" />
                                  <div className="min-w-0">
                                    <p className="font-medium text-gray-900 leading-snug flex items-center gap-1.5">
                                      <span className="truncate">{m.label}</span>
                                      {m.id === defaultModelId && (
                                        <span
                                          className="inline-flex items-center gap-0.5 shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-700"
                                          title="Platform default model"
                                        >
                                          <Star className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
                                          {t('admin.model.default_badge')}
                                        </span>
                                      )}
                                      {!m.enabled && (
                                        <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                                          disabled
                                        </span>
                                      )}
                                    </p>
                                    <p className="font-mono text-[11px] text-gray-500 mt-0.5">{m.id}</p>
                                  </div>
                                </div>
                              </td>

                              {/* Provider / key — how the model connects and whose key it uses */}
                              <td className="px-3 py-3 whitespace-nowrap overflow-hidden">
                                <p className="text-gray-700 truncate">
                                  {m.provider}
                                  {m.builtin && (
                                    <span className="ml-1.5 text-[10px] uppercase tracking-wide bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded font-medium">
                                      {m.builtin}
                                    </span>
                                  )}
                                </p>
                                <p className="font-mono text-[11px] text-gray-500 mt-0.5 truncate">
                                  {m.providerModel || <span className="text-gray-400">default model</span>}
                                  <span className="mx-1 text-gray-300" aria-hidden="true">·</span>
                                  {m.api_key
                                    ? <span title={m.api_key}>own key</span>
                                    : m.builtin
                                    ? <span className="text-indigo-500">platform key</span>
                                    : m.provider === 'gemini'
                                    ? <span className="text-gray-400">env key</span>
                                    : <span className="text-gray-400">no key</span>}
                                </p>
                              </td>

                              {/* Access — minimum caller access that can use this model */}
                              <td className="px-3 py-3">
                                <span
                                  className={`inline-block text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded ${
                                    m.minTier === 'free'
                                      ? 'bg-gray-100 text-gray-700'
                                      : m.minTier === 'paid'
                                      ? 'bg-blue-50 text-blue-800'
                                      : 'bg-violet-50 text-violet-800'
                                  }`}
                                >
                                  {m.minTier}
                                </span>
                              </td>

                              {/* Status — enabled/disabled pill + key-health dot in one glance
                                  (full health detail lives in the Key health section below) */}
                              <td className="px-3 py-3 whitespace-nowrap">
                                {m.keyHealth ? (() => {
                                  const h = m.keyHealth!;
                                  const cooled = h.anyCooled;
                                  const tip = cooled
                                    ? `Cooling down until ${h.cooldownUntil ?? '?'}${h.lastErrorCode ? ` - last error: ${h.lastErrorCode}` : ''}${h.failureCount !== undefined ? ` - failures: ${h.failureCount}` : ''}`
                                    : `OK${h.failureCount !== undefined ? ` - failures: ${h.failureCount}` : ''}${h.lastFailureAt ? ` - last failure: ${h.lastFailureAt.slice(0, 16).replace('T', ' ')}` : ''}`;
                                  return (
                                    <span
                                      title={tip}
                                      className={`inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded ${
                                        cooled ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                      }`}
                                    >
                                      <span className={`h-1.5 w-1.5 rounded-full ${cooled ? 'bg-amber-500' : 'bg-emerald-500'}`} aria-hidden="true" />
                                      {cooled ? 'cooling' : 'healthy'}
                                    </span>
                                  );
                                })() : (
                                  <span className="text-[11px] text-gray-400">no runtime data</span>
                                )}
                              </td>

                              {/* Connectivity column */}
                              <td className="px-3 py-3 whitespace-nowrap">
                                {!canWriteModels ? (
                                  <span className="text-[11px] text-gray-400">Super only</span>
                                ) : (
                                  <>
                                    {rts.state === 'idle' && (
                                      <button
                                        type="button"
                                        onClick={runRowTest}
                                        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50 text-[11px] font-medium text-gray-600 transition-colors focus:outline-none focus:ring-1 focus:ring-blue-500"
                                      >
                                        <Zap className="h-3 w-3" aria-hidden="true" /> Test
                                      </button>
                                    )}
                                    {rts.state === 'running' && (
                                      <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">
                                        <span className="w-2.5 h-2.5 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
                                        Testing...
                                      </span>
                                    )}
                                    {rts.state === 'done' && (
                                      <span
                                        className={`inline-flex flex-col gap-0.5 text-[11px] ${rts.ok ? 'text-emerald-700' : 'text-red-600'}`}
                                      >
                                        <span className="font-medium flex items-center gap-1">
                                          {rts.ok ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <X className="h-3.5 w-3.5" aria-hidden="true" />}
                                          <span>
                                            {rts.ok
                                              ? `ok${rts.latencyMs !== undefined ? ` - ${rts.latencyMs}ms` : ''}`
                                              : 'failed'}
                                          </span>
                                          <button
                                            type="button"
                                            onClick={runRowTest}
                                            title="Re-test"
                                            className="ml-1 text-gray-400 hover:text-gray-600 text-[10px] leading-none focus:outline-none"
                                          >
                                            <RotateCcw className="h-3 w-3" aria-hidden="true" />
                                          </button>
                                        </span>
                                        {rts.ok && rts.text && (
                                          <span
                                            className="font-mono text-[10px] text-emerald-600 max-w-[110px] truncate block"
                                            title={rts.text}
                                          >
                                            {rts.text}
                                          </span>
                                        )}
                                        {!rts.ok && rts.error && (
                                          <span
                                            className="font-mono text-[10px] text-red-500 max-w-[110px] truncate block"
                                            title={rts.error}
                                          >
                                            {rts.error}
                                          </span>
                                        )}
                                      </span>
                                    )}
                                  </>
                                )}
                              </td>

                              {/* Actions — set default (super), edit, delete */}
                              <td className="px-3 py-3 whitespace-nowrap text-right">
                                {canWriteModels ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => openModelForm(m)}
                                      className="text-xs text-blue-600 hover:text-blue-800 transition-colors focus:outline-none focus:underline mr-2"
                                    >
                                      Edit
                                    </button>
                                    {!isStructural ? (
                                      <button
                                        type="button"
                                        onClick={() => deleteModel(m.id)}
                                        className="text-xs text-red-500 hover:text-red-700 transition-colors focus:outline-none focus:underline"
                                      >
                                        Delete
                                      </button>
                                    ) : (
                                      <span
                                        title="Structural id ? cannot be deleted"
                                        className="text-xs text-gray-300 cursor-not-allowed select-none"
                                      >
                                        Delete
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <span className="text-xs text-gray-400">Read-only</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </section>

            {/* SECTION B: ROUTING POOLS */}
            <section
              ref={(node) => { modelSectionRefs.current.routing = node; }}
              className="scroll-mt-32"
            >
              <RoutingPoolsSection
                models={models}
                routingPools={routingPools}
                moduleRoutes={moduleRoutes}
                canManage={canWriteModels}
                onSave={saveModelRouting}
              />
            </section>

            {/* SECTION C: KEY HEALTH (monitoring) */}
            <section
              ref={(node) => { modelSectionRefs.current.health = node; }}
              className="scroll-mt-32"
            >
              <KeyPoolHealthSection models={models} />
            </section>

            {/* SECTION D: SHARED CREDENTIALS (builtin/legacy platform keys) */}
            <section
              ref={(node) => { modelSectionRefs.current.credentials = node; }}
              data-qa="shared-credentials-section"
              className="scroll-mt-32"
            >
              <div className="mb-4">
                <SectionHeading>Shared Credentials</SectionHeading>
                <p className="mt-1 text-xs text-gray-500">
                  Shared keys are used only by Gemini direct routes and models marked as builtin. Model registry key pools take precedence.
                  {' '}
                  {canWriteModels ? 'Rotate these shared keys only when a builtin model depends on them.' : 'Review masked shared keys and endpoints.'}
                  {' '}
                  Raw keys are never echoed - only masked previews are shown.
                </p>
              </div>

              {/* Single provider selector keeps this low-frequency fallback config compact. */}
              <div className="mb-5 max-w-xs">
                <UserSingleFilterDropdown
                  label="Shared provider"
                  ariaLabel="Choose shared LLM provider credentials"
                  leadingIcon={<LlmProviderIcon text={providerTab} />}
                  value={providerTab}
                  onChange={(next) => {
                    setProviderTab(next as SharedCredentialProvider);
                    setSharedCredentialFeedback(null);
                  }}
                  options={[
                    { value: 'gemini', label: 'Gemini - direct routes' },
                    { value: 'kairllm', label: 'KairLLM - builtin credential' },
                    { value: 'deepseek', label: 'DeepSeek - builtin credential' },
                  ]}
                />
              </div>

              {(() => {
                const meta = {
                  gemini: { label: 'Gemini Shared Credentials', iconText: 'gemini', tier: 'direct routes', tierClass: 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800/50', masked: llm.gemini_api_key_masked, keyPlaceholder: 'AIza... (leave blank to keep current)', note: 'Used by Gemini direct routes and as the Gemini environment fallback.' },
                  kairllm: { label: 'KairLLM Shared Credentials', iconText: 'kairllm', tier: 'builtin only', tierClass: 'bg-indigo-50 text-indigo-700 border-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800/50', masked: llm.kairllm_api_key_masked, keyPlaceholder: 'leave blank to keep current', note: 'Used only by models whose Built-in field is set to kairllm.' },
                  deepseek: { label: 'DeepSeek Shared Credentials', iconText: 'deepseek', tier: 'builtin only', tierClass: 'bg-violet-50 text-violet-700 border-violet-100 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800/50', masked: llm.deepseek_api_key_masked, keyPlaceholder: 'leave blank to keep current', note: 'Used only by models whose Built-in field is set to deepseek.' },
                }[providerTab];

                const newKey = providerTab === 'gemini' ? geminiKey : providerTab === 'kairllm' ? kairllmKey : deepseekKey;
                const onKeyChange = (v: string) => {
                  if (providerTab === 'gemini') setGeminiKey(v);
                  else if (providerTab === 'kairllm') setKairllmKey(v);
                  else setDeepseekKey(v);
                  setTest(providerTab, { state: 'idle' });
                  setSharedCredentialFeedback(null);
                };

                const ts = testStatus[providerTab] ?? { state: 'idle' };
                const runTest = async () => {
                  setTest(providerTab, { state: 'running' });
                  try {
                    let res;
                    if (providerTab === 'gemini') {
                      res = await adminTestModel({ config: { provider: 'gemini', ...(geminiKey ? { api_key: geminiKey } : {}) } });
                    } else if (providerTab === 'kairllm') {
                      res = await adminTestModel({ config: { provider: 'openai-compatible', builtin: 'kairllm', ...(kairllmKey ? { api_key: kairllmKey } : {}), ...(kairllmUrl ? { base_url: kairllmUrl } : {}) } });
                    } else {
                      res = await adminTestModel({ config: { provider: 'openai-compatible', builtin: 'deepseek', ...(deepseekKey ? { api_key: deepseekKey } : {}), ...(deepseekUrl ? { base_url: deepseekUrl } : {}) } });
                    }
                    setTest(providerTab, { state: 'done', ...res });
                  } catch (e) {
                    setTest(providerTab, { state: 'done', ok: false, error: e instanceof Error ? e.message : 'Test failed' });
                  }
                };
                const save = async () => {
                  setLoading(true);
                  setError(null);
                  setSharedCredentialFeedback(null);
                  try {
                    let updated;
                    if (providerTab === 'gemini') {
                      updated = await adminUpdateLlmConfig({ gemini_api_key: geminiKey || undefined, gemini_model: geminiModel || undefined, gemini_fallback_model: geminiFallbackModel || undefined });
                    } else if (providerTab === 'kairllm') {
                      updated = await adminUpdateLlmConfig({ kairllm_api_key: kairllmKey || undefined, kairllm_base_url: kairllmUrl || undefined });
                    } else {
                      updated = await adminUpdateLlmConfig({ deepseek_api_key: deepseekKey || undefined, deepseek_base_url: deepseekUrl || undefined });
                    }
                    setLlm(updated);
                    if (providerTab === 'gemini') setGeminiKey('');
                    else if (providerTab === 'kairllm') setKairllmKey('');
                    else setDeepseekKey('');
                    setSharedCredentialFeedback({
                      type: 'success',
                      message: `${meta.label} saved successfully.`,
                    });
                  } catch (e) {
                    const message = formatAdminPortalError(e, adminRole, `Save ${meta.label} settings`, 'Save failed');
                    setSharedCredentialFeedback({ type: 'error', message });
                    setError(message);
                  } finally {
                    setLoading(false);
                  }
                };

                return (
                  <Card className="p-5 space-y-4 max-w-2xl">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <LlmProviderIcon text={meta.iconText} />
                        <SubsectionHeading>{meta.label}</SubsectionHeading>
                      </div>
                      <span className={`text-[10px] border px-2 py-0.5 rounded font-medium ${meta.tierClass}`}>{meta.tier}</span>
                    </div>
                    <p className="text-xs text-gray-500">{meta.note}</p>

                    <div className="flex items-center gap-2 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-md px-3 py-2">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400 shrink-0">Shared key</span>
                      <span className="font-mono text-xs text-gray-700 dark:text-gray-200 truncate flex-1">
                        {meta.masked || <em className="not-italic text-gray-400">not set</em>}
                      </span>
                    </div>

                    <div>
                      <FieldLabel htmlFor="provider-key">New shared API key</FieldLabel>
                      <input id="provider-key" type="password" value={newKey} onChange={(e) => onKeyChange(e.target.value)} placeholder={meta.keyPlaceholder} disabled={!canWriteModels} className={textInput} autoComplete="off" />
                    </div>

                    {providerTab === 'gemini' ? (
                      <>
                        <div>
                          <FieldLabel htmlFor="gemini-model">Model</FieldLabel>
                          <input id="gemini-model" value={geminiModel} onChange={(e) => setGeminiModel(e.target.value)} placeholder="gemini-3.5-flash" disabled={!canWriteModels} className={textInput} />
                        </div>
                        <div>
                          <FieldLabel htmlFor="gemini-fallback-model">Fallback model</FieldLabel>
                          <input id="gemini-fallback-model" value={geminiFallbackModel} onChange={(e) => setGeminiFallbackModel(e.target.value)} placeholder="gemini-flash-latest" disabled={!canWriteModels} className={textInput} />
                        </div>
                      </>
                    ) : (
                      <div>
                        <FieldLabel htmlFor="provider-url">Base URL</FieldLabel>
                        <input id="provider-url" value={providerTab === 'kairllm' ? kairllmUrl : deepseekUrl} onChange={(e) => (providerTab === 'kairllm' ? setKairllmUrl(e.target.value) : setDeepseekUrl(e.target.value))} placeholder={providerTab === 'kairllm' ? 'https://ai.gogosling.ca/v1' : 'https://api.deepseek.com/v1'} disabled={!canWriteModels} className={textInput} />
                      </div>
                    )}

                    {canWriteModels && (
                      <div className="flex items-center gap-2 pt-1 flex-wrap">
                        <button type="button" disabled={ts.state === 'running'} onClick={runTest} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 text-xs font-medium text-gray-700 dark:text-gray-200 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed">
                          {ts.state === 'running' ? (<span className="w-3 h-3 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />) : (<Zap className="h-3.5 w-3.5" aria-hidden="true" />)}
                          Test connection
                        </button>
                        <SaveButton onClick={save} loading={loading} label="Save" />
                      </div>
                    )}

                    {sharedCredentialFeedback && (
                      <p
                        role={sharedCredentialFeedback.type === 'error' ? 'alert' : 'status'}
                        aria-live="polite"
                        className={`rounded-md border px-3 py-2 text-xs font-medium ${
                          sharedCredentialFeedback.type === 'success'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-900/20 dark:text-emerald-200'
                            : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-200'
                        }`}
                      >
                        {sharedCredentialFeedback.message}
                      </p>
                    )}

                    {ts.state === 'done' && (
                      <div className={`rounded-md px-3 py-2 text-xs flex flex-col gap-0.5 ${ts.ok ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-200 dark:border-emerald-800/50' : 'bg-red-50 text-red-800 border border-red-200 dark:bg-red-900/20 dark:text-red-200 dark:border-red-800/50'}`}>
                        <span className="inline-flex items-center gap-1.5 font-medium">
                          {ts.ok ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <X className="h-3.5 w-3.5" aria-hidden="true" />}
                          {ts.ok ? 'Connected' : 'Failed'}
                          {ts.ok && ts.latencyMs !== undefined ? ` - ${ts.latencyMs}ms` : ''}
                        </span>
                        {ts.ok && ts.text && (<span className="text-emerald-700 dark:text-emerald-300 font-mono text-[11px] truncate" title={ts.text}>reply: {ts.text}</span>)}
                        {!ts.ok && ts.error && (<span className="text-red-700 dark:text-red-300 font-mono text-[11px] break-all">{ts.error}</span>)}
                      </div>
                    )}
                  </Card>
                );
              })()}

              {llm.updated_at && (
                <p className="mt-3 text-xs text-gray-400">
                  Last saved {new Date(llm.updated_at).toLocaleString()} by{' '}
                  <span className="font-mono">{llm.updated_by?.slice(0, 8)}...</span>
                </p>
              )}
            </section>

          </div>
        )}

        {/* PROMPTS */}
        {tab === 'prompts' && (
          <div className="space-y-5">
            {/* Header */}
            <div>
              <SectionHeading>AI Prompts</SectionHeading>
              <p className="mt-1 text-xs text-gray-500">
                Override the default system prompt for any AI function. Edits take effect on
                the next request ? no redeploy needed.{' '}
                <span className="font-medium text-amber-700">
                  Preserve all {'{{placeholder}}'} variables or the function will break.
                </span>
              </p>
            </div>

            {/* Search and filters */}
            <div className="space-y-3">
              <div className="grid gap-2.5 lg:grid-cols-[minmax(240px,1fr)_180px_200px_220px]">
                <div className="relative">
                  <Search className={userFilterIcon} />
                  <input
                    type="search"
                    value={promptSearch}
                    onChange={(e) => setPromptSearch(e.target.value)}
                    placeholder="Search key, module, or purpose"
                    className={`${userFilterControl} pl-9 pr-3`}
                    aria-label="Search prompts"
                  />
                </div>
                <UserFilterDropdown
                  label="Type"
                  options={PROMPT_TYPE_OPTIONS}
                  selected={promptTypeFilters}
                  onChange={setPromptTypeFilters}
                />
                <UserFilterDropdown
                  label="Audience"
                  options={promptAudienceOptions}
                  selected={promptAudienceFilters}
                  onChange={(next) => setPromptAudienceFilters(next as PromptAudience[])}
                />
                <UserFilterDropdown
                  label="Module"
                  options={promptModuleOptions}
                  selected={promptModuleFilters}
                  onChange={setPromptModuleFilters}
                />
              </div>
              {activePromptFilterTags.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {activePromptFilterTags.map((tag) => (
                    <span
                      key={tag.key}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-800 shadow-sm"
                    >
                      {tag.label}
                      <button
                        type="button"
                        onClick={() => removePromptFilter(tag.key)}
                        className="rounded text-blue-500 transition hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                        aria-label={`Remove ${tag.label}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={clearPromptFilters}
                    className="rounded-lg px-2 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  >
                    Clear All
                  </button>
                </div>
              )}
            </div>

            {!promptsLoaded ? (
              <div className="flex items-center gap-2 py-8 text-sm text-gray-500">
                <span className="w-3 h-3 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
                Loading prompts...
              </div>
            ) : prompts.length === 0 ? (
              <EmptyState message="No prompts found." />
            ) : (() => {
              const q = promptSearch.trim().toLowerCase();
              const filtered = prompts.filter((p) => {
                const meta = getPromptMeta(p.key);
                const type = getPromptType(p.key);
                const audience = getPromptAudience(p.key, meta.module);
                const matchesSearch = !q || [
                  p.key,
                  meta.module,
                  meta.purpose,
                  getPromptAudienceLabel(audience),
                ].some((value) => value.toLowerCase().includes(q));
                return matchesSearch
                  && (promptTypeFilters.length === 0 || promptTypeFilters.includes(type))
                  && (promptAudienceFilters.length === 0 || promptAudienceFilters.includes(audience))
                  && (promptModuleFilters.length === 0 || promptModuleFilters.includes(meta.module));
              });

              // Separate tool keys from handler_ keys for grouping
              const handlerPrompts = filtered.filter((p) => p.key.startsWith('handler_'));
              const toolPrompts = filtered.filter((p) => !p.key.startsWith('handler_'));

              const renderGroup = (group: PromptEntry[], groupLabel: string) => {
                if (group.length === 0) return null;
                return (
                  <div key={groupLabel} className="space-y-2">
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-gray-400 px-1">
                      {groupLabel}
                      <span
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-gray-400 hover:text-gray-600"
                        title={PROMPT_GROUP_HELP[groupLabel]}
                        aria-label={`${groupLabel} explanation`}
                      >
                        <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                    </p>
                    <Card>
                      <ul className="divide-y divide-gray-100">
                        {group.map((entry) => {
                          const isExpanded = expandedPromptKey === entry.key;
                          const isOverridden = entry.override !== null;
                          const feedback = promptFeedback[entry.key];
                          const meta = getPromptMeta(entry.key);
                          const audience = getPromptAudience(entry.key, meta.module);
                          const moduleStyle = getPromptModuleStyle(meta.module);

                          return (
                            <li key={entry.key}>
                              {/* Row header ? always visible */}
                              <button
                                type="button"
                                onClick={() => {
                                  if (isExpanded) {
                                    setExpandedPromptKey(null);
                                  } else {
                                    setExpandedPromptKey(entry.key);
                                    setPromptDraft(entry.override ?? entry.default);
                                    // Reset the change summary too ? otherwise the previous
                                    // prompt's summary rides along into this one's save.
                                    setPromptChangeSummary('');
                                    // clear any lingering feedback when re-opening
                                    setPromptFeedback((prev) => {
                                      const next = { ...prev };
                                      delete next[entry.key];
                                      return next;
                                    });
                                  }
                                }}
                                className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-gray-50 transition-colors focus:outline-none focus:bg-gray-50"
                                aria-expanded={isExpanded}
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="flex items-center gap-2.5 min-w-0">
                                    <span className="font-mono text-sm text-gray-800 truncate">
                                      {entry.key}
                                    </span>
                                    {isOverridden && (
                                      <span className="shrink-0 inline-block text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                                        overridden
                                      </span>
                                    )}
                                  </span>
                                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                                    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${moduleStyle}`}>
                                      {meta.module}
                                    </span>
                                    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${PROMPT_AUDIENCE_STYLES[audience]}`}>
                                      {getPromptAudienceLabel(audience)}
                                    </span>
                                    <span className="min-w-0">
                                      <span className="font-medium text-gray-600">Purpose:</span> {meta.purpose}
                                    </span>
                                  </span>
                                </span>
                                <span
                                  className={`shrink-0 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                  aria-hidden="true"
                                >
                                  v
                                </span>
                              </button>

                              {/* Expanded editor */}
                              {isExpanded && (
                                <div className="px-5 pb-5 space-y-3 border-t border-gray-100 bg-gray-50/40">
                                  <p className="pt-3 text-[11px] text-gray-500">
                                    Edit the template below. Variables like{' '}
                                    <code className="bg-gray-100 px-1 rounded text-gray-700 font-mono">
                                      {'{{placeholder}}'}
                                    </code>{' '}
                                    are substituted at runtime and must be kept.
                                  </p>

                                  <textarea
                                    value={promptDraft}
                                    onChange={(e) => setPromptDraft(e.target.value)}
                                    rows={10}
                                    className={`${textInput} font-mono text-xs leading-relaxed resize-y`}
                                    aria-label={`Edit prompt for ${entry.key}`}
                                    spellCheck={false}
                                  />

                                  {/* Inline feedback */}
                                  {feedback?.ok && (
                                    <p className="text-xs text-emerald-700 flex items-center gap-1.5">
                                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                      {feedback.ok}
                                    </p>
                                  )}
                                  {feedback?.err && (
                                    <p className="text-xs text-red-600 flex items-center gap-1.5">
                                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                                      {feedback.err}
                                    </p>
                                  )}

                                  {/* Change summary */}
                                  <div>
                                    <FieldLabel htmlFor={`cs-${entry.key}`}>{t('admin.prompts.change_summary')}</FieldLabel>
                                    <input
                                      id={`cs-${entry.key}`}
                                      value={promptChangeSummary}
                                      onChange={(e) => setPromptChangeSummary(e.target.value)}
                                      placeholder={t('admin.prompts.change_summary_placeholder')}
                                      className={textInput}
                                    />
                                  </div>

                                  {/* Action buttons */}
                                  <div className="flex items-center gap-3 flex-wrap">
                                    {/* Save as Draft (admin + super) */}
                                    <SaveButton
                                      onClick={async () => {
                                        setPromptSaving(true);
                                        try {
                                          await adminSavePromptDraft({
                                            promptKey: entry.key,
                                            content: promptDraft,
                                            changeSummary: promptChangeSummary || undefined,
                                          });
                                          // Also save the legacy override for immediate effect
                                          const res = await adminUpdatePrompt(entry.key, promptDraft);
                                          setPrompts((prev) =>
                                            prev.map((p) =>
                                              p.key === entry.key ? { ...p, override: res.override } : p,
                                            ),
                                          );
                                          setPromptChangeSummary('');
                                          setPromptFeedback((prev) => ({
                                            ...prev,
                                            [entry.key]: { ok: 'Saved as draft.' },
                                          }));
                                          // Refresh version history if open
                                          if (promptVersionsKey === entry.key) {
                                            await loadPromptVersions(entry.key);
                                          }
                                        } catch (e) {
                                          setPromptFeedback((prev) => ({
                                            ...prev,
                                            [entry.key]: { err: e instanceof Error ? e.message : 'Save failed' },
                                          }));
                                        } finally {
                                          setPromptSaving(false);
                                        }
                                      }}
                                      loading={promptSaving}
                                      label={t('admin.prompts.save_draft')}
                                    />

                                    {/* Reset to default */}
                                    <button
                                      type="button"
                                      disabled={!isOverridden || promptSaving}
                                      onClick={async () => {
                                        setPromptSaving(true);
                                        try {
                                          await adminResetPrompt(entry.key);
                                          setPrompts((prev) =>
                                            prev.map((p) =>
                                              p.key === entry.key ? { ...p, override: null } : p,
                                            ),
                                          );
                                          setPromptDraft(entry.default);
                                          setPromptFeedback((prev) => ({
                                            ...prev,
                                            [entry.key]: { ok: 'Reset to default.' },
                                          }));
                                        } catch (e) {
                                          setPromptFeedback((prev) => ({
                                            ...prev,
                                            [entry.key]: { err: e instanceof Error ? e.message : 'Reset failed' },
                                          }));
                                        } finally {
                                          setPromptSaving(false);
                                        }
                                      }}
                                      className={`text-sm px-3 py-2 rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                                        isOverridden && !promptSaving
                                          ? 'text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 focus:ring-red-500'
                                          : 'text-gray-400 bg-gray-100 border border-gray-200 cursor-not-allowed'
                                      }`}
                                      title={isOverridden ? 'Discard override and restore default' : 'No override active'}
                                    >
                                      Reset to default
                                    </button>

                                    {/* Version history toggle */}
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        if (promptVersionsKey === entry.key) {
                                          setPromptVersionsKey(null);
                                        } else {
                                          setPromptVersionsKey(entry.key);
                                          await loadPromptVersions(entry.key);
                                        }
                                      }}
                                      className="text-sm text-blue-600 hover:text-blue-800 transition-colors focus:outline-none focus:underline"
                                    >
                                      {promptVersionsKey === entry.key ? 'Hide history' : t('admin.prompts.versions')}
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => { setExpandedPromptKey(null); setPromptVersionsKey(null); }}
                                      className="text-sm text-gray-500 hover:text-gray-700 transition-colors focus:outline-none focus:underline ml-auto"
                                    >
                                      Close
                                    </button>
                                  </div>

                                  {/* Version history drawer */}
                                  {promptVersionsKey === entry.key && (
                                    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                                      <div className="bg-gray-100 dark:bg-gray-800 px-4 py-2 text-[11px] font-semibold uppercase tracking-widest text-gray-500">
                                        {t('admin.prompts.versions')}
                                      </div>
                                      {promptVersionsFeedback?.err && (
                                        <p className="px-4 py-2 text-xs text-red-600">{promptVersionsFeedback.err}</p>
                                      )}
                                      {promptVersionsLoading ? (
                                        <div className="flex items-center gap-2 px-4 py-4 text-sm text-gray-500">
                                          <span className="w-3 h-3 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
                                          Loading...
                                        </div>
                                      ) : promptVersions.length === 0 ? (
                                        <p className="px-4 py-3 text-sm text-gray-400">{t('admin.prompts.versions_empty')}</p>
                                      ) : (
                                        <ul className="divide-y divide-gray-100 dark:divide-gray-800 max-h-72 overflow-y-auto">
                                          {promptVersions.map((v) => {
                                            const statusColors: Record<string, string> = {
                                              draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
                                              published: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
                                              rolled_back: 'bg-amber-50 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
                                            };
                                            return (
                                              <li key={v.id} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                                  <div className="flex items-center gap-2 text-xs">
                                                    <span className="font-mono text-gray-500">v{v.version}</span>
                                                    <span className={`inline-block text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded ${statusColors[v.status] ?? ''}`}>
                                                      {t(`admin.prompts.status_${v.status}`) || v.status}
                                                    </span>
                                                    <span className="text-gray-400">{v.createdAt?.slice(0, 16).replace('T', ' ')}</span>
                                                    {v.changeSummary && (
                                                      <span className="text-gray-500 italic truncate max-w-[180px]" title={v.changeSummary}>
                                                        {v.changeSummary}
                                                      </span>
                                                    )}
                                                  </div>
                                                  {/* Publish / Rollback ? requires admin.prompts.publish */}
                                                  {canPublishPrompts && (
                                                    <div className="flex items-center gap-2">
                                                      {v.status === 'draft' && (
                                                        <button
                                                          type="button"
                                                          disabled={promptSaving}
                                                          onClick={() => {
                                                            setAdminConfirm({
                                                              title: t('admin.prompts.publish'),
                                                              description: t('admin.prompts.publish_confirm'),
                                                              detail: `${entry.key} - v${v.version}`,
                                                              confirmLabel: t('admin.prompts.publish'),
                                                              run: async () => {
                                                                setPromptSaving(true);
                                                                try {
                                                                  await adminPublishPrompt({ versionId: v.id });
                                                                  setPromptVersionsFeedback({ ok: 'Published.' });
                                                                  await loadPromptVersions(entry.key);
                                                                } catch (e) {
                                                                  setPromptVersionsFeedback({ err: e instanceof Error ? e.message : 'Publish failed' });
                                                                } finally {
                                                                  setPromptSaving(false);
                                                                }
                                                              },
                                                            });
                                                          }}
                                                          className="text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white font-medium transition-colors focus:outline-none disabled:opacity-50"
                                                        >
                                                          {t('admin.prompts.publish')}
                                                        </button>
                                                      )}
                                                      {v.status === 'published' && (
                                                        <span className="text-[10px] text-emerald-600 font-medium">active</span>
                                                      )}
                                                      {(v.status === 'published' || v.status === 'rolled_back') && (
                                                        <button
                                                          type="button"
                                                          disabled={promptSaving || v.status === 'rolled_back'}
                                                          onClick={() => {
                                                            setAdminConfirm({
                                                              title: t('admin.prompts.rollback'),
                                                              description: t('admin.prompts.rollback_confirm'),
                                                              detail: `${entry.key} - v${v.version}`,
                                                              confirmLabel: t('admin.prompts.rollback'),
                                                              tone: 'danger',
                                                              run: async () => {
                                                                setPromptSaving(true);
                                                                try {
                                                                  await adminRollbackPrompt({ versionId: v.id });
                                                                  setPromptVersionsFeedback({ ok: 'Rolled back.' });
                                                                  await loadPromptVersions(entry.key);
                                                                } catch (e) {
                                                                  setPromptVersionsFeedback({ err: e instanceof Error ? e.message : 'Rollback failed' });
                                                                } finally {
                                                                  setPromptSaving(false);
                                                                }
                                                              },
                                                            });
                                                          }}
                                                          className="text-xs px-2 py-1 rounded border border-amber-300 text-amber-700 hover:bg-amber-50 font-medium transition-colors focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                                                        >
                                                          {t('admin.prompts.rollback')}
                                                        </button>
                                                      )}
                                                    </div>
                                                  )}
                                                </div>
                                              </li>
                                            );
                                          })}
                                        </ul>
                                      )}
                                      {promptVersionsFeedback?.ok && (
                                        <p className="px-4 py-2 text-xs text-emerald-700 border-t border-gray-100">{promptVersionsFeedback.ok}</p>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </Card>
                  </div>
                );
              };

              return (
                <div className="space-y-6">
                  {filtered.length === 0 ? (
                    <EmptyState message={activePromptFilterTags.length > 0 ? 'No prompts match the current filters.' : 'No prompts found.'} />
                  ) : (
                    <>
                      {renderGroup(toolPrompts, 'Tool prompts')}
                      {renderGroup(handlerPrompts, 'Handler prompts')}
                    </>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* QUOTAS */}
        {tab === 'quotas' && (
          <div ref={quotaPanelRef} className="space-y-10 pb-24">
            <div className="sticky top-0 z-20 space-y-3">
              <div
                className={`-mx-1 rounded-full border border-gray-200 p-1 transition-all duration-200 ${
                  quotaNavScrolled ? 'bg-white/85 shadow-md backdrop-blur' : 'bg-white shadow-sm'
                }`}
              >
                <div className="flex gap-1 overflow-x-auto">
                  {QUOTA_SECTIONS.map((section) => {
                    const active = section.id === activeQuotaSection;
                    return (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() => scrollToQuotaSection(section.id)}
                        className={`shrink-0 rounded-full px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 sm:flex-1 ${
                          active ? 'bg-blue-700 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                        }`}
                        aria-pressed={active}
                      >
                        {section.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <p className={`text-sm ${hasDirtyQuotas ? 'font-medium text-amber-700' : 'text-gray-500'}`}>
                  {hasDirtyQuotas
                    ? `${dirtyQuotaSections.map((section) => section.label).join(', ')} edited but not saved.`
                    : 'No unsaved quota changes.'}
                </p>
                <button
                  type="button"
                  onClick={saveQuotas}
                  disabled={loading || !hasDirtyQuotas}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
                >
                  {loading && (
                    <span className="h-3 w-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                  )}
                  Save quotas
                </button>
              </div>
            </div>
            <section
              ref={(node) => { quotaSectionRefs.current.global = node; }}
              className="scroll-mt-32"
            >
            <Card className="p-5 space-y-5">
              <div>
                <SectionHeading>Global Quotas</SectionHeading>
                <p className="mt-1 text-xs text-gray-500">
                  Configurable UTC-day limits. A value of 0 removes that configurable limit, while the fixed platform and per-user attempt safety ceilings remain active.
                </p>
              </div>
              <div className="grid md:grid-cols-3 gap-4">
                {(
                  [
                    ['daily_tool_run_limit', 'Platform metered attempts', 'Maximum configurable attempts across all users per UTC day, including failures later refunded. 0 falls back to the 10,000-attempt server safety ceiling.'],
                    ['daily_credit_spend_limit', 'Platform net credit spend', 'Maximum net credits spent across all users per UTC day after settled refunds.'],
                    ['per_user_daily_credit_limit', 'Per-user net credit spend', 'Maximum net credits one user can spend per UTC day after settled refunds.'],
                  ] as const
                ).map(([key, label, description]) => (
                  <div key={key} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <FieldLabel htmlFor={key}>{label}</FieldLabel>
                    <p className="mb-2 text-[11px] leading-relaxed text-gray-500">{description}</p>
                    <input
                      id={key}
                      type="number"
                      min={0}
                      value={Number(quotas[key] ?? 0)}
                      onChange={(e) =>
                        setQuotas((q) => ({ ...q, [key]: Number(e.target.value) }))
                      }
                      className={textInput}
                    />
                    {Number(quotas[key] ?? 0) === 0 && (
                      <span className="mt-2 inline-block rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                        Uncapped
                      </span>
                    )}
                  </div>
                ))}
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <FieldLabel htmlFor="free_max_output_tokens">Free-tier max output tokens</FieldLabel>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1 leading-relaxed">
                    {t('admin_free_cap_help')}
                  </p>
                  <input
                    id="free_max_output_tokens"
                    type="number"
                    min={256}
                    max={32768}
                    step={256}
                    value={Number(quotas.free_max_output_tokens ?? 8192)}
                    onChange={(e) =>
                      setQuotas((q) => ({ ...q, free_max_output_tokens: Number(e.target.value) }))
                    }
                    className={textInput}
                  />
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    Range: 256-32768. Default 8192 = no artificial truncation.
                  </p>
                </div>
                <label className="flex cursor-pointer select-none items-center justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                  <span>
                    <span className="block font-medium text-gray-900">Quota enforcement</span>
                    <span className="mt-1 block text-[11px] leading-relaxed text-gray-500">
                      When off, saved quota values remain visible but runtime gates do not enforce them.
                    </span>
                  </span>
                  <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${quotas.enabled !== false ? 'bg-blue-700' : 'bg-gray-300'}`}>
                    <input
                      type="checkbox"
                      name="quota-enforcement"
                      role="switch"
                      checked={quotas.enabled !== false}
                      onChange={(e) => setQuotas((q) => ({ ...q, enabled: e.target.checked }))}
                      className="sr-only"
                    />
                    <span
                      className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                        quotas.enabled !== false ? 'translate-x-6' : 'translate-x-1'
                      }`}
                      aria-hidden="true"
                    />
                  </span>
                </label>
              </div>
            </Card>
            </section>

            <section
              ref={(node) => { quotaSectionRefs.current.plans = node; }}
              className="scroll-mt-32"
            >
            <Card className="p-5 space-y-4">
              <div>
                <SectionHeading>Plan Quotas</SectionHeading>
                <p className="mt-1 text-xs text-gray-500">
                  Per-user limits by <code>subscription_status</code>, grouped the same way as the Users page plan filter.
                  For daily credits, <strong>0 = Unlimited</strong>. For daily attempts, <strong>0 = server safety ceiling only</strong> (10,000 platform / 500 per user per UTC day). For active jobs, <strong>0 = none allowed</strong>.
                </p>
                <p className="mt-1 text-[11px] text-gray-400">
                  Source: <code>platform_config/quotas</code> (Firestore).{' '}
                  {quotasLoadedAt
                    ? `Loaded ${new Date(quotasLoadedAt).toLocaleTimeString()}.`
                      : 'Loading...'}{' '}
                  Server enforcement cache refreshes within ~60s of a save.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {PLAN_GROUPS.map((group) => (
                  <div key={group.label} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
                    <p className="text-xs font-semibold text-gray-900">{group.label}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{group.description}</p>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-xs text-gray-500 border-b border-gray-200">
                    <tr>
                      <th className="text-left py-2 pr-3 font-medium">Plan</th>
                      {PLAN_QUOTA_FIELDS.map((f) => (
                        <th key={f.key} className="text-left py-2 px-3 font-medium" title={f.tip}>
                          <span className="inline-flex items-center gap-1">
                            {f.header}
                            <CircleHelp className="h-3 w-3 cursor-help text-gray-300" aria-hidden="true" />
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {PLAN_GROUPS.map((group) => (
                      <React.Fragment key={group.label}>
                        <tr>
                          <td colSpan={PLAN_QUOTA_FIELDS.length + 1} className="bg-gray-50 px-3 py-2">
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                              <span className="text-xs font-semibold text-gray-900">{group.label}</span>
                              <span className="text-[11px] text-gray-500">{group.description}</span>
                            </div>
                          </td>
                        </tr>
                        {group.plans.map((plan) => {
                          const row = effectivePlanQuota(quotas, plan);
                          return (
                            <tr key={plan}>
                              <td className="py-3 pr-3 whitespace-nowrap align-top">
                                <span className="block font-medium text-gray-900">{PLAN_LABELS[plan]}</span>
                                <span className="mt-0.5 block text-[11px] text-gray-400">{plan}</span>
                              </td>
                              {PLAN_QUOTA_FIELDS.map((f) => (
                                <td key={f.key} className="py-2 px-3 min-w-[130px] align-top">
                                  <input
                                    type="number"
                                    min={0}
                                    value={row[f.key]}
                                    onChange={(e) => setPlanQuotaField(plan, f.key, Number(e.target.value))}
                                    className={textInput}
                                    aria-label={`${PLAN_LABELS[plan]} ${f.header}`}
                                  />
                                  <span className="mt-1 block min-h-[1.25rem]">
                                    {row[f.key] === 0 && f.zeroLabel && (
                                      <span
                                        className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                          f.zeroLabel === 'Unlimited'
                                            ? 'bg-blue-50 text-blue-700'
                                            : 'bg-amber-50 text-amber-700'
                                        }`}
                                      >
                                        {f.zeroLabel}
                                      </span>
                                    )}
                                  </span>
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            </section>

            <section
              ref={(node) => { quotaSectionRefs.current.posting = node; }}
              className="scroll-mt-32"
            >
            <Card className="p-5 space-y-4">
              <div>
                <SectionHeading>Employer Posting</SectionHeading>
                <p className="mt-1 text-xs text-gray-500">
                  Active job caps are stored in the plan matrix above and enforced by job-posting callables.
                </p>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
                {(['free', 'starter', 'growth', 'pro', 'single_post', 'job_pack'] as AdminPlanKey[]).map((plan) => (
                  <div key={plan} className="border border-gray-200 rounded-md p-3">
                    <div className="text-xs text-gray-500">{PLAN_LABELS[plan]}</div>
                    <div className="mt-1 text-lg font-semibold text-gray-900">
                      {effectivePlanQuota(quotas, plan).active_job_limit}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            </section>

            <section
              ref={(node) => { quotaSectionRefs.current.tools = node; }}
              className="scroll-mt-32"
            >
            <Card className="p-5 space-y-4">
              <div>
                <SectionHeading>Tool Access</SectionHeading>
                <p className="mt-1 text-xs text-gray-500">
                  Disable tools, edit credit prices, and choose which subscription groups can run them.
                  Candidate and employer plans are separate entitlements; free is shared across product roles.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-xs text-gray-500 border-b border-gray-200">
                    <tr>
                      <th className="text-left py-2 pr-3 font-medium">Tool</th>
                      <th className="text-left py-2 px-3 font-medium">Enabled</th>
                      <th className="text-left py-2 px-3 font-medium">Credits</th>
                      <th className="text-left py-2 pl-3 font-medium">Allowed plans</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {TOOL_KEYS.map((tool) => {
                      const row = effectiveToolQuota(quotas, tool);
                      return (
                        <tr key={tool} className="align-top">
                          <td className="py-3 pr-3 whitespace-nowrap">
                            <span className="block font-medium text-gray-900">{tool}</span>
                            {!row.enabled && (
                              <span className="mt-1 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gray-500">
                                disabled
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <input
                              type="checkbox"
                              checked={row.enabled}
                              onChange={(e) => setToolQuotaField(tool, { enabled: e.target.checked })}
                              className="w-4 h-4 rounded accent-blue-600"
                              aria-label={`${tool} enabled`}
                            />
                          </td>
                          <td className="py-2 px-3 min-w-[120px]">
                            <input
                              type="number"
                              min={0}
                              value={row.credit_cost}
                              onChange={(e) => setToolQuotaField(tool, { credit_cost: Math.max(0, Number(e.target.value)) })}
                              className={textInput}
                            />
                          </td>
                          <td className="py-2 pl-3">
                            <div className="grid min-w-[680px] gap-3 lg:grid-cols-3">
                              {PLAN_GROUPS.map((group) => (
                                <fieldset key={group.label} className="rounded-lg border border-gray-200 bg-gray-50/70 px-3 py-2">
                                  <legend className="px-1 text-[11px] font-semibold text-gray-700">{group.label}</legend>
                                  <div className="mt-1 flex flex-wrap gap-1.5">
                                    {group.plans.map((plan) => {
                                      const checked = row.allowed_plans.includes(plan);
                                      return (
                                        <label
                                          key={plan}
                                          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium transition-colors ${
                                            checked
                                              ? 'border-blue-200 bg-blue-50 text-blue-800'
                                              : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-100'
                                          }`}
                                          title={`${PLAN_LABELS[plan]} - ${PLAN_GROUP_LABEL_BY_PLAN[plan]}`}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => toggleToolPlan(tool, plan)}
                                            className="h-3 w-3 rounded accent-blue-600"
                                          />
                                          {PLAN_LABELS[plan]}
                                        </label>
                                      );
                                    })}
                                  </div>
                                </fieldset>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
            </section>

            <section
              ref={(node) => { quotaSectionRefs.current.interview = node; }}
              className="scroll-mt-32"
            >
            <Card className="p-5 space-y-4">
              <div>
                <SectionHeading>Mock Interview</SectionHeading>
                <p className="mt-1 text-xs text-gray-500">
                  Timed simulation access and locked-report unlock pricing. Paid includes candidate and employer paid subscriptions.
                </p>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="flex flex-col">
                  <FieldLabel htmlFor="mi_min_tier">Minimum subscription access</FieldLabel>
                  <p className="mb-1 text-[11px] leading-relaxed text-gray-500">
                    This is a product access gate, not a plan name. Choose whether free accounts can start timed interviews.
                  </p>
                  <UserSingleFilterDropdown
                    label="Access"
                    ariaLabel="Minimum subscription access"
                    menuClassName="w-full min-w-72"
                    options={[
                      { value: 'paid', label: 'Paid subscriptions only (candidate or employer)' },
                      { value: 'free', label: 'All signed-in users (free included)' },
                    ]}
                    value={quotas.mi_min_tier === 'free' ? 'free' : 'paid'}
                    onChange={(next) => setQuotas((q) => ({ ...q, mi_min_tier: next as 'free' | 'paid' }))}
                  />
                </div>
                <div className="flex flex-col">
                  <FieldLabel htmlFor="mi_report_unlock_credits">Report unlock price (credits)</FieldLabel>
                  <p className="mb-1 text-[11px] leading-relaxed text-gray-500">
                    Credits charged when a user unlocks the detailed interview report after the simulation.
                  </p>
                  <input
                    id="mi_report_unlock_credits"
                    type="number"
                    min={0}
                    max={100000}
                    step={50}
                    value={Number(quotas.mi_report_unlock_credits ?? 500)}
                    onChange={(e) =>
                      setQuotas((q) => ({ ...q, mi_report_unlock_credits: Number(e.target.value) }))
                    }
                    className={textInput}
                  />
                </div>
              </div>
            </Card>
            </section>

          </div>
        )}

        {/* USERS */}
        {tab === 'users' && (
          <div className="grid md:grid-cols-[1fr_380px] gap-6 items-start">
            {/* User list */}
            <Card>
              <div className="px-5 py-4 border-b border-gray-200 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <SectionHeading>Users</SectionHeading>
                  <div className="flex items-center gap-2">
                    {canCreateSampleAccounts && (
                      <button
                        type="button"
                        onClick={createSampleAccounts}
                        disabled={sampleAccountsLoading}
                        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        Sample accounts
                      </button>
                    )}
                    <span className="text-xs text-gray-500">
                      {userListLoading ? 'Loading...' : `Page ${userPageIndex + 1} - ${users.length} shown`}
                    </span>
                  </div>
                </div>
                <div className="grid gap-2.5 lg:grid-cols-[minmax(240px,1fr)_150px_190px_160px]">
                  <div className="relative">
                    <Search className={userFilterIcon} />
                    <input
                      type="search"
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      placeholder="Search name, UID, or email"
                      className={`${userFilterControl} pl-9 pr-3`}
                      aria-label="Search users"
                    />
                  </div>
                  <UserFilterDropdown
                    label="Role"
                    options={USER_ROLE_OPTIONS.map((role) => ({ value: role, label: role }))}
                    selected={userRoleFilters}
                    onChange={setUserRoleFilters}
                  />
                  <UserFilterDropdown
                    label="Plan"
                    options={USER_PLAN_FILTER_OPTIONS}
                    selected={userPlanFilters}
                    onChange={setUserPlanFilters}
                  />
                  <UserSingleFilterDropdown
                    label="Joined"
                    options={USER_CREATED_FILTERS}
                    value={userCreatedFilter}
                    onChange={setUserCreatedFilter}
                  />
                </div>
                {activeUserFilterTags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {activeUserFilterTags.map((tag) => (
                      <span
                        key={tag.key}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-800 shadow-sm"
                      >
                        {tag.label}
                        <button
                          type="button"
                          onClick={() => removeUserFilter(tag.key)}
                          className="rounded text-blue-500 transition hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                          aria-label={`Remove ${tag.label}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                    <button
                      type="button"
                      onClick={clearUserFilters}
                      className="rounded-lg px-2 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    >
                      Clear All
                    </button>
                  </div>
                )}
                {sampleAccounts && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-emerald-950">Sample accounts ready</p>
                      <button
                        type="button"
                        onClick={() => setSampleAccounts(null)}
                        className="rounded text-emerald-700 hover:text-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                        aria-label="Dismiss sample account credentials"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-2 grid gap-2 lg:grid-cols-2">
                      {sampleAccounts.map((account) => (
                        <div key={account.email} className="rounded-md border border-emerald-100 bg-white p-2.5 text-xs text-gray-700">
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <span className="font-semibold text-gray-900">
                              {account.kind === 'job_seeker' ? 'Job seeker' : 'Employer'}
                            </span>
                            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                              {account.created ? 'created' : 'reset'}
                            </span>
                          </div>
                          <p className="break-all font-mono">{account.email}</p>
                          <p className="break-all font-mono">{account.password}</p>
                          <p className="mt-1 text-gray-500">
                            {account.subscription_status} / {account.credits.toLocaleString()} credits
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="overflow-x-auto">
                {userListLoading ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-500">
                    <span className="w-3 h-3 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
                    Loading users...
                  </div>
                ) : users.length === 0 ? (
                  <EmptyState message={activeUserFilterTags.length > 0 ? 'No matching users.' : 'No users found.'} />
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="px-5 py-3 text-left text-[11px] font-medium tracking-wide text-gray-500 uppercase">
                          Name
                        </th>
                        <th className="px-5 py-3 text-left text-[11px] font-medium tracking-wide text-gray-500 uppercase">
                          Email
                        </th>
                        <th className="px-5 py-3 text-left text-[11px] font-medium tracking-wide text-gray-500 uppercase">
                          Plan
                        </th>
                        <th className="px-5 py-3 text-right text-[11px] font-medium tracking-wide text-gray-500 uppercase">
                          Credits
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {users.map((u) => {
                        const consoleUser = adminByUid.get(u.uid);
                        const userLabel = u.full_name || u.email || u.uid;
                        return (
                        <tr
                          key={u.uid}
                          className={`cursor-pointer transition-colors hover:bg-gray-50 ${
                            selectedUid === u.uid ? 'bg-blue-50' : ''
                          }`}
                          onClick={() => openUser(u.uid)}
                        >
                          <td className="px-5 py-3 text-gray-900 font-medium">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openUser(u.uid);
                              }}
                              className="rounded text-left hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                              aria-label={`Open user ${userLabel}`}
                            >
                              {u.full_name || (
                                <span className="font-mono text-xs text-gray-500">
                                  {u.uid.slice(0, 10)}...
                                </span>
                              )}
                            </button>
                          </td>
                          <td className="px-5 py-3 text-gray-600">
                            <div className="flex flex-wrap items-center gap-2">
                              <UserAvatarThumb url={u.avatar_url} label={userLabel} roleLabel={u.role} />
                              {u.email || <span className="text-gray-400">-</span>}
                              {consoleUser?.role && (
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                                  {consoleUser.role}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            <PlanBadge plan={u.subscription_status} />
                          </td>
                          <td className="px-5 py-3 text-right tabular-nums text-gray-700">
                            {u.credits}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
              {(userPageIndex > 0 || userCursor) && (
                <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={loadPreviousUserPage}
                    disabled={userPageIndex === 0 || userListLoading}
                    className="text-xs text-blue-600 transition-colors hover:text-blue-700 disabled:cursor-not-allowed disabled:text-gray-400"
                  >
                    Previous
                  </button>
                  <span className="text-xs text-gray-500">Page {userPageIndex + 1}</span>
                  <button
                    type="button"
                    onClick={loadNextUserPage}
                    disabled={!userCursor || userListLoading}
                    className="text-xs text-blue-600 transition-colors hover:text-blue-700 disabled:cursor-not-allowed disabled:text-gray-400"
                  >
                    Next
                  </button>
                </div>
              )}
            </Card>

            {/* User detail panel */}
            {selectedUid && userReport ? (
              <Card className="p-4 space-y-4 md:sticky md:top-4">
                <div className="space-y-1">
                  <SectionHeading>User Detail</SectionHeading>
                  <p className="mt-1 font-mono text-[11px] text-gray-500 break-all">{selectedUid}</p>
                </div>

                {/* Identity / profile fields (email comes from Firebase Auth) */}
                {(() => {
                  const p = ((userReport as { profile?: Record<string, unknown> }).profile ?? {}) as Record<string, unknown>;
                  const a = (userReport as { auth?: Record<string, unknown> | null }).auth ?? null;
                  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
                  const dateStr = (v: unknown) => {
                    const s = str(v);
                    if (!s) return null;
                    const d = new Date(s);
                    return isNaN(d.getTime()) ? s : d.toLocaleString();
                  };
                  const rows: { label: string; value: React.ReactNode }[] = [
                    { label: 'Email', value: str(p.email) ?? (a ? str(a.email) : null) ?? '-' },
                    { label: 'Name', value: str(p.full_name) ?? str(p.company_name) ?? (a ? str(a.display_name) : null) ?? '-' },
                    { label: 'Role', value: str(p.role) ?? '-' },
                    { label: 'Plan', value: str(p.subscription_status) ?? 'free' },
                    { label: 'Credits', value: typeof p.credits === 'number' ? (p.credits as number).toLocaleString() : '-' },
                    { label: 'Joined', value: dateStr(a?.auth_created_at) ?? dateStr(p.created_at) ?? '-' },
                    { label: 'Last sign-in', value: (a && dateStr(a.last_sign_in)) ?? '-' },
                  ];
                  return (
                    <div className="space-y-1 border-t border-gray-200 pt-3">
                      {rows.map((r) => (
                        <div key={r.label} className="flex items-baseline justify-between gap-3">
                          <span className="text-[10px] text-gray-500 uppercase tracking-wide flex-shrink-0">{r.label}</span>
                          <span className="text-xs text-gray-800 text-right break-all">{r.value}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                <div className={`grid ${canManageAdmins ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
                  <div className="bg-gray-50 rounded-lg px-3 py-2">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide">Metered attempts (7d)</p>
                    <p className="text-base font-bold mt-0.5 tabular-nums">
                      {String((userReport as { week_runs?: number }).week_runs ?? 0)}
                      {(userReport as { week_usage_truncated?: boolean }).week_usage_truncated ? '+' : ''}
                    </p>
                  </div>
                  {canManageAdmins && (
                    <div className="bg-gray-50 rounded-lg px-3 py-2">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wide">Admin</p>
                      <p className={`text-base font-bold mt-0.5 ${selectedIsAdmin ? 'text-emerald-700' : 'text-gray-500'}`}>
                        {selectedIsAdmin ? 'Yes' : 'No'}
                      </p>
                    </div>
                  )}
                </div>

                <details className="group rounded-lg border border-gray-200 bg-white">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50">
                    <span>Manage account</span>
                    <ChevronDown className="h-3.5 w-3.5 text-gray-400 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="space-y-4 border-t border-gray-100 p-3">
                {/* Credit adjustment */}
                <div className="space-y-2">
                  <FieldLabel htmlFor="credit-adjustment-delta">Adjust credits (+/-)</FieldLabel>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    {t('admin.credits.delta_constraint')}
                  </p>
                  <div className="flex gap-2">
                    <input
                      id="credit-adjustment-delta"
                      type="number"
                      value={creditDelta}
                      onChange={(e) => setCreditDelta(e.target.value)}
                      min={-5000}
                      max={5000}
                      step={1}
                      className={`${textInput} flex-1`}
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor="credit-adjustment-reason">{t('admin.credits.reason_label')}</FieldLabel>
                    <textarea
                      id="credit-adjustment-reason"
                      value={creditReason}
                      onChange={(e) => setCreditReason(e.target.value)}
                      rows={2}
                      maxLength={300}
                      placeholder={t('admin.credits.reason_placeholder')}
                      className={`${textInput} resize-none`}
                    />
                    <p className={`text-[11px] mt-0.5 ${creditReason.length < 10 || creditReason.length > 300 ? 'text-amber-600' : 'text-gray-400'}`}>
                      {creditReason.length}/300
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={adjustCredits}
                    disabled={creditAdjusting || creditReason.trim().length < 10}
                    aria-busy={creditAdjusting}
                    className="inline-flex items-center gap-2 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-2 rounded-md text-sm font-medium text-white shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
                  >
                    {creditAdjusting && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />}
                    {t('admin.credits.apply')}
                  </button>
                </div>

                {/* Subscription override */}
                <div className="space-y-2">
                  <FieldLabel htmlFor="sub-tier">Subscription tier</FieldLabel>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <UserSingleFilterDropdown
                        label="Plan"
                        options={[
                          { value: '', label: 'Select plan' },
                          ...selectedSubscriptionPlans.map((p) => ({ value: p, label: PLAN_LABELS[p as AdminPlanKey] ?? p })),
                        ]}
                        value={subStatus}
                        onChange={setSubStatus}
                      />
                    </div>
                    <div className="hidden">
                    <select
                      id="sub-tier"
                      value={subStatus}
                      onChange={(e) => setSubStatus(e.target.value)}
                      className={`${userFilterControl} appearance-none rounded-lg bg-white px-3 pr-9 shadow-sm`}
                    >
                      <option value="" disabled>
                        Select plan...
                      </option>
                      {selectedSubscriptionPlans.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    </div>
                    <button
                      type="button"
                      onClick={applySubscription}
                      disabled={!subStatus}
                      className="bg-blue-700 hover:bg-blue-800 px-3 py-2 rounded-md text-sm font-medium text-white shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
                    >
                      Set
                    </button>
                  </div>
                  <p className="text-[11px] leading-5 text-gray-500">
                    Subscription tier changes stay within the user's product role{selectedProductRole ? ` (${selectedProductRole})` : ''}; use a separate account for another product role.
                  </p>
                </div>

                {/* Admin toggle */}
                {canManageAdmins && (
                  <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                    <span className="text-sm text-gray-600">Admin access</span>
                    <button
                      type="button"
                      onClick={toggleSelectedAdmin}
                      aria-pressed={selectedIsAdmin}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors focus:outline-none focus:ring-2 ${
                        selectedIsAdmin
                          ? 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 focus:ring-red-500'
                          : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 focus:ring-emerald-500'
                      }`}
                    >
                      {selectedIsAdmin ? 'Revoke admin' : 'Grant admin'}
                    </button>
                  </div>
                )}
                {canDeleteUsers && (
                  <div className="space-y-2 border-t border-red-100 pt-3">
                    <div className="flex items-start gap-2">
                      <Trash2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
                      <div>
                        <p className="text-sm font-semibold text-red-800">Remove login and profile</p>
                        <p className="text-[11px] leading-5 text-red-700">
                          Removes Firebase Auth access and the parent profile after recurring-billing checks. Shared hiring, financial, audit, Storage, and Stripe records remain pending policy or external follow-up; this is not full data erasure.
                        </p>
                      </div>
                    </div>
                    {selectedIsAdmin && (
                      <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
                        Remove this user from Access Control before deleting the account.
                      </p>
                    )}
                    <div>
                      <FieldLabel>Deletion reason</FieldLabel>
                      <textarea
                        value={deleteReason}
                        onChange={(e) => setDeleteReason(e.target.value)}
                        rows={2}
                        maxLength={300}
                        placeholder="Requested by client; duplicate or invalid account."
                        className={`${textInput} resize-none border-red-200 focus:border-red-500 focus:ring-red-500`}
                      />
                      <p className={`mt-0.5 text-[11px] ${deleteReason.trim().length < 10 || deleteReason.length > 300 ? 'text-amber-600' : 'text-gray-400'}`}>
                        {deleteReason.length}/300
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={deleteSelectedUser}
                      disabled={selectedIsAdmin || deleteReason.trim().length < 10}
                      className="inline-flex items-center gap-1.5 rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2"
                    >
                      <Trash2 className="h-4 w-4" />
                      Remove login &amp; profile
                    </button>
                  </div>
                )}
                  </div>
                </details>

                {/* Week breakdown */}
                <details className="group">
                  <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700 transition-colors select-none list-none flex items-center gap-1">
                      <span className="group-open:rotate-90 transition-transform">&gt;</span>
                    Weekly metered attempts by tool
                  </summary>
                  <pre className="mt-2 text-[11px] bg-gray-50 p-3 rounded-lg overflow-auto max-h-48 text-gray-600 leading-relaxed">
                    {JSON.stringify(
                      (userReport as { week_by_tool?: unknown }).week_by_tool,
                      null,
                      2,
                    )}
                  </pre>
                  {(userReport as { week_usage_truncated?: boolean }).week_usage_truncated && (
                    <p role="status" className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
                      Partial view: metered attempts are capped at 200 records for this report.
                    </p>
                  )}
                </details>
              </Card>
            ) : selectedUid ? (
              <Card className="p-5 md:sticky md:top-4">
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <span className="w-3 h-3 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
                  Loading user report...
                </div>
              </Card>
            ) : (
              <Card className="p-5">
                <p className="text-sm text-gray-500">Select a user to view their report.</p>
              </Card>
            )}
          </div>
        )}

        {/* ADMINS */}
        {tab === 'admins' && canReadAdmins && (
          <div className="max-w-4xl space-y-5">
            <div className="flex rounded-full border border-gray-200 bg-white p-1 shadow-sm">
              {accessTabs.map((item) => {
                const active = item.id === activeAccessTab;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setAccessTab(item.id)}
                    className={`flex-1 rounded-full px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600 ${
                      active ? 'bg-blue-700 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                    aria-pressed={active}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
            {activeAccessTab === 'permissions' && <PermissionMatrix />}
            {activeAccessTab === 'product' && <ProductRoleOverview />}
            {(activeAccessTab === 'console' || activeAccessTab === 'reviewers') && (
            <Card className="p-5 space-y-4">
              <div>
                <div className="flex items-center justify-between gap-3">
                  <SectionHeading>{canManageAdmins ? t('admin.admins.title') : 'Reviewers'}</SectionHeading>
                  <span className="text-xs text-gray-500">{visibleAdmins.length} / {visibleAdminBase.length} visible</span>
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {canManageAdmins ? t('admin.admins.subtitle') : 'Reviewer accounts visible to admins.'}
                </p>
              </div>

              <div className="max-w-xs">
                <UserFilterDropdown
                  label="Role"
                  options={[
                    { value: 'reviewer', label: t('admin.role.reviewer') },
                    { value: 'admin', label: t('admin.role.admin') },
                    { value: 'super', label: t('admin.role.super') },
                  ]}
                  selected={adminRoleFilters}
                  onChange={setAdminRoleFilters}
                />
              </div>

              {/* Invite form */}
              {canManageAdmins && (
              <details className="group rounded-lg border border-emerald-200 bg-emerald-50/40">
                <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-medium text-emerald-900 transition-colors hover:bg-emerald-50">
                  <span className="inline-flex items-center gap-2">
                    <UserPlus className="h-4 w-4" aria-hidden="true" />
                    Invite Admin or Reviewer
                  </span>
                  <ChevronDown className="h-4 w-4 text-emerald-700 transition-transform group-open:rotate-180" />
                </summary>
                <div className="space-y-3 border-t border-emerald-100 p-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <FieldLabel htmlFor="invite-email">{t('admin.admins.invite_label')}</FieldLabel>
                    <input
                      id="invite-email"
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => { setInviteEmail(e.target.value); setInviteFeedback(null); }}
                      onKeyDown={(e) => e.key === 'Enter' && inviteAdmin()}
                      disabled={inviteLoading}
                      placeholder={t('admin.admins.invite_placeholder')}
                      className={textInput}
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor="invite-role">{t('admin.admins.invite_role')}</FieldLabel>
                    <UserSingleFilterDropdown
                      label="Role"
                      options={[
                        { value: 'admin', label: t('admin.role.admin') },
                        { value: 'reviewer', label: t('admin.role.reviewer') },
                      ]}
                      value={inviteRole}
                      onChange={(next) => {
                        if (!inviteLoading) setInviteRole(next as 'admin' | 'reviewer');
                      }}
                    />
                    <div className="hidden">
                      <select
                        id="invite-role"
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value as 'admin' | 'reviewer')}
                        className={`${userFilterControl} appearance-none rounded-lg bg-white px-3 pr-9 shadow-sm`}
                      >
                        <option value="admin">{t('admin.role.admin')}</option>
                        <option value="reviewer">{t('admin.role.reviewer')}</option>
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={inviteAdmin}
                  disabled={!inviteEmail.trim() || inviteLoading}
                  className="inline-flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-2 rounded-md text-sm font-medium text-white shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
                >
                  {inviteLoading && <span className="h-3 w-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
                  {inviteLoading ? 'Inviting...' : t('admin.admins.invite_btn')}
                </button>
                {inviteFeedback?.ok && (
                  <p className="text-xs text-emerald-700 flex items-center gap-1.5"><Check className="h-3.5 w-3.5" aria-hidden="true" />{inviteFeedback.ok}</p>
                )}
                {inviteFeedback?.err && (
                  <p className="text-xs text-red-600 flex items-center gap-1.5"><X className="h-3.5 w-3.5" aria-hidden="true" />{inviteFeedback.err}</p>
                )}
                </div>
              </details>
              )}

              {/* Admin list */}
              {visibleAdmins.length === 0 ? (
                <EmptyState message={canManageAdmins ? t('admin.admins.empty') : 'No reviewers visible.'} />
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {visibleAdmins.map((a) => (
                    <li key={a.uid} className="flex items-center justify-between py-3 gap-3">
                      <UserAvatarThumb url={a.avatar_url} label={a.display_name || a.email || a.uid} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium flex items-center gap-2 flex-wrap">
                          <span>{a.display_name || a.email || '(no email)'}</span>
                          {/* Role badge */}
                          {a.role && (
                            <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium ${
                              a.role === 'super'
                                ? 'bg-violet-50 text-violet-800 dark:bg-violet-900 dark:text-violet-200'
                                : a.role === 'admin'
                                ? 'bg-blue-50 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                                : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                            }`}>
                              {t(`admin.role.${a.role}`)}
                            </span>
                          )}
                          {a.source === 'env' && (
                            <span className="text-[10px] uppercase tracking-wider text-amber-800 bg-amber-50 dark:bg-amber-900 dark:text-amber-200 px-1.5 py-0.5 rounded">
                              bootstrap
                            </span>
                          )}
                          {a.status && a.status !== 'active' && (
                            <span className="text-[10px] text-gray-400">{a.status}</span>
                          )}
                        </p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                          {a.display_name && a.email ? <span>{a.email} - </span> : null}
                          <span className="font-mono">{a.uid}</span>
                        </p>
                        {a.invited_at && (
                          <p className="text-[10px] text-gray-400">{t('admin.admins.invited_at')}: {a.invited_at.slice(0, 10)}</p>
                        )}
                      </div>
                      {canManageAdmins && (
                      a.source === 'env' ? (
                        <span className="text-xs text-gray-400 shrink-0">env only</span>
                      ) : (
                        <div className="flex items-center gap-2 shrink-0">
                          {/* Role change dropdown (only for non-super non-env entries) */}
                          {a.role !== 'super' && (
                            <div className="w-36">
                              <UserSingleFilterDropdown
                                label={t('admin.admins.change_role')}
                                options={[
                                  { value: 'admin', label: t('admin.role.admin') },
                                  { value: 'reviewer', label: t('admin.role.reviewer') },
                                ]}
                                value={a.role ?? 'admin'}
                                onChange={(next) => changeAdminRole(a.uid, next as 'admin' | 'reviewer')}
                              />
                            </div>
                          )}
                          {a.role !== 'super' && (
                            <button
                              type="button"
                              onClick={() => removeAdminEntry(a.uid)}
                              className="text-xs text-red-600 hover:text-red-800 dark:hover:text-red-400 transition-colors focus:outline-none focus:underline"
                            >
                              {t('admin.admins.remove_btn')}
                            </button>
                          )}
                        </div>
                      )
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            )}
          </div>
        )}

        {/* API PLATFORM (developer preview) */}
        {tab === 'apiplatform' && hasAdminPermission(role, 'admin.apiplatform.read') && (
          <ApiPlatformPanel canManage={hasAdminPermission(role, 'admin.apiplatform.manage')} />
        )}

        {/* BILLING (hidden until the standalone workflow is complete) */}
        {tab === 'billing' && hasAdminPermission(role, 'admin.billing.manage') && (
          <Card>
            <div className="px-5 py-4 border-b border-gray-200">
              <SectionHeading>Billing Controls</SectionHeading>
              <p className="mt-0.5 text-xs text-gray-500">
                Subscription and top-up controls are in development.
              </p>
            </div>
            <EmptyState message="User subscription and recharge management will be available here." />
          </Card>
        )}

        {/* WEB3 SETTINGS (experimental) */}
        {tab === 'web3' && hasAdminPermission(role, 'admin.web3.manage') && (
          <Web3SettingsPanel />
        )}

        {/* AUDIT LOG */}
        {tab === 'audit' && (
          <Card>
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <SectionHeading>Audit Log</SectionHeading>
                <p className="mt-0.5 text-xs text-gray-500">
                  {AUDIT_PAGE_SIZE} admin actions per page, newest first. Raw keys are never stored; key changes
                  appear as boolean flags only.
                </p>
              </div>
              <button
                type="button"
                onClick={() => loadAuditLog()}
                className="text-xs text-blue-600 hover:text-blue-700 transition-colors focus:outline-none focus:underline"
              >
                Refresh
              </button>
            </div>

            {!auditLoaded ? (
              <div className="flex items-center gap-2 px-5 py-8 text-sm text-gray-500">
                <span className="w-3 h-3 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
                Loading audit log...
              </div>
            ) : auditLog.length === 0 ? (
              <EmptyState message="No audit log entries yet. Admin actions will appear here." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="px-5 py-3 text-left text-[11px] font-medium tracking-wide text-gray-500 uppercase whitespace-nowrap">
                        Timestamp
                      </th>
                      <th className="px-5 py-3 text-left text-[11px] font-medium tracking-wide text-gray-500 uppercase">
                        Action
                      </th>
                      <th className="px-5 py-3 text-left text-[11px] font-medium tracking-wide text-gray-500 uppercase">
                        Actor
                      </th>
                      <th className="px-5 py-3 text-left text-[11px] font-medium tracking-wide text-gray-500 uppercase">
                        Target
                      </th>
                      <th className="px-5 py-3 text-left text-[11px] font-medium tracking-wide text-gray-500 uppercase">
                        Details
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {auditLog.map((entry) => (
                      <tr key={entry.id} className="hover:bg-gray-50 transition-colors align-top">
                        <td className="px-5 py-3 font-mono text-[11px] text-gray-500 whitespace-nowrap">
                          {entry.created_at
                            ? entry.created_at.slice(0, 19).replace('T', ' ')
                            : <span className="text-gray-400">-</span>}
                        </td>
                        <td className="px-5 py-3">
                          <ActionBadge action={entry.action} />
                        </td>
                        <td className="px-5 py-3 font-mono text-[11px] text-gray-600">
                          {entry.admin_uid.slice(0, 10)}...
                        </td>
                        <td className="px-5 py-3 font-mono text-[11px] text-gray-600">
                          {entry.target_uid ? `${entry.target_uid.slice(0, 10)}...` : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-[11px] text-gray-500 max-w-[280px]">
                          <AuditDetails details={entry.details} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(auditPageIndex > 0 || auditCursor) && (
                  <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-gray-200">
                    <button
                      type="button"
                      onClick={loadPreviousAuditPage}
                      disabled={auditPageIndex === 0 || !auditLoaded}
                      className="text-xs text-blue-600 transition-colors hover:text-blue-700 disabled:cursor-not-allowed disabled:text-gray-400"
                    >
                      Previous
                    </button>
                    <span className="text-xs text-gray-500">Page {auditPageIndex + 1}</span>
                    <button
                      type="button"
                      onClick={loadNextAuditPage}
                      disabled={!auditCursor || !auditLoaded}
                      className="text-xs text-blue-600 transition-colors hover:text-blue-700 disabled:cursor-not-allowed disabled:text-gray-400"
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            )}
          </Card>
        )}
      </AdminShell>
      <ConfirmActionDialog
        open={Boolean(adminConfirm)}
        title={adminConfirm?.title ?? ''}
        description={adminConfirm?.description ?? ''}
        detail={adminConfirm?.detail}
        cancelLabel="Cancel"
        confirmLabel={adminConfirm?.confirmLabel ?? 'Confirm'}
        loadingLabel="Working..."
        loading={adminConfirmLoading}
        tone={adminConfirm?.tone ?? 'primary'}
        onOpenChange={(open) => {
          if (!open && !adminConfirmLoading) setAdminConfirm(null);
        }}
        onCancel={() => {
          if (!adminConfirmLoading) setAdminConfirm(null);
        }}
        onConfirm={runAdminConfirm}
      />
    </ToastProvider>
  );
};

export default AdminPortal;
