import { useState, type SyntheticEvent } from 'react';
import type { BudgetVsActual } from '@/lib/queries/dashboard';
import type { CategoryOption } from '@/lib/queries/transactions';
import { formatMonth, formatPercent, formatUsd } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Field, SelectField, type FieldOption } from '@/components/forms/Field';

interface Props {
  periodMonth: string;
  items: BudgetVsActual[];
  categories: CategoryOption[];
}

/**
 * Budget health. Colour never carries the meaning alone — each state ships with
 * its own label, so the bar is redundant encoding rather than the signal. All
 * three clear 3:1 against the light card surface.
 */
const STATES = {
  ok: { className: 'bg-[#0d9488]', label: 'En rango' },
  warning: { className: 'bg-[#d97706]', label: 'Cerca del límite' },
  over: { className: 'bg-[#dc2626]', label: 'Excedido' },
} as const;

const SCOPE_OPTIONS: FieldOption[] = [
  { value: 'forward', label: 'Desde este mes en adelante' },
  { value: 'month', label: 'Solo este mes' },
];

const MONTHS_BACK = 18;
const MONTHS_FORWARD = 6;

/**
 * Classifies consumption: over budget, within 20% of it, or comfortable.
 */
function stateOf(ratio: number): (typeof STATES)[keyof typeof STATES] {
  if (ratio > 1) return STATES.over;
  if (ratio >= 0.8) return STATES.warning;
  return STATES.ok;
}

/**
 * Builds the selectable month range around today. Future months are included on
 * purpose: budgeting is something you do before the month starts, not after.
 */
function monthOptions(): FieldOption[] {
  const options: FieldOption[] = [];
  const cursor = new Date();
  cursor.setUTCDate(1);
  cursor.setUTCMonth(cursor.getUTCMonth() - MONTHS_BACK);

  for (let index = 0; index <= MONTHS_BACK + MONTHS_FORWARD; index += 1) {
    const key = `${cursor.toISOString().slice(0, 8)}01`;
    options.push({ value: key, label: formatMonth(key) });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return options.reverse();
}

/**
 * Budgets for one month, with a form to set or correct a category's ceiling.
 *
 * A budget defined "from this month on" is stored as a standing template and
 * carries forward by itself — there is nothing to recreate in January. A budget
 * defined "only this month" is a one-off exception layered on top, and is
 * labelled as such so the two are never confused.
 */
export default function BudgetsPanel({
  periodMonth,
  items,
  categories,
}: Props): React.ReactElement {
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [scope, setScope] = useState('forward');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyCategory, setBusyCategory] = useState<string | null>(null);

  const categoryOptions: FieldOption[] = categories
    .filter((category) => category.kind === 'expense')
    .map((category) => ({
      value: category.id,
      label:
        category.parentName === null
          ? category.name
          : `${category.parentName} · ${category.name}`,
    }));

  const goToMonth = (value: string): void => {
    window.location.href = `/budgets?month=${value.slice(0, 7)}`;
  };

  const save = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (categoryId === '') {
      setError('Selecciona una categoría');
      return;
    }

    setSaving(true);
    setError(null);

    const response = await fetch('/api/budgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category_id: categoryId,
        period_month: periodMonth,
        amount_usd: amount,
        scope,
      }),
    });

    setSaving(false);

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'No se pudo guardar el presupuesto');
      return;
    }

    window.location.reload();
  };

  const remove = async (item: BudgetVsActual, removeScope: 'month' | 'all'): Promise<void> => {
    setBusyCategory(item.categoryId);
    setError(null);

    const params = new URLSearchParams({
      category_id: item.categoryId,
      period_month: periodMonth,
      scope: removeScope,
    });

    const response = await fetch(`/api/budgets?${params.toString()}`, { method: 'DELETE' });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'No se pudo eliminar');
      setBusyCategory(null);
      return;
    }

    window.location.reload();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <SelectField
          label="Mes"
          value={periodMonth}
          options={monthOptions()}
          onChange={goToMonth}
          className="w-56"
        />
      </div>

      <form
        onSubmit={save}
        className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[1fr_9rem_15rem_auto]"
      >
        <SelectField
          label="Categoría"
          value={categoryId}
          options={categoryOptions}
          onChange={setCategoryId}
        />

        <Field label="Monto en $" htmlFor="budget-amount">
          <Input
            id="budget-amount"
            type="number"
            step="0.01"
            min="0.01"
            required
            inputMode="decimal"
            placeholder="0,00"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>

        <SelectField
          label="Aplica"
          value={scope}
          options={SCOPE_OPTIONS}
          onChange={setScope}
          hint={
            scope === 'forward'
              ? 'No hay que recrearlo cada mes'
              : 'Excepción solo para este mes'
          }
        />

        <div className="flex items-start pt-[1.4rem]">
          <Button type="submit" disabled={saving}>
            {saving ? 'Guardando…' : 'Definir'}
          </Button>
        </div>
      </form>

      {error !== null && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No hay presupuestos vigentes en {formatMonth(periodMonth)}.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {items.map((item) => {
            const state = stateOf(item.consumedRatio);
            const busy = busyCategory === item.categoryId;

            return (
              <Card key={item.categoryId} className="gap-0 py-5">
                <CardContent className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {item.parentName !== null && (
                          <span className="text-muted-foreground">{item.parentName} · </span>
                        )}
                        {item.categoryName}
                      </p>
                      <p className="tabular mt-0.5 text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {formatUsd(item.spentUsd)}
                        </span>
                        {' de '}
                        {formatUsd(item.budgetUsd)}
                      </p>
                    </div>
                    <Badge variant={item.isOverride ? 'secondary' : 'outline'}>
                      {item.isOverride ? 'Solo este mes' : 'Recurrente'}
                    </Badge>
                  </div>

                  <Progress
                    value={Math.min(100, item.consumedRatio * 100)}
                    indicatorClassName={state.className}
                  />

                  <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
                    <span>
                      {state.label} · {formatPercent(item.consumedRatio)}
                    </span>
                    <span className="tabular">
                      {item.remainingUsd >= 0
                        ? `Quedan ${formatUsd(item.remainingUsd)}`
                        : `${formatUsd(Math.abs(item.remainingUsd))} por encima`}
                    </span>
                  </div>

                  {item.isOverride && item.templateUsd !== null && (
                    <p className="text-xs text-muted-foreground">
                      El recurrente para esta categoría es {formatUsd(item.templateUsd)}.
                    </p>
                  )}

                  <div className="flex justify-end gap-1 pt-1">
                    {item.isOverride && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => void remove(item, 'month')}
                      >
                        Quitar excepción
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => void remove(item, 'all')}
                    >
                      {busy ? '…' : 'Dejar de presupuestar'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
