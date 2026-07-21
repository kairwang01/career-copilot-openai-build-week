import React from 'react';
import { Check } from 'lucide-react';
import { Card, SectionHeading, tableCell, tableHead, tableRow } from './adminUi';
import { at } from './adminText';
import {
  ADMIN_PERMISSION_MATRIX,
  ADMIN_ROLE_DESCRIPTIONS,
  ADMIN_ROLE_PERMISSIONS,
  PRODUCT_ROLE_ACCESS,
  type AdminRole,
} from '../../lib/access/permissions';

const ROLE_ORDER: AdminRole[] = ['reviewer', 'admin', 'super'];

const ROLE_LABELS: Record<AdminRole, string> = {
  reviewer: 'Reviewer',
  admin: 'Admin',
  super: 'Super',
};

/**
 * Read-only permission comparison grid for the three console roles.
 * Data comes from lib/access/permissions, the same registry that drives tab
 * visibility, so this table can never drift from actual behavior.
 */
export const PermissionMatrix: React.FC = () => (
  <Card className="overflow-hidden">
    <div className="px-5 pt-5 pb-3">
      <SectionHeading>{at('access.matrix.title')}</SectionHeading>
      <p className="mt-1 text-xs text-gray-500">{at('access.matrix.subtitle')}</p>
    </div>
    <div className="px-5 pb-4 grid sm:grid-cols-3 gap-3">
      {ROLE_ORDER.map((role) => (
        <div key={role} className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
          <p className="text-xs font-semibold text-gray-900">{ROLE_LABELS[role]}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{ADMIN_ROLE_DESCRIPTIONS[role]}</p>
        </div>
      ))}
    </div>
    <div className="overflow-x-auto">
      <table className="w-full border-t border-gray-100">
        <thead>
          <tr className="bg-gray-50/80">
            <th className={tableHead}>{at('access.matrix.col_capability')}</th>
            {ROLE_ORDER.map((role) => (
              <th key={role} className={`${tableHead} text-center`}>{ROLE_LABELS[role]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ADMIN_PERMISSION_MATRIX.map((row) => (
            <tr key={row.permission} className={tableRow}>
              <td className={tableCell}>
                <span>{row.label}</span>
                <span className="block font-mono text-[10px] text-gray-400">{row.permission}</span>
              </td>
              {ROLE_ORDER.map((role) => {
                const allowed = ADMIN_ROLE_PERMISSIONS[role].has(row.permission);
                return (
                  <td key={role} className={`${tableCell} text-center`}>
                    {allowed ? (
                      <span className="inline-flex justify-center text-emerald-600" aria-label={`${ROLE_LABELS[role]} allowed`}>
                        <Check className="h-4 w-4" aria-hidden="true" />
                      </span>
                    ) : (
                      <span className="text-gray-300" aria-label={`${ROLE_LABELS[role]} not allowed`}>-</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </Card>
);
/** Product-side role overview: what each signed-in role can reach in the app. */
export const ProductRoleOverview: React.FC = () => (
  <Card className="p-5">
    <SectionHeading>{at('access.product.title')}</SectionHeading>
    <p className="mt-1 text-xs text-gray-500">{at('access.product.subtitle')}</p>
    <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {Object.entries(PRODUCT_ROLE_ACCESS).map(([id, def]) => (
        <div key={id} className="rounded-md border border-gray-200 px-3 py-2.5">
          <p className="text-xs font-semibold text-gray-900">{def.label}</p>
          <ul className="mt-1.5 space-y-0.5">
            {def.access.map((line) => (
              <li key={line} className="text-[11px] leading-relaxed text-gray-600 flex gap-1.5">
                <span className="text-gray-300 shrink-0">-</span>
                {line}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  </Card>
);
