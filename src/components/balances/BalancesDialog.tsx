import { useState, type SyntheticEvent } from 'react';
import type { DeclaredBalance } from '@/lib/queries/dashboard';
import { formatDate, formatLocal, formatUsd } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

interface Props {
  balances: DeclaredBalance[];
}

interface EntryState {
  amount: string;
  rate: string;
}

interface Payload {
  account_id: string;
  balance_usd: number | null;
  balance_local: number | null;
  local_currency: 'VES' | 'COP' | null;
  fx_rate_local_usd: number | null;
}

/**
 * Seeds every row with the balance the account holds today — the last
 * declaration plus everything recorded since — so re-declaring means confirming
 * what the app already worked out and correcting only what drifted.
 *
 * For an account held in another currency the local amount is re-derived from
 * that figure at the last rate used, since the stored local amount belongs to
 * the older snapshot and would contradict it.
 */
function initialEntries(balances: DeclaredBalance[]): Record<string, EntryState> {
  const state: Record<string, EntryState> = {};

  for (const balance of balances) {
    const current = balance.currentUsd ?? balance.declaredUsd;
    const rate = balance.fxRateLocalUsd;

    if (balance.currency === 'USD') {
      state[balance.accountId] = { amount: current?.toFixed(2) ?? '', rate: '' };
      continue;
    }

    state[balance.accountId] = {
      amount:
        current !== null && rate !== null
          ? (current * rate).toFixed(2)
          : (balance.declaredLocal?.toString() ?? ''),
      rate: rate?.toString() ?? '',
    };
  }

  return state;
}

/**
 * Reads a comma- or dot-separated number, returning null for blank input.
 */
function toNumber(value: string): number | null {
  const trimmed = value.trim().replace(',', '.');
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The calendar day as the browser sees it, which is what the declaration
 * describes. Taking it from the server would move the snapshot a day for anyone
 * declaring in the evening west of UTC.
 */
function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Modal for declaring what each account actually holds right now.
 *
 * This is the only place the app learns a real balance. From then on the figure
 * carries itself forward with every transaction dated after the declaration, so
 * this is a correction tool rather than a chore: open it when something drifted,
 * not after every purchase.
 *
 * Accounts left blank are skipped, not zeroed — nothing is written for them and
 * their previous declaration stands.
 */
export default function BalancesDialog({ balances }: Props): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Record<string, EntryState>>(() =>
    initialEntries(balances),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const update = (accountId: string, patch: Partial<EntryState>): void => {
    setEntries((previous) => ({
      ...previous,
      [accountId]: { ...previous[accountId]!, ...patch },
    }));
  };

  const usdValue = (balance: DeclaredBalance): number | null => {
    const entry = entries[balance.accountId];
    if (entry === undefined) return null;

    const amount = toNumber(entry.amount);
    if (amount === null) return null;

    if (balance.currency === 'USD') return amount;

    const rate = toNumber(entry.rate);
    if (rate === null || rate <= 0) return null;
    return amount / rate;
  };

  const total = balances
    .filter((balance) => balance.isAsset)
    .reduce((sum, balance) => sum + (usdValue(balance) ?? 0), 0);

  const submit = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const payload: Payload[] = [];

    for (const balance of balances) {
      const entry = entries[balance.accountId];
      if (entry === undefined) continue;

      const amount = toNumber(entry.amount);
      if (amount === null) continue;

      if (balance.currency === 'USD') {
        payload.push({
          account_id: balance.accountId,
          balance_usd: amount,
          balance_local: null,
          local_currency: null,
          fx_rate_local_usd: null,
        });
        continue;
      }

      const rate = toNumber(entry.rate);
      if (rate === null || rate <= 0) {
        setSaving(false);
        setError(`Indica la tasa que usaste para ${balance.name}`);
        return;
      }

      payload.push({
        account_id: balance.accountId,
        balance_usd: null,
        balance_local: amount,
        local_currency: balance.currency as 'VES' | 'COP',
        fx_rate_local_usd: rate,
      });
    }

    if (payload.length === 0) {
      setSaving(false);
      setError('No declaraste ningún saldo');
      return;
    }

    const response = await fetch('/api/balances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: payload, captured_on: today() }),
    });

    setSaving(false);

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'No se pudieron guardar los saldos');
      return;
    }

    window.location.reload();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full sm:w-auto">
          Actualizar saldos
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Saldos actuales</DialogTitle>
          <DialogDescription>
            Viene precargado lo que la app calcula que tienes hoy. Corrige solo las cuentas donde no
            cuadre; desde aquí el monto vuelve a moverse solo con cada transacción.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          {error !== null && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <ul className="divide-y divide-border">
            {balances.map((balance) => {
              const entry = entries[balance.accountId] ?? { amount: '', rate: '' };
              const isLocal = balance.currency !== 'USD';
              const declared = usdValue(balance);

              return (
                <li key={balance.accountId} className="space-y-2 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {balance.name}
                      {!balance.isAsset && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          deuda
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {balance.declaredOn === null
                        ? 'Nunca declarada'
                        : `Declarado ${formatDate(balance.declaredOn)}`}
                      {balance.movementSinceUsd !== 0 && (
                        <>
                          {' · '}
                          {balance.movementSinceUsd > 0 ? '+' : '−'}
                          {formatUsd(Math.abs(balance.movementSinceUsd))} desde entonces
                        </>
                      )}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-0 flex-1 space-y-1 sm:flex-none">
                      <Label
                        htmlFor={`amount-${balance.accountId}`}
                        className="text-[11px] text-muted-foreground"
                      >
                        {isLocal ? `Monto en ${balance.currency}` : 'Monto en $'}
                      </Label>
                      <Input
                        id={`amount-${balance.accountId}`}
                        type="text"
                        inputMode="decimal"
                        placeholder="0,00"
                        className="h-9 w-full text-right sm:w-32"
                        value={entry.amount}
                        onChange={(event) =>
                          update(balance.accountId, { amount: event.target.value })
                        }
                      />
                    </div>

                    {isLocal && (
                      <div className="min-w-0 flex-1 space-y-1 sm:flex-none">
                        <Label
                          htmlFor={`rate-${balance.accountId}`}
                          className="text-[11px] text-muted-foreground"
                        >
                          Tasa por dólar
                        </Label>
                        <Input
                          id={`rate-${balance.accountId}`}
                          type="text"
                          inputMode="decimal"
                          placeholder="155"
                          className="h-9 w-full text-right sm:w-24"
                          value={entry.rate}
                          onChange={(event) =>
                            update(balance.accountId, { rate: event.target.value })
                          }
                        />
                      </div>
                    )}

                    <p className="tabular w-full pb-2 text-right text-base font-medium sm:w-24 sm:text-sm">
                      {declared === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        formatUsd(declared)
                      )}
                    </p>
                  </div>

                  {isLocal && entry.amount.trim() !== '' && (
                    <p className="text-xs text-muted-foreground">
                      {formatLocal(toNumber(entry.amount), balance.currency as 'VES' | 'COP')} a la
                      tasa indicada
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2.5">
            <span className="text-sm text-muted-foreground">Patrimonio declarado</span>
            <span className="tabular text-lg font-semibold sm:text-base">{formatUsd(total)}</span>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar saldos'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
