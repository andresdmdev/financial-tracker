import { useState, type SyntheticEvent } from 'react';
import type { Lookups, TransactionListItem } from '@/lib/queries/transactions';
import type { LocalCurrency, TxDirection, TxStatus } from '@/lib/database.types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, SelectField, type FieldOption } from '@/components/forms/Field';

interface Props {
  lookups: Lookups;
  transaction: TransactionListItem | null;
  onCancel: () => void;
  onSaved: () => void;
}

interface FormState {
  occurred_on: string;
  direction: TxDirection;
  account_id: string;
  to_account_id: string;
  category_id: string;
  goal_id: string;
  amount_usd: string;
  amount_local: string;
  local_currency: '' | LocalCurrency;
  status: TxStatus;
  tags: string;
  notes: string;
}

const DIRECTION_OPTIONS: FieldOption[] = [
  { value: 'expense', label: 'Gasto' },
  { value: 'income', label: 'Ingreso' },
  { value: 'transfer', label: 'Traslado' },
];

const STATUS_OPTIONS: FieldOption[] = [
  { value: 'paid', label: 'Pagado' },
  { value: 'pending', label: 'Pendiente' },
];

const CURRENCY_OPTIONS: FieldOption[] = [
  { value: 'USD', label: 'Pagado en dólares' },
  { value: 'VES', label: 'Bolívares (VES)' },
  { value: 'COP', label: 'Pesos colombianos (COP)' },
];

/**
 * Builds the initial form state, falling back to a paid expense dated today,
 * which is by far the most common entry.
 */
function initialState(transaction: TransactionListItem | null): FormState {
  if (transaction === null) {
    return {
      occurred_on: new Date().toISOString().slice(0, 10),
      direction: 'expense',
      account_id: '',
      to_account_id: '',
      category_id: '',
      goal_id: '',
      amount_usd: '',
      amount_local: '',
      local_currency: '',
      status: 'paid',
      tags: '',
      notes: '',
    };
  }

  return {
    occurred_on: transaction.occurredOn,
    direction: transaction.direction,
    account_id: transaction.accountId,
    to_account_id: transaction.toAccountId ?? '',
    category_id: transaction.categoryId ?? '',
    goal_id: transaction.goalId ?? '',
    amount_usd: String(transaction.amountUsd),
    amount_local: transaction.amountLocal === null ? '' : String(transaction.amountLocal),
    local_currency: transaction.localCurrency ?? '',
    status: transaction.status,
    tags: transaction.tags.join(', '),
    notes: transaction.notes ?? '',
  };
}

/**
 * Create/edit form for a transaction.
 *
 * The direction drives which fields apply: a transfer takes a destination
 * account and no category, everything else takes a category and no destination.
 * The same rule is enforced by the Zod schema and by database constraints.
 */
export default function TransactionForm({
  lookups,
  transaction,
  onCancel,
  onSaved,
}: Props): React.ReactElement {
  const [form, setForm] = useState<FormState>(() => initialState(transaction));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isTransfer = form.direction === 'transfer';
  const categoryKind = form.direction === 'income' ? 'income' : 'expense';

  const accountOptions: FieldOption[] = lookups.accounts.map((account) => ({
    value: account.id,
    label: account.name,
  }));

  const categoryOptions: FieldOption[] = lookups.categories
    .filter((category) => category.kind === categoryKind)
    .map((category) => ({
      value: category.id,
      label:
        category.parentName === null
          ? category.name
          : `${category.parentName} · ${category.name}`,
    }));

  const goalOptions: FieldOption[] = [
    { value: 'none', label: 'Ninguna' },
    ...lookups.goals.map((goal) => ({ value: goal.id, label: goal.name })),
  ];

  const update = <K extends keyof FormState>(field: K, value: FormState[K]): void => {
    setForm((previous) => ({ ...previous, [field]: value }));
  };

  const submit = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    setFieldErrors({});

    const payload = {
      occurred_on: form.occurred_on,
      direction: form.direction,
      account_id: form.account_id,
      to_account_id: isTransfer ? form.to_account_id : null,
      category_id: isTransfer ? null : form.category_id,
      goal_id: form.goal_id === '' ? null : form.goal_id,
      amount_usd: form.amount_usd,
      amount_local: form.amount_local === '' ? null : form.amount_local,
      local_currency: form.local_currency === '' ? null : form.local_currency,
      status: form.status,
      tags: form.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag !== ''),
      notes: form.notes,
    };

    const response = await fetch(
      transaction === null ? '/api/transactions' : `/api/transactions/${transaction.id}`,
      {
        method: transaction === null ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );

    setSaving(false);

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        fields?: Record<string, string>;
      } | null;
      setFormError(body?.error ?? 'No se pudo guardar');
      setFieldErrors(body?.fields ?? {});
      return;
    }

    onSaved();
  };

  const error = (field: string): string | undefined => fieldErrors[field];

  return (
    <form onSubmit={submit} className="space-y-5">
      {formError !== null && (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Fecha" htmlFor="occurred_on" error={error('occurred_on')}>
          <Input
            id="occurred_on"
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
          onChange={(value) => {
            const direction = value as TxDirection;
            setForm((previous) => ({
              ...previous,
              direction,
              category_id: direction === 'transfer' ? '' : previous.category_id,
              to_account_id: direction === 'transfer' ? previous.to_account_id : '',
            }));
          }}
        />

        <SelectField
          label={isTransfer ? 'Cuenta origen' : 'Cuenta'}
          value={form.account_id}
          options={accountOptions}
          onChange={(value) => update('account_id', value)}
          error={error('account_id')}
        />

        {isTransfer ? (
          <SelectField
            label="Cuenta destino"
            value={form.to_account_id}
            options={accountOptions}
            onChange={(value) => update('to_account_id', value)}
            error={error('to_account_id')}
          />
        ) : (
          <SelectField
            label="Categoría"
            value={form.category_id}
            options={categoryOptions}
            onChange={(value) => update('category_id', value)}
            error={error('category_id')}
          />
        )}

        <Field label="Monto en $" htmlFor="amount_usd" error={error('amount_usd')}>
          <Input
            id="amount_usd"
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
            htmlFor="amount_local"
            error={error('amount_local')}
            hint="Se guarda junto a la tasa que implica, para poder auditarlo después"
          >
            <Input
              id="amount_local"
              type="number"
              step="0.01"
              min="0.01"
              inputMode="decimal"
              value={form.amount_local}
              onChange={(event) => update('amount_local', event.target.value)}
            />
          </Field>
        )}

        <SelectField
          label="Estado"
          value={form.status}
          options={STATUS_OPTIONS}
          onChange={(value) => update('status', value as TxStatus)}
        />

        <SelectField
          label="Meta de ahorro (opcional)"
          value={form.goal_id === '' ? 'none' : form.goal_id}
          options={goalOptions}
          onChange={(value) => update('goal_id', value === 'none' ? '' : value)}
        />
      </div>

      <Field
        label="Etiquetas"
        htmlFor="tags"
        hint="Separadas por coma. Son transversales a la categoría: un café puede ser Comida y gastos-hormiga a la vez."
      >
        <Input
          id="tags"
          type="text"
          placeholder="gastos-hormiga, reembolsable"
          value={form.tags}
          onChange={(event) => update('tags', event.target.value)}
        />
      </Field>

      <Field label="Nota" htmlFor="notes">
        <Input
          id="notes"
          type="text"
          maxLength={500}
          value={form.notes}
          onChange={(event) => update('notes', event.target.value)}
        />
      </Field>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </form>
  );
}
