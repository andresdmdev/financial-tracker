import { useState } from 'react';
import type { GoalProgress } from '@/lib/queries/dashboard';
import type { LookupOption } from '@/lib/queries/transactions';
import { formatDate, formatPercent, formatUsd } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import GoalForm from '@/components/goals/GoalForm';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface Props {
  goals: GoalProgress[];
  accounts: LookupOption[];
}

const STATUS_LABEL = {
  active: 'Activa',
  completed: 'Completada',
  abandoned: 'Abandonada',
} as const;

/**
 * Projects the monthly contribution still needed to hit the target on time.
 * Returns null when there is no target, no date, or the date has passed.
 */
function requiredPerMonth(goal: GoalProgress): number | null {
  if (goal.targetAmountUsd === null || goal.targetDate === null) return null;

  const remaining = goal.targetAmountUsd - goal.currentAmountUsd;
  if (remaining <= 0) return null;

  const target = new Date(`${goal.targetDate}T00:00:00Z`);
  const now = new Date();
  const months =
    (target.getUTCFullYear() - now.getUTCFullYear()) * 12 +
    (target.getUTCMonth() - now.getUTCMonth());

  return months <= 0 ? null : remaining / months;
}

/**
 * Savings goals as cards, each linking to its own page, where it can be edited
 * or deleted.
 *
 * The cards carry no controls of their own on purpose: a button nested inside a
 * link is a trap for both keyboard and touch, and the detail page has the room
 * to explain what deleting a goal actually does.
 *
 * Progress is contributions minus spending charged to the goal, so buying the
 * thing the fund was for empties it instead of leaving a stale balance.
 */
export default function GoalsPanel({ goals, accounts }: Props): React.ReactElement {
  const [isOpen, setOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Aportar a una meta es un traslado, no un gasto: no afecta tus totales de gasto.
        </p>

        <Dialog open={isOpen} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="w-full sm:w-auto">Nueva meta</Button>
          </DialogTrigger>

          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Nueva meta de ahorro</DialogTitle>
              <DialogDescription>
                Un fondo para una compra futura. Sin objetivo solo acumula, sin calcular porcentaje.
              </DialogDescription>
            </DialogHeader>

            <GoalForm
              accounts={accounts}
              onCancel={() => setOpen(false)}
              onSaved={() => window.location.reload()}
            />
          </DialogContent>
        </Dialog>
      </div>

      {goals.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No hay metas de ahorro todavía.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {goals.map((goal) => {
            const monthly = requiredPerMonth(goal);

            return (
              <a
                key={goal.goalId}
                href={`/goals/${goal.goalId}`}
                className="group rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <Card className="h-full gap-0 py-5 transition-colors group-hover:border-primary/40">
                  <CardContent className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="truncate font-medium">{goal.name}</h3>
                      <Badge variant={goal.status === 'active' ? 'outline' : 'secondary'}>
                        {STATUS_LABEL[goal.status]}
                      </Badge>
                    </div>

                    <div>
                      <p className="tabular text-2xl font-semibold tracking-tight">
                        {formatUsd(goal.currentAmountUsd)}
                      </p>
                      {goal.targetAmountUsd !== null && (
                        <p className="text-xs text-muted-foreground">
                          de {formatUsd(goal.targetAmountUsd)}
                          {goal.targetDate !== null && ` · para ${formatDate(goal.targetDate)}`}
                        </p>
                      )}
                    </div>

                    {goal.progressRatio !== null && (
                      <div className="space-y-1.5">
                        <Progress value={Math.max(0, Math.min(100, goal.progressRatio * 100))} />
                        <p className="text-xs text-muted-foreground">
                          {formatPercent(goal.progressRatio)} alcanzado
                          {monthly !== null && ` · faltan ${formatUsd(monthly)} al mes`}
                        </p>
                      </div>
                    )}

                    <p className="pt-1 text-xs text-muted-foreground">
                      {goal.lastMovementOn === null
                        ? 'Sin movimientos'
                        : `Último movimiento ${formatDate(goal.lastMovementOn)}`}
                      <span className="ml-1 text-primary opacity-0 transition-opacity group-hover:opacity-100">
                        → ver detalle
                      </span>
                    </p>
                  </CardContent>
                </Card>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
