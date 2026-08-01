import { useState, type SyntheticEvent } from 'react';
import type { Lookups } from '@/lib/queries/transactions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, SelectField, type FieldOption } from '@/components/forms/Field';

interface Props {
  lookups: Lookups;
  initial: Record<string, string>;
}

const ALL = 'all';

const DIRECTION_OPTIONS: FieldOption[] = [
  { value: ALL, label: 'Todos' },
  { value: 'expense', label: 'Gasto' },
  { value: 'income', label: 'Ingreso' },
  { value: 'transfer', label: 'Traslado' },
];

const STATUS_OPTIONS: FieldOption[] = [
  { value: ALL, label: 'Todos' },
  { value: 'paid', label: 'Pagado' },
  { value: 'pending', label: 'Pendiente' },
];

/**
 * Filter bar for the transaction list.
 *
 * Navigates rather than fetching: the list is rendered on the server, so the
 * URL is the single source of truth for what is being shown and a filtered view
 * stays shareable and reloadable. Blank values are dropped so the address bar
 * only ever carries filters that are actually narrowing something.
 */
export default function TransactionsFilters({ lookups, initial }: Props): React.ReactElement {
  const [values, setValues] = useState<Record<string, string>>(initial);

  const accountOptions: FieldOption[] = [
    { value: ALL, label: 'Todas' },
    ...lookups.accounts.map((account) => ({ value: account.id, label: account.name })),
  ];

  const categoryOptions: FieldOption[] = [
    { value: ALL, label: 'Todas' },
    ...lookups.categories.map((category) => ({
      value: category.id,
      label:
        category.parentName === null
          ? category.name
          : `${category.parentName} · ${category.name}`,
    })),
  ];

  const set = (key: string, value: string): void => {
    setValues((previous) => ({ ...previous, [key]: value === ALL ? '' : value }));
  };

  const apply = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
      if (value.trim() !== '') params.set(key, value.trim());
    }

    const query = params.toString();
    window.location.href = query === '' ? '/transactions' : `/transactions?${query}`;
  };

  const activeCount = Object.values(values).filter((value) => value.trim() !== '').length;

  return (
    <form
      onSubmit={apply}
      className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <Field label="Desde" htmlFor="from">
        <Input
          id="from"
          type="date"
          value={values.from ?? ''}
          onChange={(event) => set('from', event.target.value)}
        />
      </Field>

      <Field label="Hasta" htmlFor="to">
        <Input
          id="to"
          type="date"
          value={values.to ?? ''}
          onChange={(event) => set('to', event.target.value)}
        />
      </Field>

      <SelectField
        label="Categoría"
        value={values.category === '' || values.category === undefined ? ALL : values.category}
        options={categoryOptions}
        onChange={(value) => set('category', value)}
      />

      <SelectField
        label="Cuenta"
        value={values.account === '' || values.account === undefined ? ALL : values.account}
        options={accountOptions}
        onChange={(value) => set('account', value)}
      />

      <SelectField
        label="Tipo"
        value={values.direction === '' || values.direction === undefined ? ALL : values.direction}
        options={DIRECTION_OPTIONS}
        onChange={(value) => set('direction', value)}
      />

      <SelectField
        label="Estado"
        value={values.status === '' || values.status === undefined ? ALL : values.status}
        options={STATUS_OPTIONS}
        onChange={(value) => set('status', value)}
      />

      <Field label="Etiqueta" htmlFor="tag">
        <Input
          id="tag"
          type="text"
          placeholder="gastos-hormiga"
          value={values.tag ?? ''}
          onChange={(event) => set('tag', event.target.value)}
        />
      </Field>

      <Field label="Buscar en notas" htmlFor="q">
        <Input
          id="q"
          type="search"
          placeholder="cabify, mercado…"
          value={values.q ?? ''}
          onChange={(event) => set('q', event.target.value)}
        />
      </Field>

      <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit">Filtrar</Button>
        {activeCount > 0 && (
          <Button type="button" variant="ghost" onClick={() => setValues({})}>
            Limpiar {activeCount}
          </Button>
        )}
      </div>
    </form>
  );
}
