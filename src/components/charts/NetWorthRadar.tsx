import { PolarAngleAxis, PolarGrid, Radar, RadarChart } from 'recharts';
import type { DeclaredBalance } from '@/lib/queries/dashboard';
import { formatUsd } from '@/lib/format';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';

interface Props {
  balances: DeclaredBalance[];
}

const CHART_CONFIG = {
  currentUsd: { label: 'Saldo', color: 'var(--chart-1)' },
} satisfies ChartConfig;

/**
 * Distribution of the money across accounts, at today's balance rather than the
 * one last declared, so the shape moves as transactions are recorded.
 *
 * Only asset accounts appear: a credit card holds debt, not money, and plotting
 * a negative on a radial axis is meaningless. Accounts never declared are shown
 * at zero rather than dropped, so an empty spoke reads as "you have not told me
 * about this one" instead of vanishing.
 */
export default function NetWorthRadar({ balances }: Props): React.ReactElement {
  const assets = balances.filter((balance) => balance.isAsset);
  const declared = assets.filter((balance) => balance.currentUsd !== null);

  if (declared.length === 0) {
    return (
      <p className="flex h-56 items-center justify-center px-4 text-center text-sm text-muted-foreground">
        Todavía no has declarado ningún saldo. Hazlo desde Transacciones → Actualizar saldos.
      </p>
    );
  }

  const data = assets.map((balance) => ({
    account: balance.name,
    currentUsd: Math.max(0, balance.currentUsd ?? 0),
  }));

  return (
    <ChartContainer config={CHART_CONFIG} className="mx-auto aspect-square h-52 sm:h-56">
      <RadarChart data={data} outerRadius="68%">
        <PolarGrid />
        <PolarAngleAxis dataKey="account" tick={{ fontSize: 11 }} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              hideLabel
              nameKey="currentUsd"
              valueFormatter={(value) => formatUsd(value)}
            />
          }
        />
        <Radar
          dataKey="currentUsd"
          stroke="var(--color-currentUsd)"
          fill="var(--color-currentUsd)"
          fillOpacity={0.22}
          strokeWidth={2}
          dot={{ r: 3, fillOpacity: 1 }}
        />
      </RadarChart>
    </ChartContainer>
  );
}
