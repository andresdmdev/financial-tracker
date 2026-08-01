import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface FieldOption {
  value: string;
  label: string;
}

interface FieldProps {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Label, control and validation message as one block, so every form in the app
 * spaces and announces its fields identically.
 *
 * An empty `label` renders no element at all rather than an empty one: in a
 * repeated row only the first line is labelled, and a zero-height placeholder
 * would still contribute its gap and knock the rows out of alignment.
 */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  className,
  children,
}: FieldProps): React.ReactElement {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label !== '' && (
        <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
          {label}
        </Label>
      )}
      {children}
      {error !== undefined && <p className="text-xs text-destructive">{error}</p>}
      {error === undefined && hint !== undefined && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  options: FieldOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Dropdown built on the Radix Select rather than a native `<select>`.
 *
 * The native element renders its options through the operating system, which
 * ignores the page's colours entirely — that is what made the old dropdowns
 * unreadable. This one is ordinary DOM, so it inherits the theme.
 *
 * An empty `value` is passed through rather than swapped for `undefined`:
 * Radix already reads `''` as "show the placeholder", and `undefined` would
 * start the select uncontrolled and flip it to controlled on the first pick.
 * No `SelectItem` may carry `''` — Radix reserves it and throws.
 */
export function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder = 'Selecciona…',
  error,
  hint,
  disabled = false,
  className,
}: SelectFieldProps): React.ReactElement {
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger
          className={cn('w-full', error !== undefined && 'border-destructive')}
          aria-invalid={error !== undefined}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
