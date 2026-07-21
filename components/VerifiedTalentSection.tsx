import React from 'react';
import { BadgeCheck, DollarSign, Filter, ShieldCheck, TrendingUp, Users } from 'lucide-react';

interface VerifiedTalentSectionProps {
    t: (key: string) => string;
}

interface BenefitCardProps {
    icon: React.ReactNode;
    title: string;
    description: string;
}

const BenefitCard: React.FC<BenefitCardProps> = ({ icon, title, description }) => (
    <div className="flex items-start space-x-4">
        <div className="flex-shrink-0 bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400 rounded-lg p-3">
            {icon}
        </div>
        <div>
            <h4 className="font-bold text-lg text-gray-900 dark:text-gray-100">{title}</h4>
            <p className="mt-1 text-gray-600 dark:text-gray-400">{description}</p>
        </div>
    </div>
);


const VerifiedTalentSection: React.FC<VerifiedTalentSectionProps> = ({ t }) => {
    return (
        <section className="py-16 md:py-24 bg-gray-50 dark:bg-slate-900/50">
            <div className="max-w-6xl mx-auto px-4 sm:px-6">
                <div className="text-center mb-12 animate-slide-in-up">
                    <h2 className="text-3xl md:text-4xl font-extrabold text-gray-900 dark:text-gray-100 tracking-tight">
                        {t('verified_talent_section_title')}
                    </h2>
                    <p className="mt-4 text-lg text-gray-600 dark:text-gray-400 max-w-3xl mx-auto">
                        {t('verified_talent_section_subtitle')}
                    </p>
                </div>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                    {/* For Candidates */}
                    <div className="bg-white dark:bg-slate-800 p-8 rounded-xl border border-gray-200/80 dark:border-slate-700/80 shadow-lg space-y-6 animate-slide-in-up" style={{ animationDelay: '100ms' }}>
                        <h3 className="text-2xl font-bold text-center text-blue-700 dark:text-blue-400">{t('verified_talent_section_candidates_title')}</h3>
                        <div className="space-y-6">
                             <BenefitCard 
                                icon={<DollarSign className="h-6 w-6" aria-hidden="true" />}
                                title={t('verified_talent_section_candidates_benefit1_title')}
                                description={t('verified_talent_section_candidates_benefit1_desc')}
                            />
                            <BenefitCard 
                                icon={<BadgeCheck className="h-6 w-6" aria-hidden="true" />}
                                title={t('verified_talent_section_candidates_benefit2_title')}
                                description={t('verified_talent_section_candidates_benefit2_desc')}
                            />
                            <BenefitCard 
                                icon={<TrendingUp className="h-6 w-6" aria-hidden="true" />}
                                title={t('verified_talent_section_candidates_benefit3_title')}
                                description={t('verified_talent_section_candidates_benefit3_desc')}
                            />
                        </div>
                    </div>
                     {/* For Employers */}
                    <div className="bg-white dark:bg-slate-800 p-8 rounded-xl border border-gray-200/80 dark:border-slate-700/80 shadow-lg space-y-6 animate-slide-in-up" style={{ animationDelay: '200ms' }}>
                        <h3 className="text-2xl font-bold text-center text-green-700 dark:text-green-400">{t('verified_talent_section_employers_title')}</h3>
                         <div className="space-y-6">
                             <BenefitCard 
                                icon={<Filter className="h-6 w-6" aria-hidden="true" />}
                                title={t('verified_talent_section_employers_benefit1_title')}
                                description={t('verified_talent_section_employers_benefit1_desc')}
                            />
                            <BenefitCard 
                                icon={<Users className="h-6 w-6" aria-hidden="true" />}
                                title={t('verified_talent_section_employers_benefit2_title')}
                                description={t('verified_talent_section_employers_benefit2_desc')}
                            />
                            <BenefitCard 
                                icon={<ShieldCheck className="h-6 w-6" aria-hidden="true" />}
                                title={t('verified_talent_section_employers_benefit3_title')}
                                description={t('verified_talent_section_employers_benefit3_desc')}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default VerifiedTalentSection;
