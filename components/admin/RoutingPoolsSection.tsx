import React, { useEffect, useMemo, useState } from 'react';
import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown, CircleHelp, PlugZap, Trash2, X } from 'lucide-react';
import { MODULE_ROUTE_GROUPS, MODULE_ROUTE_TOOL_LABELS, adminTestModel, type ModelEntry, type ModuleRoutes, type RoutingPool, type RoutingPoolMember, type TestModelResult } from '../../services/adminClient';
import { Card, EmptyState, FieldLabel, SaveButton, SectionHeading, SubsectionHeading, tableCell, tableHead, tableRow, textInput } from './adminUi';
import ConfirmActionDialog from '../ConfirmActionDialog';

const ANY_KEY_VALUE = '__any_configured_key__';

// Client-only stable identities. Server state has no uids, and identity-free
// keys (pool.id / row index) caused real bugs: editing pool.id remounted the
// card on every keystroke (focus loss), and index-keyed test results migrated
// onto neighbouring rows after a delete. uids are attached on load / row
// creation and stripped before anything is sent to the backend.
let editorUidCounter = 0;
const nextEditorUid = () => `u${++editorUidCounter}`;

type EditableMember = RoutingPoolMember & { uid: string };
type EditablePool = Omit<RoutingPool, 'members'> & { uid: string; members: EditableMember[] };

const toEditable = (pools: RoutingPool[]): EditablePool[] => pools.map((pool) => ({
  ...pool,
  uid: nextEditorUid(),
  members: pool.members.map((member) => ({ ...member, uid: nextEditorUid() })),
}));

const toPayload = (pools: EditablePool[]): RoutingPool[] => pools.map(({ uid: _poolUid, members, ...pool }) => ({
  ...pool,
  members: members.map(({ uid: _memberUid, ...member }) => member),
}));

const emptyPool = (index: number): EditablePool => ({
  uid: nextEditorUid(),
  id: `pool_${index}`,
  label: `Pool ${index}`,
  enabled: true,
  members: [],
});

const nextPoolIndex = (pools: EditablePool[]) => {
  const ids = new Set(pools.map((pool) => pool.id));
  let index = pools.length + 1;
  while (ids.has(`pool_${index}`)) index += 1;
  return index;
};

const POOL_CARD_TONES = [
  'border-sky-200 bg-sky-50/70 shadow-sky-100/70',
  'border-orange-200 bg-orange-50/70 shadow-orange-100/70',
  'border-emerald-200 bg-emerald-50/70 shadow-emerald-100/70',
  'border-violet-200 bg-violet-50/70 shadow-violet-100/70',
  'border-rose-200 bg-rose-50/70 shadow-rose-100/70',
  'border-cyan-200 bg-cyan-50/70 shadow-cyan-100/70',
];

const POOL_NUMBER_TONES = [
  'text-sky-400/35',
  'text-orange-400/35',
  'text-emerald-400/35',
  'text-violet-400/35',
  'text-rose-400/35',
  'text-cyan-400/35',
];

type MemberTestState = { state: 'running' } | ({ state: 'done' } & TestModelResult);

type AdminSelectOption = {
  value: string;
  label: string;
};

