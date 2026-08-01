import { z } from 'zod';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Accepts either a number or the string a form field produces, rejecting blanks
 * and non-finite values. Empty input becomes null so optional money fields can
 * be left alone.
 */
const optionalAmount = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((value) => {
    if (value === null || value === undefined || value === '') return null;
    return Number(value);
  })
  .refine((value) => value === null || (Number.isFinite(value) && value > 0), {
    message: 'El monto debe ser mayor que cero',
  });

const requiredAmount = z
  .union([z.number(), z.string()])
  .transform((value) => Number(value))
  .refine((value) => Number.isFinite(value) && value > 0, {
    message: 'El monto debe ser mayor que cero',
  });

/**
 * A balance may legitimately be zero (an emptied account) or negative (debt on
 * a credit card), so it is only checked for being a finite number.
 */
const balanceAmount = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((value) => {
    if (value === null || value === undefined || value === '') return null;
    return Number(value);
  })
  .refine((value) => value === null || Number.isFinite(value), {
    message: 'El saldo debe ser un número',
  });

const optionalUuid = z
  .union([z.uuid(), z.literal('')])
  .nullish()
  .transform((value) => (value === '' || value === undefined ? null : value));

const localCurrency = z
  .union([z.enum(['VES', 'COP']), z.literal('')])
  .nullish()
  .transform((value) => (value === '' || value === undefined ? null : value));

/**
 * Shape of a transaction as submitted from the app.
 *
 * `fx_rate_local_usd` is deliberately absent: it is derived server-side from the
 * two amounts, so the two can never contradict each other.
 *
 * The refinements mirror the database check constraints exactly. Duplicating
 * them here buys a readable error instead of a Postgres violation.
 */
export const transactionInputSchema = z
  .object({
    occurred_on: z.string().regex(ISO_DATE, 'Fecha inválida'),
    direction: z.enum(['income', 'expense', 'transfer']),
    account_id: z.uuid('Selecciona una cuenta'),
    to_account_id: optionalUuid,
    category_id: optionalUuid,
    goal_id: optionalUuid,
    amount_usd: requiredAmount,
    amount_local: optionalAmount,
    local_currency: localCurrency,
    status: z.enum(['paid', 'pending']).default('paid'),
    tags: z.array(z.string().trim().min(1)).default([]),
    notes: z
      .string()
      .trim()
      .max(500)
      .nullish()
      .transform((value) => (value === '' || value === undefined ? null : value)),
  })
  .superRefine((value, ctx) => {
    if (value.direction === 'transfer') {
      if (value.to_account_id === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['to_account_id'],
          message: 'Un traslado necesita cuenta destino',
        });
      }
      if (value.category_id !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['category_id'],
          message: 'Un traslado no lleva categoría',
        });
      }
    } else {
      if (value.category_id === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['category_id'],
          message: 'Selecciona una categoría',
        });
      }
      if (value.to_account_id !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['to_account_id'],
          message: 'Solo los traslados llevan cuenta destino',
        });
      }
    }

    if (value.to_account_id !== null && value.to_account_id === value.account_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['to_account_id'],
        message: 'El origen y el destino no pueden ser la misma cuenta',
      });
    }

    if (value.amount_local !== null && value.local_currency === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['local_currency'],
        message: 'Indica en qué moneda pagaste',
      });
    }
    if (value.amount_local === null && value.local_currency !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['amount_local'],
        message: 'Indica el monto en esa moneda',
      });
    }
  });

export type TransactionInput = z.infer<typeof transactionInputSchema>;

/**
 * Budget for a category, plus how far forward it applies.
 *
 * `month` writes a one-off override into `budgets`; `forward` writes a standing
 * template effective from that month onwards. `period_month` is normalised to
 * the first day of the month, which is what the unique indexes expect.
 */
