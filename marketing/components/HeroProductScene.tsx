import React from 'react';
import { ReportPreview } from './ReportPreview';

interface HeroProductSceneProps {
  t: (key: string) => string;
}

export const HeroProductScene: React.FC<HeroProductSceneProps> = ({ t }) => (
  <div className="relative lg:pt-4 w-full">
    <ReportPreview t={t} compact />
  </div>
);
