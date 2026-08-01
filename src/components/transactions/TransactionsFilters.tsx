import { useState, type SyntheticEvent } from 'react';
import { ChevronDownIcon, SlidersHorizontalIcon } from 'lucide-react';
import type { Lookups } from '@/lib/queries/transactions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
 * Collapsible filter bar for the transaction list.
 *
 * Navigates rather than fetching: the list is rendered on the server, so the
 * URL is the single source of truth for what is being shown and a filtered view
 * stays shareable and reloadable. Blank values are dropped so the address bar
 * only ever carries filters that are actually narrowing something.
 *
 * Starts collapsed on every load, including when filters are already applied,
 * so the panel never pushes the primary actions below the fold. A hidden filter
 * that silently narrows the list would be a trap, so the count of active
 * filters rides on the trigger and the clear button is reachable without
 * expanding anything.
 */
export default function TransactionsFilters({ lookups, initial }: Props): React.ReactElement {
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [isOpen, setOpen] = useState(false);

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
    <Collapsible
      open={isOpen}
      onOpenChange={setOpen}
      className="rounded-xl border border-border bg-card"
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-1 gap-2 text-muted-foreground hover:text-foreground"
          >
            <SlidersHorizontalIcon className="size-4" aria-hidden="true" />
            Filtros
            {activeCount > 0 && (
              <Badge variant="secondary" className="px-1.5">
                {activeCount}
              </Badge>
            )}
            <ChevronDownIcon
              aria-hidden="true"
              className="size-4 transition-transform duration-200 data-[state=open]:rotate-180"
              data-state={isOpen ? 'open' : 'closed'}
            />
          </Button>
        </CollapsibleTrigger>

        {activeCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto text-muted-foreground hover:text-foreground"
            onClick={() => {
              window.location.href = '/transactions';
            }}
          >
            Limpiar
          </Button>
        )}
      </div>

      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <form
          onSubmit={apply}
          className="grid gap-4 border-t border-border p-4 sm:grid-cols-2 lg:grid-cols-4"
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
            value={
              values.direction === '' || values.direction === undefined ? ALL : values.direction
            }
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
            <Button type="button" variant="ghost" onClick={() => setValues({})}>
              Vaciar campos
            </Button>
          </div>
        </form>
      </CollapsibleContent>
    </Collapsible>
  );
}
