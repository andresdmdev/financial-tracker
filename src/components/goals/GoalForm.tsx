import { useState, type SyntheticEvent } from 'react';
import type { LookupOption } from '@/lib/queries/transactions';
import type { GoalStatus } from '@/lib/database.types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DialogFooter } from '@/components/ui/dialog';
import { Field, SelectField, type FieldOption } from '@/components/forms/Field';

/** A goal as the form edits it, with every field already a string. */
export interface GoalFormValues {
  name: string;
  target_amount_usd: string;
  target_date: string;
  account_id: string;
  status: GoalStatus;
  notes: string;
}

interface Props {
  accounts: LookupOption[];
  /** Absent when creating: the form then posts instead of patching. */
  goalId?: string;
  initial?: Partial<GoalFormValues>;
  onCancel: () => void;
  onSaved: () => void;
}

const NO_ACCOUNT = 'none';

const STATUS_OPTIONS: FieldOption[] = [
  { value: 'active', label: 'Activa' },
  { value: 'completed', label: 'Completada' },
  { value: 'abandoned', label: 'Abandonada' },
];

const EMPTY: GoalFormValues = {
  name: '',
  target_amount_usd: '',
  target_date: '',
  account_id: '',
  status: 'active',
  notes: '',
};

/**
 * Create/edit form for a savings goal, shared by the creation dialog on the
 * list and the edit dialog on the goal's own page so the two cannot drift apart.
 *
 * The status selector only appears when editing: a goal being created is always
 * active, and offering "Abandonada" at that moment is noise.
 */
export default function GoalForm({
  accounts,
  goalId,
  initial,
  onCancel,
  onSaved,
}: Props): React.ReactElement {
  const [form, setForm] = useState<GoalFormValues>({ ...EMPTY, ...initial });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isEdit = goalId !== undefined;

  const accountOptions: FieldOption[] = [
    { value: NO_ACCOUNT, label: 'Sin especificar' },
    ...accounts.map((account) => ({ value: account.id, label: account.name })),
  ];

  const update = <K extends keyof GoalFormValues>(field: K, value: GoalFormValues[K]): void => {
    setForm((previous) => ({ ...previous, [field]: value }));
  };

  const submit = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const response = await fetch(isEdit ? `/api/goals/${goalId}` : '/api/goals', {
      method: isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });

    setSaving(false);

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? (isEdit ? 'No se pudo guardar la meta' : 'No se pudo crear la meta'));
      return;
    }

    onSaved();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error !== null && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Field label="Nombre" htmlFor="goal-name">
        <Input
          id="goal-name"
          type="text"
          required
          maxLength={80}
          value={form.name}
          onChange={(event) => update('name', event.target.value)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Objetivo en $ (opcional)" htmlFor="goal-target">
          <Input
            id="goal-target"
            type="number"
            step="0.01"
            min="0.01"
            inputMode="decimal"
            placeholder="0,00"
            value={form.target_amount_usd}
            onChange={(event) => update('target_amount_usd', event.target.value)}
          />
        </Field>

        <Field label="Fecha objetivo (opcional)" htmlFor="goal-date">
          <Input
            id="goal-date"
            type="date"
            value={form.target_date}
            onChange={(event) => update('target_date', event.target.value)}
          />
        </Field>
      </div>

      <SelectField
        label="Cuenta donde vive el dinero"
        value={form.account_id === '' ? NO_ACCOUNT : form.account_id}
        options={accountOptions}
        onChange={(value) => update('account_id', value === NO_ACCOUNT ? '' : value)}
      />

      {isEdit && (
        <SelectField
          label="Estado"
          value={form.status}
          options={STATUS_OPTIONS}
          onChange={(value) => update('status', value as GoalStatus)}
        />
      )}

      <Field label="Descripción" htmlFor="goal-notes" hint="Aparece en el encabezado de la meta">
        <Input
          id="goal-notes"
          type="text"
          maxLength={500}
          value={form.notes}
          onChange={(event) => update('notes', event.target.value)}
        />
      </Field>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear meta'}
        </Button>
      </DialogFooter>
    </form>
  );
}