export const budgetInputSchema = z.object({
  category_id: z.uuid('Selecciona una categoría'),
  period_month: z
    .string()
    .regex(ISO_DATE, 'Periodo inválido')
    .transform((value) => `${value.slice(0, 7)}-01`),
  amount_usd: requiredAmount,
  scope: z.enum(['month', 'forward']).default('forward'),
});

export type BudgetInput = z.infer<typeof budgetInputSchema>;

/**
 * One account's declared balance.
 *
 * `balance_usd` is omitted when the account is held in another currency: the
 * server derives it from the local amount and rate so the two can never
 * disagree, exactly as it does for transactions.
 */
const accountBalanceEntrySchema = z
  .object({
    account_id: z.uuid('Cuenta inválida'),
    balance_usd: balanceAmount,
    balance_local: balanceAmount,
    local_currency: localCurrency,
    fx_rate_local_usd: optionalAmount,
  })
  .superRefine((value, ctx) => {
    const hasLocal =
      value.balance_local !== null ||
      value.local_currency !== null ||
      value.fx_rate_local_usd !== null;

    if (hasLocal) {
      if (value.balance_local === null) {
        ctx.addIssue({ code: 'custom', path: ['balance_local'], message: 'Falta el monto' });
      }
      if (value.local_currency === null) {
        ctx.addIssue({ code: 'custom', path: ['local_currency'], message: 'Falta la moneda' });
      }
      if (value.fx_rate_local_usd === null) {
        ctx.addIssue({ code: 'custom', path: ['fx_rate_local_usd'], message: 'Falta la tasa' });
      }
      if (value.balance_local !== null && value.balance_local < 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['balance_local'],
          message: 'El monto no puede ser negativo',
        });
      }
      return;
    }

    if (value.balance_usd === null) {
      ctx.addIssue({ code: 'custom', path: ['balance_usd'], message: 'Indica el saldo' });
    }
  });

/**
 * A round of balance declarations. Accounts left blank in the form are simply
 * absent from the array and keep their previous snapshot.
 *
 * `captured_on` is the day the declaration describes, sent by the browser in the
 * user's own timezone. The server cannot infer it: declaring at 8pm in Caracas
 * is already the next day in UTC, and every movement recorded after that date is
 * what gets added on top of the figure.
 */
export const accountBalancesInputSchema = z.object({
  entries: z.array(accountBalanceEntrySchema).min(1, 'Declara al menos una cuenta'),
  captured_on: z
    .string()
    .regex(ISO_DATE, 'Fecha inválida')
    .nullish()
    .transform((value) => (value === undefined ? null : value)),
  notes: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((value) => (value === '' || value === undefined ? null : value)),
});

export type AccountBalanceEntry = z.infer<typeof accountBalanceEntrySchema>;
export type AccountBalancesInput = z.infer<typeof accountBalancesInputSchema>;

/**
 * Where a goal's accumulated money currently sits. Sent as the complete split
 * for the goal: the server replaces the previous rows wholesale, so removing an
 * account is expressed by leaving it out.
 */
export const goalAllocationsInputSchema = z.object({
  allocations: z
    .array(
      z.object({
        account_id: z.uuid('Cuenta inválida'),
        amount_usd: requiredAmount,
      }),
    )
    .max(20),
});

export type GoalAllocationsInput = z.infer<typeof goalAllocationsInputSchema>;

/**
 * Savings goal. A goal without a target amount is allowed — it simply reports
 * how much has been set aside instead of a completion percentage.
 */
export const goalInputSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(80),
  target_amount_usd: optionalAmount,
  target_date: z
    .union([z.string().regex(ISO_DATE), z.literal('')])
    .nullish()
    .transform((value) => (value === '' || value === undefined ? null : value)),
  status: z.enum(['active', 'completed', 'abandoned']).default('active'),
  account_id: optionalUuid,
  notes: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((value) => (value === '' || value === undefined ? null : value)),
});

export type GoalInput = z.infer<typeof goalInputSchema>;
