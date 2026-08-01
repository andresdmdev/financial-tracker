import { useState } from 'react';
import type { GoalAllocation } from '@/lib/queries/goals';
import type { LookupOption } from '@/lib/queries/transactions';
import { formatUsd } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, SelectField, type FieldOption } from '@/components/forms/Field';

interface Props {
  goalId: string;
  accumulatedUsd: number;
  allocations: GoalAllocation[];
  accounts: LookupOption[];
}

interface Draft {
  accountId: string;
  amount: string;
}

/**
 * Manual split of a goal's accumulated money across accounts.
 *
 * Deliberately not derived from the transactions: those record where the money
 * came from, not where it sits today. If you moved the Macbook fund from Cash
 * into Binance, no transaction exists to tell the app about it — you do.
 *
 * The total is not forced to match what the goal accumulated. A mismatch is
 * shown, not rejected: it is usually the truth about money that moved without
 * being written down.
 */
export default function GoalAllocationEditor({
  goalId,
  accumulatedUsd,
  allocations,
  accounts,
}: Props): React.ReactElement {
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    allocations.length === 0
      ? [{ accountId: '', amount: '' }]
      : allocations.map((allocation) => ({
          accountId: allocation.accountId,
          amount: String(allocation.amountUsd),
        })),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const accountOptions: FieldOption[] = accounts.map((account) => ({
    value: account.id,
    label: account.name,
  }));

  const assigned = drafts.reduce((sum, draft) => {
    const value = Number(draft.amount.replace(',', '.'));
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);

  const gap = accumulatedUsd - assigned;

  const update = (index: number, patch: Partial<Draft>): void => {
    setSaved(false);
    setDrafts((previous) =>
      previous.map((draft, position) => (position === index ? { ...draft, ...patch } : draft)),
    );
  };

  const removeRow = (index: number): void => {
    setSaved(false);
    setDrafts((previous) => previous.filter((_, position) => position !== index));
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);

    const payload = drafts
      .filter((draft) => draft.accountId !== '' && draft.amount.trim() !== '')
      .map((draft) => ({
        account_id: draft.accountId,
        amount_usd: Number(draft.amount.replace(',', '.')),
      }));

    const seen = new Set<string>();
    for (const item of payload) {
      if (seen.has(item.account_id)) {
        setSaving(false);
        setError('Hay una cuenta repetida: júntalas en una sola línea');
        return;
      }
      seen.add(item.account_id);
    }

    const response = await fetch(`/api/goals/${goalId}/allocations`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allocations: payload }),
    });

    setSaving(false);

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'No se pudo guardar el reparto');
      return;
    }

    setSaved(true);
  };

  return (
    <div className="space-y-4">
      {error !== null && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <ul className="space-y-3">
        {drafts.map((draft, index) => (
          <li key={index} className="flex items-end gap-2">
            <SelectField
              label={index === 0 ? 'Cuenta' : ''}
              value={draft.accountId}
              options={accountOptions}
              onChange={(value) => update(index, { accountId: value })}
              className="flex-1"
            />
            <Field label={index === 0 ? 'Monto en $' : ''} className="w-24 shrink-0 sm:w-32">
              <Input
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                className="text-right"
                value={draft.amount}
                onChange={(event) => update(index, { amount: event.target.value })}
              />
            </Field>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Quitar línea"
              onClick={() => removeRow(index)}
            >
              ×
            </Button>
          </li>
        ))}
      </ul>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setDrafts((previous) => [...previous, { accountId: '', amount: '' }])}
      >
        Agregar cuenta
      </Button>

      <dl className="space-y-1.5 rounded-lg bg-muted px-3 py-2.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Acumulado en la meta</dt>
          <dd className="tabular text-base font-medium sm:text-sm">{formatUsd(accumulatedUsd)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Repartido</dt>
          <dd className="tabular text-base font-medium sm:text-sm">{formatUsd(assigned)}</dd>
        </div>
        {Math.abs(gap) >= 0.01 && (
          <div className="flex justify-between gap-3 border-t border-border pt-1.5">
            <dt className="text-muted-foreground">Sin ubicar</dt>
            <dd className="tabular text-base font-medium text-destructive sm:text-sm">
              {formatUsd(gap)}
            </dd>
          </div>
        )}
      </dl>

      <div className="flex items-center gap-3">
        <Button type="button" onClick={() => void save()} disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar reparto'}
        </Button>
        {saved && <span className="text-xs text-muted-foreground">Guardado</span>}
      </div>
    </div>
  );
}
