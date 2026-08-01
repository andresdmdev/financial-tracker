import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from 'recharts';
import type { GoalProgressPoint } from '@/lib/queries/goals';
import { formatDate, formatUsd, formatUsdCompact } from '@/lib/format';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';

interface Props {
  data: GoalProgressPoint[];
  targetUsd: number | null;
}

const CHART_CONFIG = {
  balanceUsd: { label: 'Acumulado', color: 'var(--chart-1)' },
} satisfies ChartConfig;

/**
 * Running balance of a savings goal over time.
 *
 * Stepped rather than smoothed: the fund does not grow continuously between
 * contributions, and a curve would imply days of progress that never happened.
 * The target, when there is one, is drawn as a reference line so the remaining
 * gap is visible without arithmetic.
 */
export default function GoalProgressChart({ data, targetUsd }: Props): React.ReactElement {
  if (data.length === 0) {
    return (
      <p className="flex h-56 items-center justify-center text-sm text-muted-foreground">
        Todavía no hay aportes a esta meta.
      </p>
    );
  }

  return (
    <ChartContainer config={CHART_CONFIG} className="h-56 w-full">
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="fill-goal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-balanceUsd)" stopOpacity={0.24} />
            <stop offset="100%" stopColor="var(--color-balanceUsd)" stopOpacity={0.02} />
          </linearGradient>
        </defs>

        <CartesianGrid vertical={false} strokeDasharray="0" />
        <XAxis
          dataKey="occurredOn"
          tickFormatter={(value: string) => formatDate(value).slice(0, 6)}
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          minTickGap={16}
        />
        <YAxis
          tickFormatter={(value: number) => formatUsdCompact(value)}
          tickLine={false}
          axisLine={false}
          width={62}
        />
        {targetUsd !== null && (
          <ReferenceLine
            y={targetUsd}
            stroke="var(--chart-3)"
            strokeDasharray="5 4"
            strokeWidth={1.5}
            label={{
              value: `Meta ${formatUsdCompact(targetUsd)}`,
              position: 'insideTopRight',
              fill: 'var(--chart-3)',
              fontSize: 11,
            }}
          />
        )}
        <ChartTooltip
          cursor={{ strokeDasharray: '4 4' }}
          content={
            <ChartTooltipContent
              labelFormatter={(label) => formatDate(String(label))}
              valueFormatter={(value) => formatUsd(value)}
            />
          }
        />
        <Area
          type="stepAfter"
          dataKey="balanceUsd"
          stroke="var(--color-balanceUsd)"
          fill="url(#fill-goal)"
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--card)' }}
        />
      </AreaChart>
    </ChartContainer>
  );
}
