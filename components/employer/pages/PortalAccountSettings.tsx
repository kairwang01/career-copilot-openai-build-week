import React from 'react';
import type { AppSession as Session } from '../../../lib/data';
import Account from '../../Account';
import { PortalTopBar } from '../PortalTopBar';

interface PortalAccountSettingsProps {
  session: Session;
  darkMode: boolean;
  onBack: () => void;
  t: (key: string) => string;
}

export function PortalAccountSettings({
  session,
  darkMode,
  onBack,
  t,
}: PortalAccountSettingsProps) {
  return (
    <>
      <PortalTopBar title={t('portal_nav_account')} darkMode={darkMode} />
      <div className="max-w-[1088px] mx-auto p-4 sm:p-6 lg:p-8">
        <Account
          key={session.user.id}
          session={session}
          onSetView={() => {}}
          onBack={onBack}
          t={t}
        />
      </div>
    </>
  );
}
