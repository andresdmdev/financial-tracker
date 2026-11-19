import { useState, type SyntheticEvent } from 'react';
import type { GoalTaskPriority, GoalTaskStatus } from '@/lib/database.types';
import type { GoalTask } from '@/lib/queries/goal-tasks';
import { toDayKey } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DialogFooter } from '@/components/ui/dialog';
import { Field, SelectField, type FieldOption } from '@/components/forms/Field';
import { cn } from '@/lib/utils';

export const PRIORITY_OPTIONS: FieldOption[] = [
  { value: '1', label: 'Alta' },
  { value: '2', label: 'Media' },
  { value: '3', label: 'Baja' },
];

export const STATUS_OPTIONS: FieldOption[] = [
  { value: 'pending', label: 'Pendiente' },
  { value: 'in_progress', label: 'En progreso' },
  { value: 'completed', label: 'Completada' },
];

interface FormValues {
  title: string;
  description: string;
  tag: string;
  priority: GoalTaskPriority;
  status: GoalTaskStatus;
  completed_on: string;
}

interface Props {
  goalId: string;
  /** Section a new task is created in; ignored when editing, since a task never moves. */
  sectionId?: string;
  /** Null when creating: the form then posts instead of patching. */
  task: GoalTask | null;
  onCancel: () => void;
  onSaved: (task: GoalTask) => void;
}

/**
 * Create/edit form for a goal task, used by the owner and by guests alike.
 *
 * The completion date only appears once the status is "Completada", and is
 * prefilled with the browser's today the moment it does, so marking something
 * done never asks for a date nobody wants to type.
 */
export default function GoalTaskForm({
  goalId,
  sectionId,
  task,
  onCancel,
  onSaved,
}: Props): React.ReactElement {
  const [form, setForm] = useState<FormValues>({
    title: task?.title ?? '',
    description: task?.description ?? '',
    tag: task?.tag ?? '',
    priority: task?.priority ?? 2,
    status: task?.status ?? 'pending',
    completed_on: task?.completedOn ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const update = <K extends keyof FormValues>(field: K, value: FormValues[K]): void => {
    setForm((previous) => ({ ...previous, [field]: value }));
  };

  const changeStatus = (status: GoalTaskStatus): void => {
    setForm((previous) => ({
      ...previous,
      status,
      completed_on:
        status === 'completed' ? previous.completed_on || toDayKey() : '',
    }));
  };

  const submit = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setFields({});

    const response = await fetch(
      task === null ? `/api/goals/${goalId}/tasks` : `/api/goals/${goalId}/tasks/${task.id}`,
      {
        method: task === null ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task === null ? { ...form, section_id: sectionId ?? null } : form),
      },
    );

    const body = (await response.json().catch(() => null)) as
      | (GoalTask & { error?: string; fields?: Record<string, string> })
      | null;

    setSaving(false);

    if (!response.ok || body === null) {
      setError(body?.error ?? 'No se pudo guardar la tarea');
      setFields(body?.fields ?? {});
      return;
    }

    onSaved(body);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error !== null && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Field label="Nombre" htmlFor="task-title" error={fields.title}>
        <Input
          id="task-title"
          type="text"
          required
          maxLength={120}
          placeholder="Cotizar tres concesionarios"
          value={form.title}
          onChange={(event) => update('title', event.target.value)}
        />
      </Field>

      <Field label="Descripción (opcional)" htmlFor="task-description" error={fields.description}>
        <textarea
          id="task-description"
          rows={3}
          maxLength={1000}
          value={form.description}
          onChange={(event) => update('description', event.target.value)}
          className={cn(
            'w-full min-w-0 resize-y rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground md:text-sm',
            'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
          )}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Prioridad"
          value={String(form.priority)}
          options={PRIORITY_OPTIONS}
          onChange={(value) => update('priority', Number(value) as GoalTaskPriority)}
        />
        <Field label="Etiqueta (opcional)" htmlFor="task-tag" error={fields.tag}>
          <Input
            id="task-tag"
            type="text"
            maxLength={30}
            placeholder="trámites"
            value={form.tag}
            onChange={(event) => update('tag', event.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Estado"
          value={form.status}
          options={STATUS_OPTIONS}
          onChange={(value) => changeStatus(value as GoalTaskStatus)}
        />
        {form.status === 'completed' && (
          <Field label="Completada el" htmlFor="task-completed" error={fields.completed_on}>
            <Input
              id="task-completed"
              type="date"
              required
              value={form.completed_on}
              onChange={(event) => update('completed_on', event.target.value)}
            />
          </Field>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Guardando…' : task === null ? 'Crear tarea' : 'Guardar cambios'}
        </Button>
      </DialogFooter>
    </form>
  );
}
