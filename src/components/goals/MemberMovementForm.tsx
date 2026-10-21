import { useState, type SyntheticEvent } from 'react';
import type { LocalCurrency } from '@/lib/database.types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, SelectField, type FieldOption } from '@/components/forms/Field';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface Props {
  goalId: string;
}

type Direction = 'income' | 'expense';

interface FormState {
  occurred_on: string;
  direction: Direction;
  amount_usd: string;
  amount_local: string;
  local_currency: '' | LocalCurrency;
  payment_method: string;
  tags: string;
  notes: string;
}

const DIRECTION_OPTIONS: FieldOption[] = [
  { value: 'expense', label: 'Gasto' },
  { value: 'income', label: 'Ingreso' },
];

const CURRENCY_OPTIONS: FieldOption[] = [
  { value: 'USD', label: 'Pagado en dólares' },
  { value: 'VES', label: 'Bolívares (VES)' },
  { value: 'COP', label: 'Pesos colombianos (COP)' },
];

/**
 * Starting state: an expense dated today, which is what a guest records most.
 */
function emptyForm(): FormState {
  return {
    occurred_on: new Date().toISOString().slice(0, 10),
    direction: 'expense',
    amount_usd: '',
    amount_local: '',
    local_currency: '',
    payment_method: '',
    tags: '',
    notes: '',
  };
}

/**
 * Button and dialog through which a guest records an income or expense on a
 * goal shared with it.
 *
 * Deliberately narrower than `TransactionForm`: the guest never sees the
 * owner's accounts or categories, so neither is asked for. The server takes
 * both from the share. "Por dónde se pagó" is free text describing the guest's
 * own means of payment, not one of the owner's accounts.
 */
export default function MemberMovementForm({ goalId }: Props): React.ReactElement {
  const [isOpen, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const update = <K extends keyof FormState>(field: K, value: FormState[K]): void => {
    setForm((previous) => ({ ...previous, [field]: value }));
  };

  const submit = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    setFieldErrors({});

    const response = await fetch(`/api/goals/${goalId}/movements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        occurred_on: form.occurred_on,
        direction: form.direction,
        amount_usd: form.amount_usd,
        amount_local: form.amount_local === '' ? null : form.amount_local,
        local_currency: form.local_currency === '' ? null : form.local_currency,
        payment_method: form.payment_method,
        tags: form.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter((tag) => tag !== ''),
        notes: form.notes,
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        fields?: Record<string, string>;
      } | null;
      setFormError(body?.error ?? 'No se pudo guardar');
      setFieldErrors(body?.fields ?? {});
      setSaving(false);
      return;
    }

    window.location.reload();
  };

  const error = (field: string): string | undefined => fieldErrors[field];

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Nuevo movimiento</Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nuevo movimiento</DialogTitle>
          <DialogDescription>
            Los montos se guardan siempre en positivo; el tipo es el que le da el signo. Una vez
            guardado no se puede editar ni borrar.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          {formError !== null && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fecha" htmlFor="member_occurred_on" error={error('occurred_on')}>
              <Input
                id="member_occurred_on"
                type="date"
                required
                value={form.occurred_on}
                onChange={(event) => update('occurred_on', event.target.value)}
              />
            </Field>

            <SelectField
              label="Tipo"
              value={form.direction}
              options={DIRECTION_OPTIONS}
              onChange={(value) => update('direction', value as Direction)}
            />

            <Field label="Monto en $" htmlFor="member_amount_usd" error={error('amount_usd')}>
              <Input
                id="member_amount_usd"
                type="number"
                step="0.01"
                min="0.01"
                required
                inputMode="decimal"
                placeholder="0,00"
                value={form.amount_usd}
                onChange={(event) => update('amount_usd', event.target.value)}
              />
            </Field>

            <SelectField
              label="Moneda con la que pagaste"
              value={form.local_currency === '' ? 'USD' : form.local_currency}
              options={CURRENCY_OPTIONS}
              onChange={(value) =>
                setForm((previous) => ({
                  ...previous,
                  local_currency: value === 'USD' ? '' : (value as LocalCurrency),
                  amount_local: value === 'USD' ? '' : previous.amount_local,
                }))
              }
              error={error('local_currency')}
            />

            {form.local_currency !== '' && (
              <Field
                label={`Monto en ${form.local_currency}`}
                htmlFor="member_amount_local"
                error={error('amount_local')}
              >
                <Input
                  id="member_amount_local"
                  type="number"
                  step="0.01"
                  min="0.01"
                  inputMode="decimal"
                  value={form.amount_local}
                  onChange={(event) => update('amount_local', event.target.value)}
                />
              </Field>
            )}

            <Field
              label="Por dónde se pagó"
              htmlFor="member_payment_method"
              error={error('payment_method')}
            >
              <Input
                id="member_payment_method"
                type="text"
                maxLength={60}
                placeholder="Mercantil, Binance, Efectivo…"
                value={form.payment_method}
                onChange={(event) => update('payment_method', event.target.value)}
              />
            </Field>
          </div>

          <Field label="Etiquetas" htmlFor="member_tags" hint="Separadas por coma.">
            <Input
              id="member_tags"
              type="text"
              value={form.tags}
              onChange={(event) => update('tags', event.target.value)}
            />
          </Field>

          <Field label="Detalle" htmlFor="member_notes" error={error('notes')}>
            <Input
              id="member_notes"
              type="text"
              maxLength={500}
              value={form.notes}
              onChange={(event) => update('notes', event.target.value)}
            />
          </Field>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
