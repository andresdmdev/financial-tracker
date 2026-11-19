import { useState, type SyntheticEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DialogFooter } from '@/components/ui/dialog';
import { Field } from '@/components/forms/Field';
import MarkdownView from '@/components/MarkdownView';
import { cn } from '@/lib/utils';

interface Props {
  goalId: string;
  /** Absent when creating: the form then posts instead of patching. */
  section?: { id: string; title: string; contentMd: string };
  onCancel: () => void;
  onSaved: (sectionId: string) => void;
}

/**
 * Create/edit form for a goal section: a title and its markdown document.
 *
 * A Editar / Vista previa switch renders the draft with the same `MarkdownView`
 * the section page uses, so what the owner previews is exactly what guests
 * will read.
 */
export default function GoalSectionForm({
  goalId,
  section,
  onCancel,
  onSaved,
}: Props): React.ReactElement {
  const [title, setTitle] = useState(section?.title ?? '');
  const [contentMd, setContentMd] = useState(section?.contentMd ?? '');
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const submit = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setFields({});

    const response = await fetch(
      section === undefined
        ? `/api/goals/${goalId}/sections`
        : `/api/goals/${goalId}/sections/${section.id}`,
      {
        method: section === undefined ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content_md: contentMd }),
      },
    );

    const body = (await response.json().catch(() => null)) as
      | { id?: string; error?: string; fields?: Record<string, string> }
      | null;

    setSaving(false);

    if (!response.ok || body?.id === undefined) {
      setError(body?.error ?? 'No se pudo guardar la sección');
      setFields(body?.fields ?? {});
      return;
    }

    onSaved(body.id);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error !== null && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Field label="Nombre" htmlFor="section-title" error={fields.title}>
        <Input
          id="section-title"
          type="text"
          required
          maxLength={80}
          placeholder="Impermeabilización del techo"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-muted-foreground">Documento (markdown)</span>
          <div className="flex gap-1 rounded-lg bg-muted p-0.5 text-xs">
            {[false, true].map((mode) => (
              <button
                key={String(mode)}
                type="button"
                aria-pressed={preview === mode}
                onClick={() => setPreview(mode)}
                className={cn(
                  'rounded-md px-2.5 py-1 font-medium transition-colors',
                  preview === mode
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {mode ? 'Vista previa' : 'Editar'}
              </button>
            ))}
          </div>
        </div>

        {preview ? (
          <div className="max-h-[50dvh] min-h-48 overflow-y-auto rounded-md border border-input px-4 py-3">
            {contentMd.trim() === '' ? (
              <p className="text-sm text-muted-foreground">Nada que mostrar todavía.</p>
            ) : (
              <MarkdownView source={contentMd} />
            )}
          </div>
        ) : (
          <textarea
            id="section-content"
            aria-label="Documento en markdown"
            rows={14}
            maxLength={50000}
            spellCheck
            placeholder={'# Plan\n\n| Día | Paso |\n|---|---|\n| 1 | … |'}
            value={contentMd}
            onChange={(event) => setContentMd(event.target.value)}
            className={cn(
              'w-full min-w-0 resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground',
              'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
            )}
          />
        )}
        {fields.content_md !== undefined && (
          <p className="text-xs text-destructive">{fields.content_md}</p>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Guardando…' : section === undefined ? 'Crear sección' : 'Guardar cambios'}
        </Button>
      </DialogFooter>
    </form>
  );
}
