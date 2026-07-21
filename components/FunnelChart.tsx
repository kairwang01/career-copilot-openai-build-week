
import React from 'react';

interface FunnelDataPoint {
    stage: string;
    count: number;
}

interface FunnelChartProps {
    data: FunnelDataPoint[];
    t?: (key: string) => string;
}

/**
 * Stage-by-stage hiring funnel rendered as full-width proportional bars.
 *
 * Each stage is a fixed-width track with a colored fill sized to count/maxCount.
 * Labels and counts live OUTSIDE the fill, so they never overflow regardless of
 * value (the previous shrinking-box layout clipped wrapped labels at 0 counts).
 * maxCount is the first stage (Applied), so every later bar reads as a share of
 * the top of the funnel; the connector between bars shows stage-to-stage
 * conversion.
 */
function formatTranslation(template: string, values: Record<string, string | number>): string {
    return Object.entries(values).reduce(
        (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
        template,
    );
}

const FunnelChart: React.FC<FunnelChartProps> = ({ data, t }) => {
    if (!data || data.length === 0) {
        return <div className="text-center p-4 text-gray-500 dark:text-gray-400">{t?.('funnel_empty') ?? 'No funnel data available.'}</div>;
    }

    const colors = ['#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe'];
    const maxCount = data[0]?.count || 0;

    return (
        <div className="w-full">
            {data.map(({ stage, count }, index) => {
                const widthPercentage = maxCount > 0 ? (count / maxCount) * 100 : 0;
                const shareOfTotal = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
                const conversionRate = index > 0 && data[index - 1].count > 0
                    ? Math.round((count / data[index - 1].count) * 100)
                    : null;

                return (
                    <div key={stage}>
                        {index > 0 && (
                            <div className="py-2 pl-1 text-xs font-medium text-gray-400 dark:text-gray-500">
                                <span>
                                    {conversionRate !== null
                                        ? formatTranslation(t?.('funnel_conversion_from_previous') ?? '{rate}% from previous stage', { rate: conversionRate })
                                        : t?.('funnel_conversion_no_prior') ?? 'No prior applicants'}
                                </span>
                            </div>
                        )}

                        <div className="flex items-baseline justify-between mb-1.5">
                            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{stage}</span>
                            <span className="text-sm font-bold text-gray-900 dark:text-gray-100 tabular-nums">
                                {count}
                                <span className="ml-1.5 text-xs font-medium text-gray-400 dark:text-gray-500">({shareOfTotal}%)</span>
                            </span>
                        </div>

                        <div className="h-3 w-full rounded-full bg-gray-100 dark:bg-slate-700 overflow-hidden">
                            <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{
                                    width: `${widthPercentage}%`,
                                    backgroundColor: colors[index % colors.length],
                                }}
                            />
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default FunnelChart;
