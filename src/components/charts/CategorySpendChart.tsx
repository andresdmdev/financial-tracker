import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from 'recharts';
import type { CategorySpend } from '@/lib/queries/dashboard';
import { formatPercent, formatUsd } from '@/lib/format';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';

interface Props {
  data: CategorySpend[];
}

/**
 * One series of pure magnitude, so one hue. Assigning a colour per category
 * would make the colour follow the ranking rather than the entity: filter a
 * month and every bar would change colour without any category changing.
 */
const CHART_CONFIG = {
  totalUsd: { label: 'Gasto', color: 'var(--chart-1)' },
} satisfies ChartConfig;

const ROW_HEIGHT = 38;
const MIN_HEIGHT = 180;

/**
 * Where this month's money went, as horizontal bars ranked largest first.
 *
 * Horizontal rather than vertical because category names are long: rotated
 * vertical labels are unreadable, and truncating them defeats the point of
 * naming the category at all.
 *
 * The height grows with the number of categories instead of squeezing them into
 * a fixed box, which is what turns a nine-category month into a stack of hairlines.
 */
export default function CategorySpendChart({ data }: Props): React.ReactElement {
  if (data.length === 0) {
    return (
      <p className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        Sin gastos registrados este mes.
      </p>
    );
  }

  const total = data.reduce((sum, item) => sum + item.totalUsd, 0);

  const rows = data.map((item) => ({
    label:
      item.parentName === null ? item.categoryName : `${item.parentName} · ${item.categoryName}`,
    totalUsd: item.totalUsd,
  }));

  const height = Math.max(MIN_HEIGHT, rows.length * ROW_HEIGHT);

  return (
    <ChartContainer
      config={CHART_CONFIG}
      className="w-full"
      style={{ height: `${height}px` }}
    >
      <BarChart
        data={rows}
        layout="vertical"
        margin={{ top: 4, right: 56, bottom: 4, left: 0 }}
        barCategoryGap="22%"
      >
        <CartesianGrid horizontal={false} strokeDasharray="0" />
        <XAxis type="number" dataKey="totalUsd" hide />
        <YAxis
          type="category"
          dataKey="label"
          tickLine={false}
          axisLine={false}
          width={112}
          tick={{ fontSize: 12 }}
          interval={0}
        />
        <ChartTooltip
          cursor={{ fillOpacity: 0.06 }}
          content={
            <ChartTooltipContent
              valueFormatter={(value) => formatUsd(value)}
              footer={(payload) => (
                <p className="text-muted-foreground">
                  {total > 0 && formatPercent(Number(payload[0]?.value ?? 0) / total)} del gasto del
                  mes
                </p>
              )}
            />
          }
        />
        <Bar dataKey="totalUsd" fill="var(--color-totalUsd)" radius={[0, 4, 4, 0]} maxBarSize={20}>
          <LabelList
            dataKey="totalUsd"
            position="right"
            offset={8}
            className="fill-muted-foreground"
            fontSize={12}
            formatter={(value) =>
              formatUsd(typeof value === 'number' || typeof value === 'string' ? value : null)
            }
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
