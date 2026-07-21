/**
 * Copy for the platform-round admin panels (API Platform, Access Control,
 * Key Health, Web3). Same inline-stub convention as the STRINGS map in
 * AdminPortal.tsx: the console ships English-only as an internal tool, and
 * keeping every visible string behind at() means a future i18n migration is a
 * lookup swap in exactly two files (this one and AdminPortal's stub) - no
 * component changes.
 */
const ADMIN_TEXT: Record<string, string> = {
  // API Platform panel
  'api.banner.title': 'Live Server-Backed Registry',
  'api.banner.body':
    'Applications and keys are stored server-side. Secrets are generated once, hashed at rest, and never shown again after the creation dialog closes.',
  'api.stats.requests': 'Requests this month',
  'api.stats.errors': 'Errors this month',
  'api.stats.apps': 'Applications',
  'api.stats.active_keys': 'Active keys',
  'api.stats.eventual': 'Usage counters update asynchronously and may briefly lag the most recent request log.',
  'api.apps.title': 'Applications',
  'api.apps.subtitle': 'An application groups the keys of one integration partner per environment.',
  'api.apps.create': 'Create application',
  'api.apps.cancel': 'Cancel',
  'api.apps.name': 'Name',
  'api.apps.name_ph': 'e.g. ITviec integration',
  'api.apps.env': 'Environment',
  'api.apps.env_dev': 'Development',
  'api.apps.env_prod': 'Production',
  'api.apps.desc': 'Description',
  'api.apps.desc_ph': 'What does this integration do?',
  'api.apps.submit': 'Create',
  'api.apps.empty': 'No applications yet. Create one to issue API keys.',
  'api.apps.col_app': 'Application',
  'api.apps.col_env': 'Environment',
  'api.apps.col_keys': 'Keys',
  'api.apps.col_created': 'Created',
  'api.apps.issue_key': 'Issue key',
  'api.keys.title': 'API Keys',
  'api.keys.subtitle': 'Only the prefix is stored for display; full secrets are shown once at creation.',
  'api.keys.empty': 'No keys issued yet.',
  'api.keys.col_name': 'Name',
  'api.keys.col_key': 'Key',
  'api.keys.col_scopes': 'Scopes',
  'api.keys.col_status': 'Status',
  'api.keys.col_limits': 'Limits',
  'api.keys.col_last_used': 'Last used',
  'api.keys.disable': 'Disable',
  'api.keys.enable': 'Enable',
  'api.keys.revoke': 'Revoke',
  'api.keys.never': 'Never',
  'api.logs.title': 'Recent Requests',
  'api.logs.subtitle': 'Recent partner API calls recorded by the server gateway.',
  'api.logs.empty': 'No requests recorded.',
  'api.logs.col_time': 'Time',
  'api.logs.col_key': 'Key',
  'api.logs.col_endpoint': 'Endpoint',
  'api.logs.col_status': 'Status',
  'api.logs.col_latency': 'Latency',
  'api.docs.title': 'Documentation',
  'api.docs.body':
    'Endpoint reference and request examples live with the API docs. Personal keys can be enabled from account settings later; the applications on this page are for partner-level integrations.',
  'api.docs.link': 'Open API reference',
  'api.docs.endpoints': 'Gateway endpoints',
  'api.docs.auth_hint': 'Partners authenticate every request with their key:',
  'api.modal.issue_title': 'Issue Key',
  'api.modal.key_name': 'Key name',
  'api.modal.key_name_ph': 'e.g. Server-to-server',
  'api.modal.scopes': 'Scopes',
  'api.modal.cancel': 'Cancel',
  'api.modal.generate': 'Generate key',
  'api.modal.prod_confirm':
    'This issues a PRODUCTION key. It will count against live quotas and should only be shared over a secure channel. Continue?',
  'api.secret.title': 'Copy Your New Key',
  'api.secret.warning': 'This secret is shown once. After closing, only the prefix remains visible.',
  'api.secret.copy': 'Copy',
  'api.secret.copied': 'Copied',
  'api.secret.confirm': 'I have stored this key',
  'api.revoke.confirm_prefix': 'Revoke',
  'api.revoke.confirm_suffix': 'Calls with this key stop working immediately. This cannot be undone.',
  'api.error.load': 'Could not load the API platform data.',
  'api.error.retry': 'Retry',

  // Key health section
  'pool.title': 'Key Health',
  'pool.subtitle':
    'Runtime key-pool observations from key_health. This is not a live Test result: records appear only after routed model calls use or fail a key.',
  'pool.col_model': 'Model',
  'pool.col_keys': 'Keys',
  'pool.col_status': 'Status',
  'pool.col_failures': 'Runtime failures',
  'pool.col_cooldown': 'Cooldown until',
  'pool.col_last_error': 'Last error',
  'pool.col_route': 'Model fallback',
  'pool.status_no_data': 'no runtime data',
  'pool.status_cooling': 'cooling',
  'pool.status_healthy': 'healthy',
  'pool.route_auto': 'implicit fallback by priority',
  'pool.route_explicit': 'Explicit',
  'pool.route_implicit': 'Implicit by priority',
  'pool.route_none': 'none',

  // Access control sections
  'access.matrix.title': 'Roles & Permissions',
  'access.matrix.subtitle':
    'Predefined roles. The server enforces every action; this matrix mirrors the registry in lib/access/permissions.ts.',
  'access.matrix.col_capability': 'Capability',
  'access.product.title': 'Product Roles',
  'access.product.subtitle':
    'Application-side access by account type. Enforced by route guards and the server-side model access gate (resolveProvider).',

  // Web3 settings panel
  'web3.banner.title': 'Preview Module',
  'web3.banner.body':
    'Runs as an optional Sepolia preview. The core product never requires a wallet.',
  'web3.toggle.title': 'Web3 Identity Module',
  'web3.toggle.desc':
    'Controls the candidate-facing surface: the wallet section in Account and the Identity & Wallet workspace view (Proof-of-Talent credential, staking, rewards). When off, both are hidden entirely; sign-in, payments, and all AI features are unaffected.',
  'web3.toggle.aria': 'Toggle Web3 module',
  'web3.toggle.on': 'Enabled: candidates can see the wallet and credential surfaces.',
  'web3.toggle.off': 'Disabled: all Web3 surfaces are hidden from the product.',
  'web3.toggle.scope_note':
    'Scope note: this switch is platform-wide. Candidate wallet and Identity & Wallet surfaces read the server config after mount; cached local state is used only as a first-paint fallback.',
  'web3.error.load': 'Could not load Web3 settings.',
  'web3.error.save': 'Could not save Web3 settings.',
  'web3.updated_prefix': 'Last updated',
  'web3.usage.title': 'What This Module Covers',
  'web3.contract.title': 'Contract',
  'web3.contract.network': 'Network',
  'web3.contract.address': 'Proof-of-Talent',
  'web3.runtime.title': 'Runtime Mode',
  'web3.runtime.desc':
    'Preview saves credential state to the user profile. Live sends Sepolia transactions to the configured contract.',
  'web3.runtime.preview': 'Preview mode: no on-chain transactions.',
  'web3.runtime.live': 'Live mode: wallet actions use the contract.',
  'web3.runtime.save': 'Save runtime settings',
  'web3.runtime.saving': 'Saving...',
};

export const at = (key: string): string => ADMIN_TEXT[key] ?? key;
