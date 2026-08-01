import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { formatMonth, formatUsd, formatUsdCompact } from '@/lib/format';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';

export interface TrendPoint {
  periodMonth: string;
  incomeUsd: number;
  expenseUsd: number;
}

interface Props {
  data: TrendPoint[];
}

/**
 * Income against expense. Both hues clear the 3:1 contrast floor on the light
 * card surface and stay separable under deuteranopia (deltaE 10.2).
 */
const CHART_CONFIG = {
  incomeUsd: { label: 'Ingresos', color: 'var(--chart-1)' },
  expenseUsd: { label: 'Gastos', color: 'var(--chart-4)' },
} satisfies ChartConfig;

/**
 * Twelve-month income against expense. Two series on one axis: both are USD, so
 * a second scale would only distort the comparison.
 *
 * Drawn as translucent areas rather than plain lines so the months where
 * spending overtakes income read at a glance instead of needing to be traced.
 */
export default function TrendChart({ data }: Props): React.ReactElement {
  if (data.length === 0) {
    return (
      <p className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Sin movimientos registrados todavía.
      </p>
    );
  }

  return (
    <ChartContainer config={CHART_CONFIG} className="h-56 w-full sm:h-64">
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="fill-income" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-incomeUsd)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--color-incomeUsd)" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="fill-expense" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-expenseUsd)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--color-expenseUsd)" stopOpacity={0.02} />
          </linearGradient>
        </defs>

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
              labelFormatter={(label) => formatMonth(String(label))}
              valueFormatter={(value) => formatUsd(value)}
              footer={(payload) => {
                const valueOf = (key: string): number =>
                  Number(payload.find((item) => item.dataKey === key)?.value ?? 0);
                const net = valueOf('incomeUsd') - valueOf('expenseUsd');

                return (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <span className="flex-1">Neto</span>
                    <span className="tabular text-sm font-medium text-foreground sm:text-xs">
                      {formatUsd(net)}
                    </span>
                  </p>
                );
              }}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Area
          type="monotone"
          dataKey="incomeUsd"
          stroke="var(--color-incomeUsd)"
          fill="url(#fill-income)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
        />
        <Area
          type="monotone"
          dataKey="expenseUsd"
          stroke="var(--color-expenseUsd)"
          fill="url(#fill-expense)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
        />
      </AreaChart>
    </ChartContainer>
  );
}
