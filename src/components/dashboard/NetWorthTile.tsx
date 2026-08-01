import { useState } from 'react';
import type { DeclaredBalance, NetWorth } from '@/lib/queries/dashboard';
import { formatDate, formatUsd } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface Props {
  netWorth: NetWorth;
  balances: DeclaredBalance[];
  label: string;
  hint: string;
}

/**
 * Total money held, opening a breakdown of where it sits.
 *
 * The headline is a single number that nobody can audit on its own, so the tile
 * is a button: one tap shows each account's balance today, the figure that was
 * last declared for it, and when. The gap between those two columns is the
 * transactions recorded since — which is exactly what somebody doubting the
 * total wants to see.
 */
export default function NetWorthTile({
  netWorth,
  balances,
  label,
  hint,
}: Props): React.ReactElement {
  const [open, setOpen] = useState(false);

  const declaredCount = netWorth.accountsTotal - netWorth.accountsPending;
  const assets = balances.filter((balance) => balance.isAsset);
  const debts = balances.filter((balance) => !balance.isAsset);

  const row = (balance: DeclaredBalance): React.ReactElement => (
    <li
      key={balance.accountId}
      className="flex items-baseline justify-between gap-3 py-2.5 text-sm"
    >
      <span className="min-w-0">
        <span className="block truncate font-medium">{balance.name}</span>
        <span className="block text-xs text-muted-foreground">
          {balance.declaredOn === null
            ? 'Sin declarar'
            : `Declaraste ${formatUsd(balance.declaredUsd)} el ${formatDate(balance.declaredOn)}`}
          {balance.movementSinceUsd !== 0 && (
            <>
              {' · '}
              {balance.movementSinceUsd > 0 ? '+' : '−'}
              {formatUsd(Math.abs(balance.movementSinceUsd))} en transacciones
            </>
          )}
        </span>
      </span>
      <span className="tabular shrink-0 font-medium">
        {balance.currentUsd === null ? (
          <Badge variant="outline" className="font-normal text-muted-foreground">
            Pendiente
          </Badge>
        ) : (
          formatUsd(balance.currentUsd)
        )}
      </span>
    </li>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="rounded-xl text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Card className="h-full cursor-pointer gap-0 border-primary/25 bg-primary/6 py-4 transition-colors hover:border-primary/45">
            <CardContent className="px-4">
              <p className="text-xs font-medium text-muted-foreground">{label}</p>
              <p className="tabular mt-1.5 text-2xl font-semibold tracking-tight text-success">
                {declaredCount === 0 ? '—' : formatUsd(netWorth.netUsd)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{hint} · ver desglose</p>
            </CardContent>
          </Card>
        </button>
      </DialogTrigger>

      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Dónde está el dinero</DialogTitle>
          <DialogDescription>
            El saldo de cada cuenta parte de lo que declaraste y se mueve con cada transacción
            posterior a esa fecha.
          </DialogDescription>
        </DialogHeader>

        <ul className="divide-y divide-border">{assets.map(row)}</ul>

        {debts.length > 0 && (
          <>
            <p className="pt-1 text-xs font-medium text-muted-foreground">Deudas</p>
            <ul className="divide-y divide-border">{debts.map(row)}</ul>
          </>
        )}

        <dl className="space-y-1.5 rounded-lg bg-muted px-3 py-2.5 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Activos</dt>
            <dd className="tabular font-medium">{formatUsd(netWorth.assetsUsd)}</dd>
          </div>
          {netWorth.debtUsd !== 0 && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Deuda</dt>
              <dd className="tabular font-medium text-destructive">
                −{formatUsd(Math.abs(netWorth.debtUsd))}
              </dd>
            </div>
          )}
          <div className="flex justify-between gap-3 border-t border-border pt-1.5">
            <dt className="text-muted-foreground">Total</dt>
            <dd className="tabular font-semibold">{formatUsd(netWorth.netUsd)}</dd>
          </div>
        </dl>

        {netWorth.accountsPending > 0 && (
          <p className="text-xs text-muted-foreground">
            {netWorth.accountsPending} de {netWorth.accountsTotal} cuentas nunca se han declarado, así
            que no suman al total. Puedes declararlas desde Transacciones → Actualizar saldos.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
