import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExchangeRates as Rates } from '@/lib/exchange-rates';
import { formatDate, formatVesRate } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';

const REFRESH_MS = 15 * 60 * 1000;

const TIME_FORMATTER = new Intl.DateTimeFormat('es-VE', { hour: '2-digit', minute: '2-digit' });

type Status = 'loading' | 'ready' | 'error';

interface Props {
  variant?: 'full' | 'compact';
}

/**
 * Loads the rates once on mount, then every 15 minutes while the page is open.
 * A tab coming back from the background refreshes at once if its figures are
 * older than that, since timers are throttled while hidden. A failed refresh
 * keeps the last good figures instead of blanking them.
 */
function useExchangeRates(): { rates: Rates | null; status: Status } {
  const [rates, setRates] = useState<Rates | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const lastFetch = useRef<number>(0);

  const load = useCallback(async (): Promise<void> => {
    lastFetch.current = Date.now();
    try {
      const response = await fetch('/api/exchange-rates');
      if (!response.ok) throw new Error(String(response.status));
      setRates((await response.json()) as Rates);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), REFRESH_MS);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && Date.now() - lastFetch.current >= REFRESH_MS) {
        void load();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  return { rates, status };
}

/**
 * Today's bolivar rates: BCV dollar, BCV euro and the Binance P2P USDT price.
 *
 * Fetched in the browser rather than during SSR so a slow BCV never delays the
 * page. `full` is three tiles for the dashboard; `compact` is a single line of
 * chips for pages where the rates are context rather than the subject, such as
 * a goal.
 */
export default function ExchangeRates({ variant = 'full' }: Props): React.ReactElement {
  const { rates, status } = useExchangeRates();
  const loading = rates === null && status === 'loading';
  const updatedAt = rates === null ? null : TIME_FORMATTER.format(new Date(rates.fetchedAt));

  if (variant === 'compact') {
    const chips = [
      { label: 'BCV $', value: rates?.bcvUsd ?? null },
      { label: 'BCV €', value: rates?.bcvEur ?? null },
      { label: 'USDT', value: rates?.binanceUsdt ?? null },
    ];

    if (rates === null && status === 'error') {
      return <p className="text-xs text-muted-foreground">Tasas de cambio no disponibles</p>;
    }

    return (
      <section
        aria-label="Tasas de cambio"
        className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs"
      >
        {chips.map((chip) => (
          <span
            key={chip.label}
            className="inline-flex items-baseline gap-1.5 rounded-full border border-border bg-card px-2.5 py-1"
          >
            <span className="text-muted-foreground">{chip.label}</span>
            {loading ? (
              <span className="inline-block h-3 w-14 animate-pulse rounded bg-muted" />
            ) : (
              <span className="tabular font-medium">{formatVesRate(chip.value)}</span>
            )}
          </span>
        ))}
        {updatedAt !== null && (
          <span className="text-muted-foreground">
            {status === 'error' ? `Sin actualizar desde ${updatedAt}` : updatedAt}
          </span>
        )}
      </section>
    );
  }

  const bcvHint =
    rates?.bcvValueDate == null ? 'Tasa oficial' : `Fecha valor ${formatDate(rates.bcvValueDate)}`;

  const tiles = [
    { label: 'Dólar BCV', value: rates?.bcvUsd ?? null, hint: bcvHint },
    { label: 'Euro BCV', value: rates?.bcvEur ?? null, hint: bcvHint },
    { label: 'USDT Binance', value: rates?.binanceUsdt ?? null, hint: 'Promedio P2P de compra' },
  ];

  return (
    <section aria-label="Tasas de cambio" className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-3">
        {tiles.map((tile) => (
          <Card key={tile.label} className="gap-0 py-3">
            <CardContent className="px-4">
              <p className="text-xs font-medium text-muted-foreground">{tile.label}</p>
              {loading ? (
                <div className="mt-1.5 h-7 w-28 animate-pulse rounded-md bg-muted" />
              ) : (
                <p className="tabular mt-1 text-lg font-semibold tracking-tight">
                  {formatVesRate(tile.value)}
                </p>
              )}
              <p className="mt-0.5 text-xs text-muted-foreground">
                {rates !== null && tile.value === null ? 'No disponible' : tile.hint}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-right text-xs text-muted-foreground">
        {status === 'error'
          ? updatedAt === null
            ? 'No se pudieron cargar las tasas. Se reintentará en 15 min.'
            : `No se pudo actualizar · última lectura ${updatedAt}`
          : updatedAt !== null
            ? `Actualizado ${updatedAt}`
            : ' '}
      </p>
    </section>
  );
}
