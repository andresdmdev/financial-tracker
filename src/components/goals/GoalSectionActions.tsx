import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
import GoalSectionForm from '@/components/goals/GoalSectionForm';

interface Props {
  goalId: string;
  section: { id: string; title: string; contentMd: string };
}

/**
 * Owner controls on a section page: edit its title and markdown, or remove it.
 * Removal is logical; it returns to the goal because the section's page stops
 * existing for everyone.
 */
export default function GoalSectionActions({ goalId, section }: Props): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async (): Promise<void> => {
    setDeleting(true);
    setError(null);

    const response = await fetch(`/api/goals/${goalId}/sections/${section.id}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'No se pudo eliminar la sección');
      setDeleting(false);
      return;
    }

    window.location.href = `/goals/${goalId}`;
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Dialog open={editing} onOpenChange={setEditing}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              Editar
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Editar sección</DialogTitle>
              <DialogDescription>
                Los cambios se ven de inmediato para todas las personas con acceso a la meta.
              </DialogDescription>
            </DialogHeader>
            <GoalSectionForm
              goalId={goalId}
              section={section}
              onCancel={() => setEditing(false)}
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
              <AlertDialogTitle>¿Eliminar «{section.title}»?</AlertDialogTitle>
              <AlertDialogDescription>
                La sección y sus tareas dejan de verse para todas las personas con acceso a la
                meta.
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
                {deleting ? 'Eliminando…' : 'Eliminar sección'}
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
