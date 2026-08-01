import { useState } from 'react';
import TransactionForm from '@/components/transactions/TransactionForm';
import BalancesDialog from '@/components/balances/BalancesDialog';
import type { Lookups, TransactionListItem } from '@/lib/queries/transactions';
import type { DeclaredBalance } from '@/lib/queries/dashboard';
import { formatDate, formatLocal, formatUsd } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { cn } from '@/lib/utils';

interface Props {
  items: TransactionListItem[];
  lookups: Lookups;
  balances: DeclaredBalance[];
  total: number;
  page: number;
  pageSize: number;
  /** Active filters as a query string, without `page`. Built on the server. */
  filterQuery: string;
}

const AMOUNT_CLASS = {
  income: 'text-success',
  expense: 'text-foreground',
  transfer: 'text-muted-foreground',
} as const;

const AMOUNT_PREFIX = {
  income: '+',
  expense: '−',
  transfer: '',
} as const;

/**
 * Builds a page URL preserving the active filters, so paging never silently
 * widens the result set.
 *
 * Takes the filters as an argument rather than reading `window.location`: this
 * runs during render, and an island renders on the server too, where there is
 * no `window`.
 */
function pageHref(filterQuery: string, target: number): string {
  const params = new URLSearchParams(filterQuery);
  params.set('page', String(target));
  return `/transactions?${params.toString()}`;
}

/**
 * Page numbers to render: the first, the last, and a window around the current
 * one, with `null` marking each gap. Twenty-three pages of history would
 * otherwise produce twenty-three buttons.
 */
function pageWindow(page: number, totalPages: number): (number | null)[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set([1, totalPages, page, page - 1, page + 1]);
  const sorted = [...pages].filter((value) => value >= 1 && value <= totalPages).sort((a, b) => a - b);

  const result: (number | null)[] = [];
  let previous = 0;

  for (const value of sorted) {
    if (previous !== 0 && value - previous > 1) result.push(null);
    result.push(value);
    previous = value;
  }

  return result;
}

/**
 * Transaction list with create, edit, delete, balance declaration and paging.
 *
 * Renders as a table from `sm` up and as a card list below it. A table wide
 * enough for six columns can only be read on a phone by scrolling sideways,
 * which is not the same thing as fitting.
 *
 * After a successful mutation the page reloads rather than patching local
 * state: the totals rendered elsewhere on the server would otherwise drift out
 * of sync with the list.
 */
