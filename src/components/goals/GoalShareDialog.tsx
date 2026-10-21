import { useState, type SyntheticEvent } from 'react';
import type { Lookups } from '@/lib/queries/transactions';
import type { GoalShare } from '@/lib/queries/goals';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, SelectField, type FieldOption } from '@/components/forms/Field';
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
  categories: Lookups['categories'];
  shares: GoalShare[];
}

interface FormState {
  member_email: string;
  member_name: string;
  expense_category_id: string;
  income_category_id: string;
}

const EMPTY_FORM: FormState = {
  member_email: '',
  member_name: '',
  expense_category_id: '',
  income_category_id: '',
};

/**
 * Lists the guests a goal is shared with and grants or revokes access.
 *
 * The categories chosen here are stamped on every movement the guest records;
 * the guest never sees the owner's catalogue. Granting access does not create
 * the guest's login: signups are disabled, so the user must already exist in
 * Supabase Auth with the same email, and the dialog says so.
 */
export default function GoalShareDialog({
  goalId,
  categories,
  shares,
}: Props): React.ReactElement {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const categoryOptions = (kind: 'income' | 'expense'): FieldOption[] =>
    categories
      .filter((category) => category.kind === kind)
      .map((category) => ({
        value: category.id,
        label:
          category.parentName === null
            ? category.name
            : `${category.parentName} · ${category.name}`,
      }));

  const update = <K extends keyof FormState>(field: K, value: FormState[K]): void => {
    setForm((previous) => ({ ...previous, [field]: value }));
  };

  const submit = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setFieldErrors({});

    const response = await fetch(`/api/goals/${goalId}/shares`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        fields?: Record<string, string>;
      } | null;
      setError(body?.error ?? 'No se pudo compartir la meta');
      setFieldErrors(body?.fields ?? {});
      setSaving(false);
      return;
    }

    window.location.reload();
  };

  const revoke = async (shareId: string): Promise<void> => {
    setRevokingId(shareId);
    setError(null);

    const response = await fetch(`/api/goals/${goalId}/shares/${shareId}`, { method: 'DELETE' });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'No se pudo quitar el acceso');
      setRevokingId(null);
      return;
    }

    window.location.reload();
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Compartir{shares.length > 0 && ` (${shares.length})`}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Compartir meta</DialogTitle>
          <DialogDescription>
            El invitado ve el progreso y los movimientos de esta meta y puede registrar gastos o
            ingresos. No puede editar, borrar ni ver tus cuentas.
          </DialogDescription>
        </DialogHeader>

        {error !== null && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {shares.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {shares.map((share) => (
              <li key={share.id} className="flex items-start justify-between gap-3 p-3 text-sm">
                <div className="min-w-0">
                  <span className="block font-medium">{share.memberName}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {share.memberEmail}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {share.accountName} · Gasto: {share.expenseCategoryName} · Ingreso:{' '}
                    {share.incomeCategoryName}
                  </span>
                </div>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      Quitar
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Quitar el acceso de {share.memberName}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Deja de poder abrir esta meta. Los movimientos que registró y la cuenta «
                        {share.accountName}» se conservan.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        disabled={revokingId === share.id}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={(event) => {
                          event.preventDefault();
                          void revoke(share.id);
                        }}
                      >
                        {revokingId === share.id ? 'Quitando…' : 'Quitar acceso'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Email"
              htmlFor="member_email"
              error={fieldErrors['member_email']}
              hint="Debe existir como usuario en Supabase Auth"
            >
              <Input
                id="member_email"
                type="email"
                required
                value={form.member_email}
                onChange={(event) => update('member_email', event.target.value)}
              />
            </Field>

            <Field
              label="Nombre"
              htmlFor="member_name"
              error={fieldErrors['member_name']}
              hint="Aparece como autor de sus movimientos"
            >
              <Input
                id="member_name"
                type="text"
                required
                maxLength={80}
                value={form.member_name}
                onChange={(event) => update('member_name', event.target.value)}
              />
            </Field>

            <SelectField
              label="Categoría de sus gastos"
              value={form.expense_category_id}
              options={categoryOptions('expense')}
              onChange={(value) => update('expense_category_id', value)}
              error={fieldErrors['expense_category_id']}
            />

            <SelectField
              label="Categoría de sus ingresos"
              value={form.income_category_id}
              options={categoryOptions('income')}
              onChange={(value) => update('income_category_id', value)}
              error={fieldErrors['income_category_id']}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Sus movimientos se cargan a la cuenta «En manos de {form.member_name.trim() || '…'}»,
            que se crea si no existe. Declara su saldo como el de cualquier otra cuenta.
          </p>

          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving ? 'Compartiendo…' : 'Compartir'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
