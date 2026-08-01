import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import type { CategoryTrendPoint } from '@/lib/queries/dashboard';
import { formatMonth, formatUsd, formatUsdCompact } from '@/lib/format';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { cn } from '@/lib/utils';

interface Props {
  data: CategoryTrendPoint[];
  months?: number;
}

/** Series slots, assigned in fixed order and never cycled. */
const SERIES_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
] as const;

const TOP_SERIES = 5;
const OTHER_KEY = 'otros';

interface Series {
  key: string;
  label: string;
  color: string;
}

interface Shaped {
  rows: Record<string, string | number>[];
  series: Series[];
}

/**
 * Builds the month axis as a dense range so a category with no spend in a month
 * reads as zero rather than as a gap the line jumps over.
 */
function monthKeys(months: number): string[] {
  const keys: string[] = [];
  const cursor = new Date();
  cursor.setUTCDate(1);
  cursor.setUTCMonth(cursor.getUTCMonth() - (months - 1));

  for (let index = 0; index < months; index += 1) {
    keys.push(`${cursor.toISOString().slice(0, 8)}01`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return keys;
}

/**
 * Pivots the long-form rows into one record per month, keeping only the biggest
 * spenders as their own line and folding the rest into a single "Otros" series.
 *
 * Eleven categories on one chart is unreadable, and a generated hue for the
 * ninth series is not a colour anybody can tell apart — so the tail is
 * aggregated instead of drawn.
 */
function shape(data: CategoryTrendPoint[], months: number): Shaped {
  const totals = new Map<string, { name: string; total: number }>();
  for (const point of data) {
    const current = totals.get(point.categoryId);
    totals.set(point.categoryId, {
      name: point.categoryName,
      total: (current?.total ?? 0) + point.totalUsd,
    });
  }

  const ranked = [...totals.entries()].sort((a, b) => b[1].total - a[1].total);
  const top = ranked.slice(0, TOP_SERIES);
  const topIds = new Set(top.map(([id]) => id));
  const hasTail = ranked.length > TOP_SERIES;

  const series: Series[] = top.map(([id, value], index) => ({
    key: id,
    label: value.name,
    color: SERIES_COLORS[index]!,
  }));

  if (hasTail) {
    series.push({ key: OTHER_KEY, label: 'Otros', color: SERIES_COLORS[TOP_SERIES]! });
  }

  const byMonth = new Map<string, Record<string, string | number>>();
  for (const key of monthKeys(months)) {
    const row: Record<string, string | number> = { periodMonth: key };
    for (const item of series) row[item.key] = 0;
    byMonth.set(key, row);
  }

  for (const point of data) {
    const row = byMonth.get(point.periodMonth);
    if (row === undefined) continue;

    const key = topIds.has(point.categoryId) ? point.categoryId : OTHER_KEY;
    if (!hasTail && key === OTHER_KEY) continue;
    row[key] = Number(row[key] ?? 0) + point.totalUsd;
  }

  return { rows: [...byMonth.values()], series };
}

/**
 * Twelve-month spend per category.
 *
 * The legend doubles as a filter: clicking a category isolates it, which is the
 * only way five overlapping lines stay readable when two of them cross.
 */
export default function CategoryTrendChart({ data, months = 12 }: Props): React.ReactElement {
  const [isolated, setIsolated] = useState<string | null>(null);
  const { rows, series } = useMemo(() => shape(data, months), [data, months]);

  const config: ChartConfig = Object.fromEntries(
    series.map((item) => [item.key, { label: item.label, color: item.color }]),
  );

  if (data.length === 0) {
    return (
      <p className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Sin gasto registrado en los últimos {months} meses.
      </p>
    );
  }

  const visible = isolated === null ? series : series.filter((item) => item.key === isolated);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {series.map((item) => {
          const active = isolated === null || isolated === item.key;

          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={isolated === item.key}
              onClick={() => setIsolated((previous) => (previous === item.key ? null : item.key))}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs transition-opacity',
                active ? 'text-muted-foreground' : 'text-muted-foreground/45',
              )}
            >
              <span
                aria-hidden="true"
                className="h-0.5 w-3.5 shrink-0 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              {item.label}
            </button>
          );
        })}
      </div>

      <ChartContainer config={config} className="h-56 w-full sm:h-64">
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
          {visible.map((item) => (
            <Line
              key={item.key}
              type="monotone"
              dataKey={item.key}
              name={item.label}
              stroke={item.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
            />
          ))}
        </LineChart>
      </ChartContainer>
    </div>
  );
}
