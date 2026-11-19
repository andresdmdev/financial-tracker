import { useState } from 'react';
import { ChevronDownIcon, FileTextIcon, PlusIcon } from 'lucide-react';
import type { GoalSectionSummary } from '@/lib/queries/goal-sections';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import GoalSectionForm from '@/components/goals/GoalSectionForm';

interface Props {
  goalId: string;
  sections: GoalSectionSummary[];
  activeSectionId?: string;
  canEdit: boolean;
}

/**
 * Small floating menu listing a goal's work sections, each a link to its page
 * with the number of its open tasks. Sits beside the Resumen / Tareas tabs on
 * every goal page so any section is two taps away.
 *
 * The owner also gets "Nueva sección", which opens the section form in a
 * dialog and navigates to the new section once saved.
 */
export default function GoalSectionsMenu({
  goalId,
  sections,
  activeSectionId,
  canEdit,
}: Props): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const active = sections.find((section) => section.id === activeSectionId);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn('h-9 max-w-full gap-1.5', active !== undefined && 'border-primary/30 bg-primary/6')}
          >
            <FileTextIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{active?.title ?? 'Secciones'}</span>
            <ChevronDownIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          </Button>
        </PopoverTrigger>

        <PopoverContent align="start" className="w-72 p-1.5">
          <p className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">
            Secciones de la meta
          </p>

          {sections.length === 0 ? (
            <p className="px-2.5 py-2 text-sm text-muted-foreground">Sin secciones todavía.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {sections.map((section) => (
                <li key={section.id}>
                  <a
                    href={`/goals/${goalId}/sections/${section.id}`}
                    aria-current={section.id === activeSectionId ? 'page' : undefined}
                    className={cn(
                      'flex items-center justify-between gap-3 rounded-md px-2.5 py-2 text-sm transition-colors',
                      section.id === activeSectionId
                        ? 'bg-accent font-medium text-accent-foreground'
                        : 'hover:bg-muted',
                    )}
                  >
                    <span className="truncate">{section.title}</span>
                    {section.openTaskCount > 0 && (
                      <span className="tabular shrink-0 rounded-full bg-primary/12 px-1.5 text-xs text-primary">
                        {section.openTaskCount}
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          )}

          {canEdit && (
            <>
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setCreating(true);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-primary transition-colors hover:bg-primary/8"
              >
                <PlusIcon className="size-4" aria-hidden="true" />
                Nueva sección
              </button>
            </>
          )}
        </PopoverContent>
      </Popover>

      {canEdit && (
        <Dialog open={creating} onOpenChange={setCreating}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Nueva sección</DialogTitle>
              <DialogDescription>
                Un trabajo dentro de la meta, con su documento y sus propias tareas.
              </DialogDescription>
            </DialogHeader>
            <GoalSectionForm
              goalId={goalId}
              onCancel={() => setCreating(false)}
              onSaved={(id) => {
                window.location.href = `/goals/${goalId}/sections/${id}`;
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