export default function TransactionsPanel({
  items,
  lookups,
  balances,
  total,
  page,
  pageSize,
  filterQuery,
}: Props): React.ReactElement {
  const [editing, setEditing] = useState<TransactionListItem | null>(null);
  const [isFormOpen, setFormOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  const openCreate = (): void => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (transaction: TransactionListItem): void => {
    setEditing(transaction);
    setFormOpen(true);
  };

  const remove = async (transaction: TransactionListItem): Promise<void> => {
    setDeletingId(transaction.id);
    setError(null);

    const response = await fetch(`/api/transactions/${transaction.id}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'No se pudo eliminar');
      setDeletingId(null);
      return;
    }

    window.location.reload();
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {total === 0
            ? 'Sin resultados'
            : `Mostrando ${first}–${last} de ${total.toLocaleString('es-VE')}`}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <BalancesDialog balances={balances} />
          <Button onClick={openCreate} className="w-full sm:w-auto">
            Nueva transacción
          </Button>
        </div>
      </div>

      {error !== null && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <ul className="space-y-2 sm:hidden">
        {items.length === 0 ? (
          <li className="rounded-xl border border-border bg-card py-12 text-center text-sm text-muted-foreground">
            No hay transacciones que coincidan con los filtros.
          </li>
        ) : (
          items.map((item) => (
            <li key={item.id} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 font-medium">
                  {item.direction === 'transfer'
                    ? `Traslado → ${item.toAccountName ?? '—'}`
                    : (item.categoryName ?? '—')}
                </span>
                <span
                  className={cn(
                    'tabular shrink-0 text-lg font-medium whitespace-nowrap',
                    AMOUNT_CLASS[item.direction],
                  )}
                >
                  {AMOUNT_PREFIX[item.direction]}
                  {formatUsd(item.amountUsd)}
                </span>
              </div>

              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatDate(item.occurredOn)} · {item.accountName}
                {item.amountLocal !== null && ` · ${formatLocal(item.amountLocal, item.localCurrency)}`}
              </p>

              {item.notes !== null && (
                <p className="mt-1 truncate text-xs text-muted-foreground">{item.notes}</p>
              )}

              {(item.goalName !== null || item.tags.length > 0 || item.status === 'pending') && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {item.status === 'pending' && (
                    <Badge variant="outline" className="text-muted-foreground">
                      Pendiente
                    </Badge>
                  )}
                  {item.goalName !== null && <Badge variant="secondary">{item.goalName}</Badge>}
                  {item.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="font-normal">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}

              <div className="mt-2 flex justify-end gap-1 border-t border-border pt-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(item)}>
                  Editar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={deletingId === item.id}
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => void remove(item)}
                >
                  {deletingId === item.id ? '…' : 'Borrar'}
                </Button>
              </div>
            </li>
          ))
        )}
      </ul>

      <div className="hidden overflow-hidden rounded-xl border border-border bg-card sm:block">
        <div className="overflow-x-auto">
          <Table className="min-w-[44rem]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-28">Fecha</TableHead>
                <TableHead>Concepto</TableHead>
                <TableHead className="w-32">Cuenta</TableHead>
                <TableHead className="w-36 text-right">Monto</TableHead>
                <TableHead className="w-24">Estado</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="py-14 text-center text-muted-foreground">
                    No hay transacciones que coincidan con los filtros.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.id} className="group">
                    <TableCell className="tabular whitespace-nowrap text-muted-foreground">
                      {formatDate(item.occurredOn)}
                    </TableCell>

                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">
                          {item.direction === 'transfer'
                            ? `Traslado → ${item.toAccountName ?? '—'}`
                            : (item.categoryName ?? '—')}
                        </span>
                        {item.goalName !== null && (
                          <Badge variant="secondary">{item.goalName}</Badge>
                        )}
                        {item.tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="font-normal">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                      {item.notes !== null && (
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {item.notes}
                        </span>
                      )}
                    </TableCell>

                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {item.accountName}
                    </TableCell>

                    <TableCell
                      className={cn(
                        'tabular text-right whitespace-nowrap font-medium',
                        AMOUNT_CLASS[item.direction],
                      )}
                    >
                      {AMOUNT_PREFIX[item.direction]}
                      {formatUsd(item.amountUsd)}
                      {item.amountLocal !== null && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          {formatLocal(item.amountLocal, item.localCurrency)}
                        </span>
                      )}
                    </TableCell>

                    <TableCell>
                      {item.status === 'pending' ? (
                        <Badge variant="outline" className="text-muted-foreground">
                          Pendiente
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Pagado</span>
                      )}
                    </TableCell>

                    <TableCell className="text-right whitespace-nowrap">
                      <div className="flex justify-end gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(item)}
                        >
                          Editar
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={deletingId === item.id}
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => void remove(item)}
                        >
                          {deletingId === item.id ? '…' : 'Borrar'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            {page > 1 && (
              <PaginationItem>
                <PaginationPrevious href={pageHref(filterQuery, page - 1)} />
              </PaginationItem>
            )}

            {pageWindow(page, totalPages).map((target, index) =>
              target === null ? (
                <PaginationItem key={`gap-${index}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={target}>
                  <PaginationLink href={pageHref(filterQuery, target)} isActive={target === page}>
                    {target}
                  </PaginationLink>
                </PaginationItem>
              ),
            )}

            {page < totalPages && (
              <PaginationItem>
                <PaginationNext href={pageHref(filterQuery, page + 1)} />
              </PaginationItem>
            )}
          </PaginationContent>
        </Pagination>
      )}

      <Dialog open={isFormOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing === null ? 'Nueva transacción' : 'Editar transacción'}
            </DialogTitle>
            <DialogDescription>
              Los montos se guardan siempre en positivo; el tipo es el que le da el signo.
            </DialogDescription>
          </DialogHeader>
          <TransactionForm
            lookups={lookups}
            transaction={editing}
            onCancel={() => setFormOpen(false)}
            onSaved={() => window.location.reload()}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