const ToggleSwitch: React.FC<{
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}> = ({ checked, disabled, label, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className="inline-flex items-center gap-2 rounded-full text-sm font-medium text-gray-700 transition disabled:cursor-not-allowed disabled:opacity-60"
  >
    <span
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border p-0.5 shadow-inner transition-colors ${
        checked ? 'border-emerald-500 bg-emerald-500' : 'border-gray-300 bg-gray-200'
      }`}
    >
      <span
        className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </span>
    <span>{label}</span>
  </button>
);

const AdminSelect: React.FC<{
  value?: string;
  options: AdminSelectOption[];
  disabled?: boolean;
  placeholder: string;
  onChange: (value: string) => void;
}> = ({ value, options, disabled, placeholder, onChange }) => {
  const selectedValue = options.some((option) => option.value === value) ? value : undefined;

  return (
    <Select.Root value={selectedValue} disabled={disabled || options.length === 0} onValueChange={onChange}>
      <Select.Trigger
        className={`${textInput} flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400`}
      >
        <Select.Value placeholder={options.length === 0 ? 'No options available' : placeholder} />
        <Select.Icon asChild>
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl ring-1 ring-black/5"
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
};

export const RoutingPoolsSection: React.FC<{
  models: ModelEntry[];
  routingPools: RoutingPool[];
  moduleRoutes: ModuleRoutes;
  canManage: boolean;
  onSave: (routingPools: RoutingPool[], moduleRoutes: ModuleRoutes) => Promise<void>;
}> = ({ models, routingPools, moduleRoutes, canManage, onSave }) => {
  const [pools, setPools] = useState<EditablePool[]>(() => toEditable(routingPools));
  const [routes, setRoutes] = useState<ModuleRoutes>(() => ({ ...moduleRoutes }));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok?: string; err?: string } | null>(null);
  // Captured at click time so the confirm dialog keeps showing the right pool
  // name while the async delete runs (indexes shift as soon as state updates).
  const [poolPendingDelete, setPoolPendingDelete] = useState<{ uid: string; name: string } | null>(null);
  const [memberTests, setMemberTests] = useState<Record<string, MemberTestState>>({});

  useEffect(() => {
    setPools(toEditable(routingPools));
    setRoutes({ ...moduleRoutes });
  }, [routingPools, moduleRoutes]);

  // Poolable models exclude the "custom" BYOA sentinel: it has no platform
  // key/URL (per-user config only) and the server rejects it as a pool member.
  const enabledModels = useMemo(() => models.filter((model) => model.enabled && model.id !== 'custom'), [models]);
  const modelOptions = useMemo(
    () => enabledModels.map((model) => ({ value: model.id, label: `${model.label} (${model.id})` })),
    [enabledModels],
  );
  const poolOptions = pools.filter((pool) => pool.id.trim());
  const routePoolOptions = poolOptions.map((pool) => ({ value: pool.id, label: `${pool.label} (${pool.id})` }));
  const moduleRows = useMemo(() => {
    const known = new Set<string>(MODULE_ROUTE_GROUPS.flatMap((group) => [...group.routes]));
    const custom = Object.keys(routes)
      .filter((key) => !known.has(key))
      .map((key) => ({ key, label: key, routes: [key] }));
    return [...MODULE_ROUTE_GROUPS, ...custom];
  }, [routes]);
  const routedToolCount = useMemo(
    () => new Set(moduleRows.flatMap((row) => [...row.routes])).size,
    [moduleRows],
  );
  const routeValueFor = (routeKeys: readonly string[]) => {
    const first = routes[routeKeys[0]];
    return first && routeKeys.every((key) => routes[key] === first) ? first : undefined;
  };
  const routeHintFor = (routeKeys: readonly string[]) =>
    routeKeys
      .map((key) => `${MODULE_ROUTE_TOOL_LABELS[key] ?? key} (${key})`)
      .join('\n');

  const updatePool = (index: number, patch: Partial<Pick<EditablePool, 'id' | 'label' | 'enabled'>>) => {
    // Renaming a pool id must drag its module routes along, otherwise every
    // route pointing at the old id goes blank and the next save is rejected
    // server-side with "references unknown pool".
    if (patch.id !== undefined) {
      const oldId = pools[index]?.id;
      const newId = patch.id;
      if (oldId && oldId !== newId) {
        setRoutes((prev) => Object.fromEntries(
          Object.entries(prev).map(([routeKey, poolId]) => [routeKey, poolId === oldId ? newId : poolId]),
        ));
      }
    }
    setPools((prev) => prev.map((pool, i) => (i === index ? { ...pool, ...patch } : pool)));
    setFeedback(null);
  };

  const updateMember = (poolIndex: number, memberIndex: number, patch: Partial<RoutingPool['members'][number]>) => {
    setPools((prev) => prev.map((pool, i) => {
      if (i !== poolIndex) return pool;
      return {
        ...pool,
        members: pool.members.map((member, j) => (j === memberIndex ? { ...member, ...patch } : member)),
      };
    }));
    setFeedback(null);
  };

  // Keyed by the row's stable uid (plus what is being tested) so results never
  // migrate onto another row after deletes/reorders, and editing the member's
  // model or key naturally resets it to the untested state.
  const memberTestKey = (member: EditableMember) =>
    `${member.uid}:${member.modelId}:${member.keyHash ?? 'any'}`;

  const runMemberTest = async (testKey: string, member: EditableMember) => {
    setMemberTests((prev) => ({ ...prev, [testKey]: { state: 'running' } }));
    try {
      // keyHash goes to the backend as-is; adminTestModel resolves it with the
      // same pinnable-key semantics as the runtime router, so a green badge
      // means the exact key this member will use is healthy.
      const result = await adminTestModel({
        id: member.modelId,
        ...(member.keyHash ? { keyHash: member.keyHash } : {}),
      });
      setMemberTests((prev) => ({ ...prev, [testKey]: { state: 'done', ...result } }));
    } catch (err) {
      setMemberTests((prev) => ({
        ...prev,
        [testKey]: {
          state: 'done',
          ok: false,
          error: err instanceof Error ? err.message : 'Test failed.',
        },
      }));
    }
  };

  const addMember = (poolIndex: number) => {
    const firstModel = enabledModels[0];
    if (!firstModel) return;
    setPools((prev) => prev.map((pool, i) => (
      i === poolIndex
        ? { ...pool, members: [...pool.members, { uid: nextEditorUid(), modelId: firstModel.id, tier: 1, weight: 100, enabled: true }] }
        : pool
    )));
    setFeedback(null);
  };

  const removeMember = (poolIndex: number, memberIndex: number) => {
    setPools((prev) => prev.map((pool, i) => (
      i === poolIndex ? { ...pool, members: pool.members.filter((_, j) => j !== memberIndex) } : pool
    )));
    setFeedback(null);
  };

  const removePool = async (poolUid: string) => {
    const removedPool = pools.find((pool) => pool.uid === poolUid);
    if (!removedPool) return;

    const nextPools = pools.filter((pool) => pool.uid !== poolUid);
    const nextPoolIds = new Set(nextPools.map((pool) => pool.id).filter(Boolean));
    const fallbackPoolId = nextPools.find((pool) => pool.id.trim())?.id;
    const nextRoutes = nextPoolIds.has(removedPool.id)
      ? routes
      : Object.fromEntries(
        Object.entries(routes).flatMap(([routeKey, poolId]) => {
          if (poolId !== removedPool.id) return [[routeKey, poolId]];
          return fallbackPoolId ? [[routeKey, fallbackPoolId]] : [];
        }),
      );

    setPools(nextPools);
    setRoutes(nextRoutes);
    setSaving(true);
    setFeedback(null);
    try {
      await onSave(toPayload(nextPools), nextRoutes);
      setFeedback({ ok: 'Routing pool deleted.' });
    } catch (err) {
      setPools(pools);
      setRoutes(routes);
      setFeedback({ err: err instanceof Error ? err.message : 'Failed to delete routing pool.' });
    } finally {
      // Close the dialog either way — on failure the state is already reverted
      // and the error is shown in the feedback strip, not behind a stuck modal.
      setPoolPendingDelete(null);
      setSaving(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      await onSave(toPayload(pools), routes);
      setFeedback({ ok: 'Routing pools saved.' });
    } catch (err) {
      setFeedback({ err: err instanceof Error ? err.message : 'Failed to save routing pools.' });
    } finally {
      setSaving(false);
    }
  };

  const addPool = async () => {
    const nextPools = [...pools, emptyPool(nextPoolIndex(pools))];
    setPools(nextPools);
    setSaving(true);
    setFeedback(null);
    try {
      await onSave(toPayload(nextPools), routes);
      setFeedback({ ok: 'Routing pool added.' });
    } catch (err) {
      setPools(pools);
      setFeedback({ err: err instanceof Error ? err.message : 'Failed to add routing pool.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-gray-200 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <SectionHeading>Routing Pools</SectionHeading>
          <p className="mt-1 text-xs text-gray-500">
            Modules choose a pool before the dashboard default model is considered; lower failover orders run first, and weights split traffic inside the same order.
          </p>
        </div>
        {canManage && <SaveButton onClick={save} loading={saving} label="Save routing" />}
      </div>

      <div className="border-b border-gray-200 border-l-4 border-l-sky-500 bg-sky-50/70 px-5 py-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <SubsectionHeading>Module Routes</SubsectionHeading>
          </div>
          <span className="w-fit rounded-md border border-sky-200 bg-white/80 px-2 py-1 text-xs font-medium text-sky-700">
            {moduleRows.length} modules / {routedToolCount} tools
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {moduleRows.map((route) => (
            <label key={route.key} className="block">
              <span className="mb-1 flex items-center gap-1 text-xs font-medium text-gray-700">
                {route.label}
                <span
                  aria-label={`${route.label} included tools`}
                  title={routeHintFor(route.routes)}
                >
                  <CircleHelp className="h-3.5 w-3.5 cursor-help text-gray-400" aria-hidden="true" />
                </span>
              </span>
              <AdminSelect
                value={routeValueFor(route.routes)}
                disabled={!canManage}
                options={routePoolOptions}
                placeholder={route.routes.some((key) => routes[key]) ? 'Mixed pools' : 'Select pool'}
                onChange={(value) => {
                  setRoutes((prev) => ({
                    ...prev,
                    ...Object.fromEntries(route.routes.map((key) => [key, value])),
                  }));
                  setFeedback(null);
                }}
              />
            </label>
          ))}
        </div>
        {feedback?.ok && <p className="mt-3 text-xs font-medium text-emerald-700">{feedback.ok}</p>}
        {feedback?.err && <p className="mt-3 text-xs font-medium text-red-600">{feedback.err}</p>}
      </div>

      <div className="space-y-5 p-5">
        {pools.length === 0 ? (
          <EmptyState message="No routing pools configured." />
        ) : (
          pools.map((pool, poolIndex) => (
            <div
              key={pool.uid}
              className={`relative overflow-hidden rounded-lg border shadow-sm ${POOL_CARD_TONES[poolIndex % POOL_CARD_TONES.length]}`}
            >
              <div
                aria-hidden="true"
                className={`pointer-events-none absolute right-7 top-2 select-none text-[6.5rem] font-black leading-none ${POOL_NUMBER_TONES[poolIndex % POOL_NUMBER_TONES.length]} sm:right-10 sm:top-1 sm:text-[8rem]`}
              >
                {String(poolIndex + 1).padStart(2, '0')}
              </div>
              <div className="relative grid gap-3 border-b border-white/70 bg-white/45 p-4 sm:grid-cols-[1fr_1fr_auto_auto]">
                <div>
                  <FieldLabel htmlFor={`pool-id-${poolIndex}`}>Pool id</FieldLabel>
                  <input
                    id={`pool-id-${poolIndex}`}
                    value={pool.id}
                    disabled={!canManage}
                    onChange={(e) => updatePool(poolIndex, { id: e.target.value })}
                    className={textInput}
                  />
                </div>
                <div>
                  <FieldLabel htmlFor={`pool-label-${poolIndex}`}>Display name</FieldLabel>
                  <input
                    id={`pool-label-${poolIndex}`}
                    value={pool.label}
                    disabled={!canManage}
                    onChange={(e) => updatePool(poolIndex, { label: e.target.value })}
                    className={textInput}
                  />
                </div>
                <div className="flex items-end pb-2">
                  <ToggleSwitch
                    checked={pool.enabled}
                    disabled={!canManage}
                    label="Enabled"
                    onChange={(enabled) => updatePool(poolIndex, { enabled })}
                  />
                </div>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => setPoolPendingDelete({ uid: pool.uid, name: pool.label || pool.id })}
                    className="inline-flex min-h-10 items-center justify-center gap-2 self-end rounded-lg border border-red-200 bg-white/80 px-3 py-2 text-sm font-semibold text-red-600 shadow-sm transition hover:bg-red-50 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-red-500/20"
                    aria-label={`Delete routing pool ${pool.label || pool.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                )}
              </div>

              <div className="relative overflow-x-auto bg-white/60">
                <table className="w-full">
                  <thead>
                    <tr className="bg-white/70">
                      <th className={tableHead}>Model</th>
                      <th className={tableHead}>Saved key</th>
                      <th className={`${tableHead} w-24`}>Failover order</th>
                      <th className={`${tableHead} w-28`}>Weight</th>
                      <th className={tableHead}>State</th>
                      <th className={tableHead}>Connectivity</th>
                      <th className={tableHead}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pool.members.map((member, memberIndex) => {
                      const model = models.find((m) => m.id === member.modelId);
                      const keyOptions = model?.key_previews ?? [];
                      const testKey = memberTestKey(member);
                      const testState = memberTests[testKey];
                      const savedKeyOptions = [
                        { value: ANY_KEY_VALUE, label: 'Any configured key' },
                        ...keyOptions.map((key) => ({ value: key.hash, label: `${key.masked} (${key.hash})` })),
                      ];
                      return (
                        <tr key={member.uid} className={tableRow}>
                          <td className={tableCell}>
                            <AdminSelect
                              value={member.modelId}
                              disabled={!canManage}
                              options={modelOptions}
                              placeholder="Select model"
                              onChange={(value) => updateMember(poolIndex, memberIndex, { modelId: value, keyHash: undefined })}
                            />
                          </td>
                          <td className={tableCell}>
                            <AdminSelect
                              value={member.keyHash ?? ANY_KEY_VALUE}
                              disabled={!canManage}
                              options={savedKeyOptions}
                              placeholder="Select key"
                              onChange={(value) => updateMember(poolIndex, memberIndex, { keyHash: value === ANY_KEY_VALUE ? undefined : value })}
                            />
                          </td>
                          <td className={`${tableCell} w-24`}>
                            <input
                              type="number"
                              min={1}
                              value={member.tier}
                              disabled={!canManage}
                              onChange={(e) => updateMember(poolIndex, memberIndex, { tier: Math.max(1, Number(e.target.value)) })}
                              className={`${textInput} w-16`}
                            />
                          </td>
                          <td className={`${tableCell} w-28`}>
                            <input
                              type="number"
                              min={1}
                              value={member.weight}
                              disabled={!canManage}
                              onChange={(e) => updateMember(poolIndex, memberIndex, { weight: Math.max(1, Number(e.target.value)) })}
                              className={`${textInput} w-20`}
                            />
                          </td>
                          <td className={tableCell}>
                            <ToggleSwitch
                              checked={member.enabled}
                              disabled={!canManage}
                              label="Active"
                              onChange={(enabled) => updateMember(poolIndex, memberIndex, { enabled })}
                            />
                          </td>
                          <td className={tableCell}>
                            <div className="flex min-w-36 items-center gap-2">
                              <button
                                type="button"
                                onClick={() => runMemberTest(testKey, member)}
                                disabled={!canManage || testState?.state === 'running'}
                                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-sky-200 bg-white px-3 text-xs font-semibold text-sky-700 shadow-sm transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {testState?.state === 'running' ? (
                                  <span className="h-3.5 w-3.5 rounded-full border-2 border-sky-200 border-t-sky-600 animate-spin" />
                                ) : (
                                  <PlugZap className="h-3.5 w-3.5" />
                                )}
                                {testState?.state === 'done' ? 'Re-test' : 'Test'}
                              </button>
                              {testState?.state === 'done' && (
                                <span
                                  className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${
                                    testState.ok
                                      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                                      : 'bg-red-50 text-red-700 ring-1 ring-red-200'
                                  }`}
                                  title={testState.ok ? testState.text : testState.error}
                                >
                                  {testState.ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                                  {testState.ok ? `${testState.latencyMs ?? 0} ms` : 'Failed'}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className={tableCell}>
                            {canManage && (
                              <button
                                type="button"
                                onClick={() => removeMember(poolIndex, memberIndex)}
                                className="text-xs font-medium text-red-600 hover:text-red-800"
                              >
                                Remove
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {canManage && (
                <div className="relative border-t border-white/70 bg-white/45 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => addMember(poolIndex)}
                    disabled={enabledModels.length === 0}
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Add member
                  </button>
                </div>
              )}
            </div>
          ))
        )}

        {canManage && (
          <button
            type="button"
            onClick={addPool}
            disabled={saving}
            className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Adding...' : 'Add pool'}
          </button>
        )}
      </div>
      <ConfirmActionDialog
        open={poolPendingDelete !== null}
        title="Delete routing pool"
        description="Delete this routing pool? Module routes that use it will be moved to the next available pool."
        detail={poolPendingDelete?.name}
        cancelLabel="Cancel"
        confirmLabel="Delete pool"
        loadingLabel="Deleting..."
        loading={saving}
        tone="danger"
        onOpenChange={(open) => {
          if (!open && !saving) setPoolPendingDelete(null);
        }}
        onCancel={() => setPoolPendingDelete(null)}
        onConfirm={() => {
          if (poolPendingDelete) removePool(poolPendingDelete.uid);
        }}
      />
    </Card>
  );
};
