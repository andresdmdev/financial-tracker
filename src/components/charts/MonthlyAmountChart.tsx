import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import type { MonthlyAmount } from '@/lib/queries/dashboard';
import { formatMonth, formatUsd, formatUsdCompact, monthKeys } from '@/lib/format';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';

interface Props {
  data: MonthlyAmount[];
  empty: string;
  months?: number;
}

const CHART_CONFIG: ChartConfig = {
  totalUsd: { label: 'Gasto', color: 'var(--chart-1)' },
};

/**
 * Fills the axis with every month in the window so a month with no spend reads
 * as a zero on the line rather than as a gap the line jumps over — which is the
 * difference between "I spent nothing" and "I have no data".
 */
function densify(data: MonthlyAmount[], months: number): MonthlyAmount[] {
  const totals = new Map(data.map((point) => [point.periodMonth, point.totalUsd]));

  return monthKeys(months).map((periodMonth) => ({
    periodMonth,
    totalUsd: totals.get(periodMonth) ?? 0,
  }));
}

/**
 * A single amount plotted month over month.
 *
 * Deliberately one series and one colour: the point is comparing a month with
 * the months around it, so anything else on the chart is noise. The caller
 * supplies the empty-state sentence because "no spend" means something
 * different for a credit card than for a tag nobody has used yet.
 */
export default function MonthlyAmountChart({
  data,
  empty,
  months = 12,
}: Props): React.ReactElement {
  const rows = useMemo(() => densify(data, months), [data, months]);

  if (data.length === 0) {
    return (
      <p className="flex h-56 items-center justify-center text-center text-sm text-muted-foreground sm:h-64">
        {empty}
      </p>
    );
  }

  return (
    <ChartContainer config={CHART_CONFIG} className="h-56 w-full sm:h-64">
      <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="0" />
        <XAxis
          dataKey="periodMonth"
          tickFormatter={(value: string) => formatMonth(value).slice(0, 3)}
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          minTickGap={8}
        />
        <YAxis
          tickFormatter={(value: number) => formatUsdCompact(value)}
          tickLine={false}
          axisLine={false}
          width={62}
        />
        <ChartTooltip
          cursor={{ strokeDasharray: '4 4' }}
          content={
            <ChartTooltipContent
              indicator="line"
              labelFormatter={(label) => formatMonth(String(label))}
              valueFormatter={(value) => formatUsd(value)}
            />
          }
        />
        <Line
          type="monotone"
          dataKey="totalUsd"
          name="Gasto"
          stroke="var(--color-totalUsd)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
        />
      </LineChart>
    </ChartContainer>
  );
}
