import { useState } from 'react';
import type { LookupOption } from '@/lib/queries/transactions';
import type { GoalStatus } from '@/lib/database.types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import GoalForm from '@/components/goals/GoalForm';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface Props {
  goalId: string;
  name: string;
  targetAmountUsd: number | null;
  targetDate: string | null;
  accountId: string | null;
  status: GoalStatus;
  notes: string | null;
  accounts: LookupOption[];
  movementCount: number;
}

/**
 * Edit and delete controls for a single savings goal.
 *
 * Deletion is confirmed through an `AlertDialog` rather than `window.confirm`:
 * the native dialog is drawn by the operating system and ignores the page's
 * theme entirely, and it gives no room to say how many movements are about to
 * lose their link to the goal.
 *
 * The transactions themselves survive — `goal_id` is `on delete set null` — so
 * the history stays intact and only the grouping disappears.
 */
export default function GoalActions({
  goalId,
  name,
  targetAmountUsd,
  targetDate,
  accountId,
  status,
  notes,
  accounts,
  movementCount,
}: Props): React.ReactElement {
  const [isEditOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async (): Promise<void> => {
    setDeleting(true);
    setError(null);

    const response = await fetch(`/api/goals/${goalId}`, { method: 'DELETE' });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'No se pudo eliminar la meta');
      setDeleting(false);
      return;
    }

    window.location.href = '/goals';
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Dialog open={isEditOpen} onOpenChange={setEditOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              Editar
            </Button>
          </DialogTrigger>

          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Editar meta</DialogTitle>
              <DialogDescription>
                Cambiar el objetivo no toca los aportes ya registrados; solo cambia contra qué se
                mide el progreso.
              </DialogDescription>
            </DialogHeader>

            <GoalForm
              accounts={accounts}
              goalId={goalId}
              initial={{
                name,
                target_amount_usd: targetAmountUsd === null ? '' : String(targetAmountUsd),
                target_date: targetDate ?? '',
                account_id: accountId ?? '',
                status,
                notes: notes ?? '',
              }}
              onCancel={() => setEditOpen(false)}
              onSaved={() => window.location.reload()}
            />
          </DialogContent>
        </Dialog>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              Eliminar
            </Button>
          </AlertDialogTrigger>

          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Eliminar «{name}»?</AlertDialogTitle>
              <AlertDialogDescription>
                {movementCount === 0
                  ? 'Esta meta no tiene movimientos, así que no se pierde nada más.'
                  : `Las ${movementCount} transacciones asociadas se conservan, pero dejan de estar vinculadas a esta meta y su reparto por cuenta se borra.`}{' '}
                No se puede deshacer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                disabled={deleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(event) => {
                  event.preventDefault();
                  void remove();
                }}
              >
                {deleting ? 'Eliminando…' : 'Eliminar meta'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {error !== null && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
