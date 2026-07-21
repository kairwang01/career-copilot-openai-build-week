import React, { useEffect, useRef, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

interface ChartDataPoint {
  label: string;
  value: number;
}

interface ChartProps {
  data: ChartDataPoint[];
  width?: number; // Kept for type compatibility but ignored
  height?: number; // Default to 250
  t: (key: string) => string;
}

const Chart: React.FC<ChartProps> = ({ data, height = 250, t }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(0);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const update = () => {
      setChartWidth(Math.floor(node.getBoundingClientRect().width));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (!data || data.length < 2) {
    return (
        <div style={{ height }} className="flex items-center justify-center bg-gray-100 dark:bg-slate-800 rounded-lg text-gray-500 dark:text-slate-400 w-full">
            {t('chart_no_data')}
        </div>
    );
  }

  return (
    // text color drives the CartesianGrid stroke (currentColor) for dark-mode support
    <div ref={containerRef} className="w-full min-w-0 font-sans text-gray-200 dark:text-slate-700" style={{ height, minHeight: height }}>
      {chartWidth <= 0 ? (
        <div className="h-full w-full animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" aria-hidden="true" />
      ) : (
        <AreaChart
          width={chartWidth}
          height={height}
          data={data}
          margin={{ top: 20, right: 20, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <XAxis dataKey="label" stroke="#6b7280" fontSize={12} tickLine={false} axisLine={false} dy={10} />
          <YAxis stroke="#6b7280" fontSize={12} tickLine={false} axisLine={false} domain={[0, 100]} dx={-10} />
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" />
          <Tooltip 
            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)' }}
            itemStyle={{ color: '#1f2937', fontWeight: 'bold' }}
          />
          <Area type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2.5} fillOpacity={1} fill="url(#colorValue)" />
        </AreaChart>
      )}
    </div>
  );
};

export default Chart;
