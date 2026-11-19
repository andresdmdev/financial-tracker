import { useState } from 'react';
import type { GoalTaskStatus } from '@/lib/database.types';
import { sortGoalTasks, type GoalTask } from '@/lib/queries/goal-tasks';
import { formatDate, toDayKey } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import GoalTaskForm, { STATUS_OPTIONS } from '@/components/goals/GoalTaskForm';

interface Props {
  goalId: string;
  goalName: string;
  initialTasks: GoalTask[];
  /** When set, the board belongs to this section and new tasks are created in it. */
  sectionId?: string;
  /** Keeps each card's controls below its text, for a narrow side column. */
  compact?: boolean;
}

type Filter = 'all' | GoalTaskStatus;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'in_progress', label: 'En progreso' },
  { value: 'completed', label: 'Completadas' },
];

const PRIORITY = {
  1: { label: 'Alta', dot: 'bg-destructive' },
  2: { label: 'Media', dot: 'bg-chart-3' },
  3: { label: 'Baja', dot: 'bg-muted-foreground/50' },
} as const;

const STATUS_TONE: Record<GoalTaskStatus, string> = {
  pending: 'border-border text-muted-foreground',
  in_progress: 'border-chart-2/40 bg-chart-2/10 text-chart-2',
  completed: 'border-success/40 bg-success/10 text-success',
};

/**
 * The task board of one goal: filter by status, create, edit, change status in
 * place and remove. Owner and guests get exactly the same controls.
 *
 * Saves update local state from the row the API returns and re-sort with the
 * same `sortGoalTasks` the page used, so a task jumps to where a reload would
 * put it without reloading. Removal says the task disappears for everyone,
 * because it does, even though the row survives as a logical deletion.
 *
 * The same board serves a goal's general tasks and each section's own tasks;
 * `sectionId` only decides where a new task is created.
 */
export default function GoalTasksPanel({
  goalId,
  goalName,
  initialTasks,
  sectionId,
  compact = false,
}: Props): React.ReactElement {
  const [tasks, setTasks] = useState<GoalTask[]>(initialTasks);
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<GoalTask | null | undefined>(undefined);
  const [removing, setRemoving] = useState<GoalTask | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const counts: Record<Filter, number> = {
    all: tasks.length,
    pending: tasks.filter((task) => task.status === 'pending').length,
    in_progress: tasks.filter((task) => task.status === 'in_progress').length,
    completed: tasks.filter((task) => task.status === 'completed').length,
  };

  const visible = filter === 'all' ? tasks : tasks.filter((task) => task.status === filter);

  const upsert = (saved: GoalTask): void => {
    setTasks((previous) =>
      sortGoalTasks([...previous.filter((task) => task.id !== saved.id), saved]),
    );
  };

  const changeStatus = async (task: GoalTask, status: GoalTaskStatus): Promise<void> => {
    setBusyId(task.id);
    setError(null);

    const response = await fetch(`/api/goals/${goalId}/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: task.title,
        description: task.description,
        tag: task.tag,
        priority: task.priority,
        status,
        completed_on: status === 'completed' ? (task.completedOn ?? toDayKey()) : null,
      }),
    });

    const body = (await response.json().catch(() => null)) as
      | (GoalTask & { error?: string })
      | null;
    setBusyId(null);

    if (!response.ok || body === null) {
      setError(body?.error ?? 'No se pudo cambiar el estado');
      return;
    }
    upsert(body);
  };

  const remove = async (task: GoalTask): Promise<void> => {
    setBusyId(task.id);
    setError(null);

    const response = await fetch(`/api/goals/${goalId}/tasks/${task.id}`, { method: 'DELETE' });
    setBusyId(null);
    setRemoving(null);

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'No se pudo eliminar la tarea');
      return;
    }
    setTasks((previous) => previous.filter((item) => item.id !== task.id));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por estado">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                filter === option.value
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {option.label}
              <span className="tabular ml-1.5 opacity-70">{counts[option.value]}</span>
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => setEditing(null)}>
          Nueva tarea
        </Button>
      </div>

      {error !== null && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          {tasks.length === 0
            ? 'Esta meta no tiene tareas todavía. Crea la primera para organizar lo que falta.'
            : 'No hay tareas con este estado.'}
        </p>
      ) : (
        <ul className="space-y-2.5">
          {visible.map((task) => {
            const done = task.status === 'completed';
            return (
              <li key={task.id}>
                <Card
                  className={cn(
                    'gap-0 py-3.5 transition-opacity',
                    done && 'bg-muted/40',
                    busyId === task.id && 'opacity-60',
                  )}
                >
                  <CardContent
                    className={cn(
                      'flex flex-col gap-3 px-4',
                      !compact && 'sm:flex-row sm:items-start sm:justify-between',
                    )}
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-start gap-2.5">
                        <span
                          className={cn('mt-1.5 size-2 shrink-0 rounded-full', PRIORITY[task.priority].dot)}
                          title={`Prioridad ${PRIORITY[task.priority].label.toLowerCase()}`}
                          aria-label={`Prioridad ${PRIORITY[task.priority].label.toLowerCase()}`}
                        />
                        <p
                          className={cn(
                            'text-base font-medium sm:text-sm',
                            done && 'text-muted-foreground line-through decoration-muted-foreground/50',
                          )}
                        >
                          {task.title}
                        </p>
                      </div>

                      {task.description !== null && (
                        <p className="line-clamp-2 pl-4.5 text-sm text-muted-foreground">
                          {task.description}
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-1.5 pl-4.5 text-xs text-muted-foreground">
                        <Badge variant="outline" className="font-normal">
                          {PRIORITY[task.priority].label}
                        </Badge>
                        {task.tag !== null && (
                          <Badge variant="secondary" className="font-normal">
                            {task.tag}
                          </Badge>
                        )}
                        <span>
                          {task.createdByName === null ? 'Sin autor' : `Creada por ${task.createdByName}`}
                          {task.completedOn !== null && ` · Completada el ${formatDate(task.completedOn)}`}
                        </span>
                      </div>
                    </div>

                    <div className={cn('flex shrink-0 items-center gap-1.5 pl-4.5', !compact && 'sm:pl-0')}>
                      <Select
                        value={task.status}
                        disabled={busyId === task.id}
                        onValueChange={(value) => void changeStatus(task, value as GoalTaskStatus)}
                      >
                        <SelectTrigger
                          size="sm"
                          aria-label="Estado"
                          className={cn('h-8 w-[8.5rem] text-xs', STATUS_TONE[task.status])}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(task)}>
                        Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setRemoving(task)}
                      >
                        Eliminar
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={editing !== undefined} onOpenChange={(open) => !open && setEditing(undefined)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar tarea' : `Nueva tarea en «${goalName}»`}</DialogTitle>
            <DialogDescription>
              Todas las personas con acceso a esta meta pueden ver y editar sus tareas.
            </DialogDescription>
          </DialogHeader>
          {editing !== undefined && (
            <GoalTaskForm
              goalId={goalId}
              sectionId={sectionId}
              task={editing}
              onCancel={() => setEditing(undefined)}
              onSaved={(saved) => {
                upsert(saved);
                setEditing(undefined);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar «{removing?.title}»?</AlertDialogTitle>
            <AlertDialogDescription>
              La tarea se oculta para todas las personas con acceso a esta meta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={removing !== null && busyId === removing.id}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                if (removing !== null) void remove(removing);
              }}
            >
              Eliminar tarea
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
