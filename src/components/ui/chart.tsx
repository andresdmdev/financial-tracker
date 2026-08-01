import * as React from 'react';
import * as RechartsPrimitive from 'recharts';
import { cn } from '@/lib/utils';

/**
 * Per-series presentation: the label shown in tooltips and legends, and the
 * colour published as the `--color-<key>` custom property.
 */
export type ChartConfig = Record<
  string,
  {
    label?: React.ReactNode;
    icon?: React.ComponentType;
    color?: string;
  }
>;

interface ChartContextValue {
  config: ChartConfig;
}

const ChartContext = React.createContext<ChartContextValue | null>(null);

/**
 * Reads the chart config published by the nearest `ChartContainer`.
 * Throws rather than returning a default so a misplaced tooltip fails loudly.
 */
function useChart(): ChartContextValue {
  const context = React.useContext(ChartContext);
  if (context === null) {
    throw new Error('Los componentes de gráfico deben usarse dentro de <ChartContainer>');
  }
  return context;
}

/**
 * Emits the `--color-<key>` custom properties for one chart instance, scoped by
 * its generated id so two charts on the same page cannot overwrite each other.
 */
function ChartStyle({ id, config }: { id: string; config: ChartConfig }): React.ReactElement | null {
  const entries = Object.entries(config).filter(([, item]) => item.color !== undefined);
  if (entries.length === 0) return null;

  const declarations = entries
    .map(([key, item]) => `  --color-${key}: ${item.color};`)
    .join('\n');

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `[data-chart="${id}"] {\n${declarations}\n}`,
      }}
    />
  );
}

/**
 * Responsive wrapper every chart in the app is mounted in. Publishes the series
 * config to the tooltip and legend, and recolours the Recharts defaults
 * (grid, axis ticks, cursor) to the theme tokens.
 */
function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<'div'> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>['children'];
}): React.ReactElement {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, '')}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "flex justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector]:outline-hidden [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-hidden",
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

const ChartTooltip = RechartsPrimitive.Tooltip;

interface TooltipPayloadItem {
  name?: string | number;
  dataKey?: string | number;
  value?: number | string;
  color?: string;
  payload?: Record<string, unknown>;
}

interface ChartTooltipContentProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
  className?: string;
  hideLabel?: boolean;
  hideIndicator?: boolean;
  indicator?: 'line' | 'dot' | 'dashed';
  nameKey?: string;
  labelFormatter?: (label: string | number) => React.ReactNode;
  valueFormatter?: (value: number, item: TooltipPayloadItem) => React.ReactNode;
  footer?: (payload: TooltipPayloadItem[]) => React.ReactNode;
}

/**
 * Tooltip body listing every series at the hovered position, so points can be
 * compared without reading them off the axis. `footer` renders a derived row
 * such as a net figure beneath the series list.
 */
function ChartTooltipContent({
  active,
  payload,
  label,
  className,
  hideLabel = false,
  hideIndicator = false,
  indicator = 'dot',
  nameKey,
  labelFormatter,
  valueFormatter,
  footer,
}: ChartTooltipContentProps): React.ReactElement | null {
  const { config } = useChart();

  if (active !== true || payload === undefined || payload.length === 0) return null;

  const heading =
    hideLabel || label === undefined
      ? null
      : labelFormatter !== undefined
        ? labelFormatter(label)
        : String(label);

  return (
    <div
      className={cn(
        'grid min-w-40 gap-1.5 rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-lg',
        className,
      )}
    >
      {heading !== null && <p className="font-medium text-foreground">{heading}</p>}

      {payload.map((item, index) => {
        const key = String(nameKey ?? item.dataKey ?? item.name ?? 'value');
        const itemConfig = config[key];
        const colour = item.color ?? `var(--color-${key})`;
        const value = Number(item.value ?? 0);

        return (
          <p key={key + String(index)} className="flex items-center gap-2 text-muted-foreground">
            {!hideIndicator && (
              <span
                aria-hidden="true"
                className={cn(
                  'shrink-0 rounded-full',
                  indicator === 'dot' && 'size-2',
                  indicator === 'line' && 'h-0.5 w-3',
                  indicator === 'dashed' && 'h-0 w-3 border-t-2 border-dashed',
                )}
                style={
                  indicator === 'dashed'
                    ? { borderColor: colour }
                    : { backgroundColor: colour }
                }
              />
            )}
            <span className="flex-1">{itemConfig?.label ?? item.name ?? key}</span>
            <span className="tabular text-sm font-medium text-foreground sm:text-xs">
              {valueFormatter !== undefined ? valueFormatter(value, item) : value.toLocaleString()}
            </span>
          </p>
        );
      })}

      {footer !== undefined && (
        <div className="mt-0.5 border-t border-border pt-1.5">{footer(payload)}</div>
      )}
    </div>
  );
}

const ChartLegend = RechartsPrimitive.Legend;

interface LegendPayloadItem {
  value?: string;
  dataKey?: string | number;
  color?: string;
}

/**
 * Legend rendered as thin colour rules rather than filled squares, so it reads
 * as a key to the lines instead of competing with the data.
 */
function ChartLegendContent({
  payload,
  className,
  nameKey,
}: {
  payload?: LegendPayloadItem[];
  className?: string;
  nameKey?: string;
}): React.ReactElement | null {
  const { config } = useChart();

  if (payload === undefined || payload.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5', className)}>
      {payload.map((item) => {
        const key = String(nameKey ?? item.dataKey ?? item.value ?? 'value');
        const itemConfig = config[key];

        return (
          <span key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              aria-hidden="true"
              className="h-0.5 w-3.5 shrink-0 rounded-full"
              style={{ backgroundColor: item.color ?? `var(--color-${key})` }}
            />
            {itemConfig?.label ?? item.value ?? key}
          </span>
        );
      })}
    </div>
  );
}

export {
  ChartContainer,
  ChartStyle,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  useChart,
};
