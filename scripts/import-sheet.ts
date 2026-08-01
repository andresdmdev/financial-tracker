/**
 * One-time migration of the Google Sheets workbook into Supabase.
 *
 * Run `--dry-run` first: it parses everything, prints a reconciliation summary
 * and lists every row it could not map, without touching the database.
 *
 *   node --env-file=.env scripts/import-sheet.ts --dry-run
 *   node --env-file=.env scripts/import-sheet.ts
 *
 * The import is idempotent. Each row carries a `source_row_hash` derived from
 * its raw values, and the unique index on (user_id, source_row_hash) turns a
 * second run into a no-op instead of a duplicate.
 *
 * This is the only place the service-role key is used, because it must resolve
 * the admin user id through the auth admin API.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parse } from 'csv-parse/sync';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  Database,
  LocalCurrency,
  TxDirection,
  TxStatus,
} from '../src/lib/database.types.ts';

interface SheetRow {
  DATE: string;
  CATEGORY: string;
  MEDIUM: string;
  AMOUNT: string;
  'AMOUNT $': string;
  STATUS: string;
  NOTES: string;
}

interface MappedTransaction {
  line: number;
  occurred_on: string;
  direction: TxDirection;
  category_name: string | null;
  account_name: string;
  to_account_name: string | null;
  amount_usd: number;
  amount_local: number | null;
  local_currency: LocalCurrency | null;
  fx_rate_local_usd: number | null;
  status: TxStatus;
  goal_name: string | null;
  tags: string[];
  notes: string | null;
  source_row_hash: string;
}

interface RejectedRow {
  line: number;
  reason: string;
  raw: SheetRow;
}

/** A row that declares an account balance rather than a movement of money. */
interface OpeningBalance {
  account_name: string;
  amount_usd: number;
  notes: string | null;
}

const SAVINGS_ACCOUNT_NAME = 'Ahorros';
const FALLBACK_CATEGORY_NAME = 'Otros';
const FALLBACK_ACCOUNT_NAME = 'Cash';
const ANT_TAG = 'gastos-hormiga';
const FX_REVIEW_TAG = 'fx-revisar';
const ACCOUNT_REVIEW_TAG = 'revisar-cuenta';

const MONTHS: Record<string, number> = {
  ene: 1, enero: 1,
  feb: 2, febrero: 2,
  mar: 3, marzo: 3,
  abr: 4, abril: 4,
  may: 5, mayo: 5,
  jun: 6, junio: 6,
  jul: 7, julio: 7,
  ago: 8, agosto: 8,
  sep: 9, sept: 9, septiembre: 9,
  oct: 10, octubre: 10,
  nov: 11, noviembre: 11,
  dic: 12, diciembre: 12,
};

/**
 * Spreadsheet categories that are contributions to a savings goal. These become
 * transfers into the savings account, never expenses.
 */
const GOAL_CATEGORIES: Record<string, string> = {
  macbook: 'Macbook',
  carro: 'Carro',
  moto: 'Moto',
  apartamento: 'Apartamento',
};

/** Spreadsheet categories that represent money coming in. Salary is the only one. */
const INCOME_CATEGORIES: Record<string, string> = {
  sueldo: 'Sueldo',
};

/**
 * Spreadsheet categories that map straight onto an expense category.
 *
 * `up` is the university (matrícula, mensualidad, arancel) and `inversion` is
 * money spent on ads, stock and travel. Both were misclassified in the original
 * sheet: the first as savings, the second as income.
 */
const EXPENSE_CATEGORIES: Record<string, string> = {
  comida: 'Comida',
  'comida / proteina': 'Proteína',
  'comida / proteína': 'Proteína',
  proteína: 'Proteína',
  proteina: 'Proteína',
  transporte: 'Transporte',
  ropa: 'Ropa',
  tecnología: 'Tecnología',
  tecnologia: 'Tecnología',
  vivienda: 'Vivienda',
  educación: 'Educación',
  educacion: 'Educación',
  deuda: 'Deuda',
  up: 'Educación',
  inversion: 'Inversión',
  inversión: 'Inversión',
  salud: 'Salud',
};

/** Spreadsheet MEDIUM values mapped to seeded account names. */
const ACCOUNTS: Record<string, string> = {
  'credit card': 'Credit Card',
  debit: 'Debit',
  deel: 'Deel',
  binance: 'Binance',
  cash: 'Cash',
};

/**
 * Keywords used to recover a real category for `Gastos Hormiga` rows, which are
 * a quarter of the workbook. The tag is applied regardless, so the behavioural
 * total stays exact even where the guess is wrong.
 */
const ANT_KEYWORDS: [RegExp, string][] = [
  [/hamburgues|pastel|pizza|helado|caf[eé]|refresco|dulce|comida|empanada|arepa|pan |merienda|almuerzo|cena|desayuno|chocolat|galleta|snack|hot ?dog|perro caliente|shawarma|sushi|pollo|antojo|bebida|cerveza|jugo|malta|chucher|verdura|focaccia|pasticho|delivery|fruta|carne|queso|torta|postre/i, 'Comida'],
  [/pastilla|electrolito|farmacia|medicina|medicamento|antibiotic|consulta|doctor|m[eé]dic|odontolog|hematolog|enfermer|laboratorio|salud|gym|gimnasio|caminadora|voleibol|deporte/i, 'Salud'],
  [/taxi|uber|pasaje|gasolina|transporte|didi|indriver|\bbus\b|metro|flete|moto ?taxi|\bmoto\b|choque|caucho|repuesto|mec[aá]nic/i, 'Transporte'],
  [/sweater|ropa|zapato|chancleta|camisa|pantal[oó]n|gorra|medias|franela|short|vestido|su[eé]ter|prenda/i, 'Ropa'],
  [/mousepad|power ?bank|pendrive|nintendo|mario|resident evil|switch|playstation|xbox|teclado|mouse|cargador|audifono|auricular|laptop|celular|monitor/i, 'Tecnología'],
  [/recarga|abono tel[eé]fono|plan de la|servicio|luz|agua|internet|condominio|alquiler/i, 'Vivienda'],
];

/**
 * Plausible bands for the derived `local / usd` ratio, used to tell which
 * currency an original amount was really in.
 *
 * The spreadsheet's currency prefix is unreliable: bolivares appear under `$`
 * and dollars appear under `Bs`. The magnitude of the ratio is the only honest
 * signal, so detection runs on that and anything outside the bands is dropped
 * rather than guessed.
 */
const FX_BANDS: { currency: LocalCurrency; min: number; max: number }[] = [
  { currency: 'VES', min: 50, max: 200 },
  { currency: 'COP', min: 3500, max: 4500 },
];

/** Ratios this close to 1 mean the local column is just the USD amount again. */
const SAME_CURRENCY_TOLERANCE = 0.02;

/**
 * Normalises a spreadsheet cell for lookup: trims, lowercases and collapses
 * internal whitespace so "Credit  Card " and "credit card" match.
 */
function key(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Builds an ISO date string, returning null when the calendar rejects the day.
 * The UTC round-trip is what catches impossible dates such as `31 nov 2025`.
 */
function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Parses every date notation the workbook actually contains.
 *
 * Three shapes coexist because rows were entered by hand over more than a year:
 * `21 mar 2025`, `26/03/2025` (day first) and the spreadsheet's own serialised
 * `2025-03-29 18:20:49`. The time component is discarded: the model stores a
 * date, and the hour of a purchase carries no meaning here.
 */
function parseSheetDate(value: string): string | null {
  const raw = key(value);

  const spanish = raw.match(/^(\d{1,2})[\s.-]+([a-záéíóúñ]+)\.?[\s.-]+(\d{4})$/);
  if (spanish !== null) {
    const month = MONTHS[spanish[2]!];
    if (month === undefined) return null;
    return isoDate(Number(spanish[3]), month, Number(spanish[1]));
  }

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[\st](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (iso !== null) {
    return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const slashed = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashed !== null) {
    return isoDate(Number(slashed[3]), Number(slashed[2]), Number(slashed[1]));
  }

  return null;
}

/**
 * Parses a monetary cell, tolerating currency symbols and both the `1,234.56`
 * and `1.234,56` conventions. The separator nearest the end wins when it is
 * followed by one or two digits; otherwise every separator is a thousands mark.
 * Returns null for blank cells and NaN-producing input.
 */
function parseAmount(value: string): number | null {
  const cleaned = value.replace(/[^\d.,-]/g, '').trim();
  if (cleaned === '' || cleaned === '-') return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  const lastSeparator = Math.max(lastComma, lastDot);

  let normalised: string;
  if (lastSeparator === -1) {
    normalised = cleaned;
  } else {
    const decimals = cleaned.length - lastSeparator - 1;
    if (decimals >= 1 && decimals <= 2) {
      normalised =
        cleaned.slice(0, lastSeparator).replace(/[.,]/g, '') +
        '.' +
        cleaned.slice(lastSeparator + 1);
    } else {
      normalised = cleaned.replace(/[.,]/g, '');
    }
  }

  const parsed = Number(normalised);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Decides which currency an original amount was paid in from the ratio it forms
 * against the USD amount. Returns the currency, `same` when the local column is
 * a duplicate of the USD one, or `unknown` when no band fits.
 */
function detectLocalCurrency(
  amountLocal: number,
  amountUsd: number,
): LocalCurrency | 'same' | 'unknown' {
  const ratio = amountLocal / amountUsd;
  if (Math.abs(ratio - 1) <= SAME_CURRENCY_TOLERANCE) return 'same';

  const band = FX_BANDS.find((candidate) => ratio >= candidate.min && ratio <= candidate.max);
  return band === undefined ? 'unknown' : band.currency;
}

/**
 * Recovers a real expense category for a `Gastos Hormiga` row from its note,
 * falling back to `Otros` when the note says nothing usable.
 */
function inferAntCategory(notes: string | null): string {
  if (notes === null) return FALLBACK_CATEGORY_NAME;

  const match = ANT_KEYWORDS.find(([pattern]) => pattern.test(notes));
  return match === undefined ? FALLBACK_CATEGORY_NAME : match[1];
}

/**
 * Derives the stable identity of a spreadsheet row. `occurrence` disambiguates
 * genuinely identical rows so two coffees on the same day both survive.
 */
function rowHash(row: SheetRow, occurrence: number): string {
  const payload = [
    row.DATE,
    row.CATEGORY,
    row.MEDIUM,
    row.AMOUNT,
    row['AMOUNT $'],
    row.STATUS,
    row.NOTES,
    String(occurrence),
  ]
    .map((field) => (field ?? '').trim())
    .join('');

  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Translates one spreadsheet row into the new model, or explains why it cannot
 * be translated. `opening-balance` marks the rows that declare a balance rather
 * than a movement, which the caller diverts away from `transactions`.
 */
function mapRow(
  row: SheetRow,
  occurrence: number,
  line: number,
): MappedTransaction | OpeningBalance | string {
  const occurredOn = parseSheetDate(row.DATE ?? '');
  if (occurredOn === null) return `fecha no reconocida: "${row.DATE}"`;

  const amountUsd = parseAmount(row['AMOUNT $'] ?? '');
  if (amountUsd === null) return 'AMOUNT $ vacío o ilegible';
  if (amountUsd <= 0) return `AMOUNT $ no positivo: ${amountUsd}`;

  const statusKey = key(row.STATUS ?? 'paid');
  const status: TxStatus | null =
    statusKey === 'paid' ? 'paid' : statusKey === 'pending' ? 'pending' : null;
  if (status === null) return `STATUS no reconocido: "${row.STATUS}"`;

  const categoryKey = key(row.CATEGORY ?? '');
  const notes = (row.NOTES ?? '').trim() || null;
  const tags: string[] = [];

  const mediumKey = key(row.MEDIUM ?? '');
  let accountName: string;
  if (mediumKey === '') {
    accountName = FALLBACK_ACCOUNT_NAME;
    tags.push(ACCOUNT_REVIEW_TAG);
  } else {
    const resolved = ACCOUNTS[mediumKey];
    if (resolved === undefined) return `MEDIUM no reconocido: "${row.MEDIUM}"`;
    accountName = resolved;
  }

  if (categoryKey === 'ahorro') {
    return { account_name: accountName, amount_usd: Number(amountUsd.toFixed(2)), notes };
  }

  const amountLocalRaw = parseAmount(row.AMOUNT ?? '');
  if (amountLocalRaw !== null && amountLocalRaw <= 0) {
    return `AMOUNT no positivo: ${amountLocalRaw}`;
  }

  let amountLocal: number | null = null;
  let localCurrency: LocalCurrency | null = null;
  if (amountLocalRaw !== null) {
    const detected = detectLocalCurrency(amountLocalRaw, amountUsd);
    if (detected === 'unknown') {
      tags.push(FX_REVIEW_TAG);
    } else if (detected !== 'same') {
      amountLocal = Number(amountLocalRaw.toFixed(2));
      localCurrency = detected;
    }
  }

  let direction: TxDirection;
  let categoryName: string | null;
  let toAccountName: string | null = null;
  let goalName: string | null = null;

  if (categoryKey in GOAL_CATEGORIES) {
    direction = 'transfer';
    categoryName = null;
    toAccountName = SAVINGS_ACCOUNT_NAME;
    goalName = GOAL_CATEGORIES[categoryKey]!;
    if (accountName === SAVINGS_ACCOUNT_NAME) {
      return 'traslado con origen y destino iguales';
    }
  } else if (categoryKey in INCOME_CATEGORIES) {
    direction = 'income';
    categoryName = INCOME_CATEGORIES[categoryKey]!;
  } else if (categoryKey === 'gastos hormiga') {
    direction = 'expense';
    categoryName = inferAntCategory(notes);
    tags.push(ANT_TAG);
  } else if (categoryKey in EXPENSE_CATEGORIES) {
    direction = 'expense';
    categoryName = EXPENSE_CATEGORIES[categoryKey]!;
  } else {
    return `CATEGORY no reconocida: "${row.CATEGORY}"`;
  }

  return {
    line,
    occurred_on: occurredOn,
    direction,
    category_name: categoryName,
    account_name: accountName,
    to_account_name: toAccountName,
    amount_usd: Number(amountUsd.toFixed(2)),
    amount_local: amountLocal,
    local_currency: localCurrency,
    fx_rate_local_usd:
      amountLocal === null ? null : Number((amountLocal / amountUsd).toFixed(6)),
    status,
    goal_name: goalName,
    tags,
    notes,
    source_row_hash: rowHash(row, occurrence),
  };
}

/**
 * Resolves the admin user id from the email in ADMIN_EMAIL. The import must be
 * attributed to a real user because every row is scoped by user_id under RLS.
 */
async function resolveAdminUserId(
  supabase: SupabaseClient<Database>,
  adminEmail: string,
): Promise<string> {
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 200 });
  if (error !== null) throw new Error(`No se pudo listar usuarios: ${error.message}`);

  const user = data.users.find((candidate) => candidate.email?.toLowerCase() === adminEmail);
  if (user === undefined) {
    throw new Error(
      `No existe un usuario con email ${adminEmail}. Inicia sesión una vez en la app antes de importar.`,
    );
  }
  return user.id;
}

/**
 * Loads the seeded lookup tables and returns name-to-id maps, lowercased so the
 * spreadsheet's inconsistent casing does not matter.
 */
async function loadLookups(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{
  accounts: Map<string, string>;
  categories: Map<string, string>;
  goals: Map<string, string>;
}> {
  const [accounts, categories, goals] = await Promise.all([
    supabase.from('accounts').select('id, name').eq('user_id', userId),
    supabase.from('categories').select('id, name').eq('user_id', userId),
    supabase.from('savings_goals').select('id, name').eq('user_id', userId),
  ]);

  for (const result of [accounts, categories, goals]) {
    if (result.error !== null) {
      throw new Error(`No se pudieron leer los catálogos: ${result.error.message}`);
    }
  }

  const toMap = (rows: { id: string; name: string }[]): Map<string, string> =>
    new Map(rows.map((row) => [key(row.name), row.id]));

  return {
    accounts: toMap(accounts.data ?? []),
    categories: toMap(categories.data ?? []),
    goals: toMap(goals.data ?? []),
  };
}

/**
 * Formats a USD total for the reconciliation report.
 */
function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * Sums the USD amount of a subset of mapped transactions.
 */
function sumUsd(items: MappedTransaction[]): number {
  return items.reduce((total, item) => total + item.amount_usd, 0);
}

/**
 * Prints everything the operator has to eyeball before the write happens: the
 * reconciliation against the raw CSV, the inferred ant categories, the rows
 * whose exchange rate made no sense, and the dates that look like typos.
 */
function report(
  filePath: string,
  rows: SheetRow[],
  mapped: MappedTransaction[],
  balances: OpeningBalance[],
  rejected: RejectedRow[],
  verbose: boolean,
): void {
  const income = mapped.filter((item) => item.direction === 'income');
  const expense = mapped.filter((item) => item.direction === 'expense');
  const transfer = mapped.filter((item) => item.direction === 'transfer');
  const csvTotal = rows.reduce((sum, row) => sum + (parseAmount(row['AMOUNT $'] ?? '') ?? 0), 0);
  const balanceTotal = balances.reduce((sum, item) => sum + item.amount_usd, 0);

  console.log(`\nArchivo:            ${filePath}`);
  console.log(`Filas leídas:       ${rows.length}`);
  console.log(`Transacciones:      ${mapped.length}`);
  console.log(`Saldos iniciales:   ${balances.length}`);
  console.log(`Rechazadas:         ${rejected.length}`);
  console.log(`  ingresos:         ${usd(sumUsd(income))}  (${income.length})`);
  console.log(`  gastos:           ${usd(sumUsd(expense))}  (${expense.length})`);
  console.log(`  traslados:        ${usd(sumUsd(transfer))}  (${transfer.length})`);
  console.log(`  saldos iniciales: ${usd(balanceTotal)}`);
  console.log(`Suma AMOUNT $ CSV:  ${usd(csvTotal)}`);
  console.log(`Suma reconciliada:  ${usd(sumUsd(mapped) + balanceTotal)}`);

  if (balances.length > 0) {
    console.log('\nSaldos iniciales (no entran como transacciones):');
    for (const balance of balances) {
      console.log(`  ${balance.account_name.padEnd(14)} ${usd(balance.amount_usd).padStart(12)}  ${balance.notes ?? ''}`);
    }
  }

  const withLocal = mapped.filter((item) => item.local_currency !== null);
  const byCurrency = new Map<string, number>();
  for (const item of withLocal) {
    byCurrency.set(item.local_currency!, (byCurrency.get(item.local_currency!) ?? 0) + 1);
  }
  if (byCurrency.size > 0) {
    console.log('\nMontos originales detectados:');
    for (const [currency, count] of byCurrency) console.log(`  ${currency}: ${count} fila(s)`);
  }

  const fxReview = mapped.filter((item) => item.tags.includes(FX_REVIEW_TAG));
  if (fxReview.length > 0) {
    console.log(
      `\n${fxReview.length} fila(s) con tasa fuera de rango: se importan solo en USD y llevan el tag ${FX_REVIEW_TAG}.`,
    );
    for (const item of fxReview) {
      const raw = rows[item.line - 2]!;
      const ratio = (parseAmount(raw.AMOUNT) ?? 0) / item.amount_usd;
      console.log(
        `  línea ${String(item.line).padStart(4)}  ${item.occurred_on}  local=${raw.AMOUNT.padStart(15)}  usd=${usd(item.amount_usd).padStart(10)}  tasa=${ratio.toFixed(2).padStart(10)}  ${item.notes ?? ''}`,
      );
    }
  }

  const ants = mapped.filter((item) => item.tags.includes(ANT_TAG));
  if (ants.length > 0) {
    const counts = new Map<string, number>();
    for (const item of ants) {
      counts.set(item.category_name!, (counts.get(item.category_name!) ?? 0) + 1);
    }
    console.log(`\n${ants.length} fila(s) de "Gastos Hormiga", categoría inferida de la nota:`);
    for (const [category, count] of [...counts].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${category.padEnd(12)} ${count}`);
    }
    console.log(`  Todas llevan el tag ${ANT_TAG}, así que el total real no depende de la inferencia.`);

    if (verbose) {
      console.log('\n  Detalle fila por fila:');
      for (const item of ants) {
        console.log(
          `    línea ${String(item.line).padStart(4)}  ${item.occurred_on}  ${item.category_name!.padEnd(12)} ${usd(item.amount_usd).padStart(10)}  ${item.notes ?? '(sin nota)'}`,
        );
      }
    } else {
      console.log('  Usa --verbose para ver las 116 filas una por una antes de importar.');
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const future = mapped.filter((item) => item.occurred_on > today);
  if (future.length > 0) {
    console.log(`\n${future.length} fila(s) con fecha futura (¿typo de año?):`);
    for (const item of future) {
      console.log(`  línea ${item.line}: ${item.occurred_on}  ${usd(item.amount_usd)}  ${item.notes ?? ''}`);
    }
  }

  const pending = mapped.filter((item) => item.status === 'pending');
  if (pending.length > 0) {
    console.log(`\n${pending.length} fila(s) pendientes de pago:`);
    for (const item of pending) {
      console.log(`  línea ${item.line}: ${item.occurred_on}  ${usd(item.amount_usd)}  ${item.notes ?? ''}`);
    }
  }

  const flagged = mapped.filter((item) => item.tags.includes(ACCOUNT_REVIEW_TAG));
  if (flagged.length > 0) {
    console.log(
      `\n${flagged.length} fila(s) sin MEDIUM: van a ${FALLBACK_ACCOUNT_NAME} con el tag ${ACCOUNT_REVIEW_TAG}.`,
    );
  }

  if (rejected.length > 0) {
    console.log('\nFilas rechazadas:');
    for (const item of rejected) console.log(`  línea ${item.line}: ${item.reason}`);
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
      file: { type: 'string', default: 'data/Invoices.csv' },
    },
  });

  const dryRun = values['dry-run'] === true;
  const verbose = values.verbose === true;
  const filePath = values.file!;

  const rows = parse(readFileSync(filePath, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as SheetRow[];

  const seen = new Map<string, number>();
  const mapped: MappedTransaction[] = [];
  const balances: OpeningBalance[] = [];
  const rejected: RejectedRow[] = [];

  rows.forEach((row, index) => {
    const identity = [row.DATE, row.CATEGORY, row.MEDIUM, row['AMOUNT $'], row.NOTES].join('|');
    const occurrence = (seen.get(identity) ?? 0) + 1;
    seen.set(identity, occurrence);

    const result = mapRow(row, occurrence, index + 2);
    if (typeof result === 'string') {
      rejected.push({ line: index + 2, reason: result, raw: row });
    } else if ('occurred_on' in result) {
      mapped.push(result);
    } else {
      balances.push(result);
    }
  });

  report(filePath, rows, mapped, balances, rejected, verbose);

  if (dryRun) {
    console.log('\nDry run: no se escribió nada.');
    return;
  }

  if (rejected.length > 0) {
    console.error(
      '\nHay filas rechazadas. Corrígelas en el CSV o ajusta los diccionarios del script antes de importar.',
    );
    process.exitCode = 1;
    return;
  }

  const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!supabaseUrl || !serviceRoleKey || !adminEmail) {
    throw new Error(
      'Faltan PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o ADMIN_EMAIL. Ejecuta con --env-file=.env',
    );
  }

  const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const userId = await resolveAdminUserId(supabase, adminEmail);
  const lookups = await loadLookups(supabase, userId);

  const payload = mapped.map((transaction) => {
    const accountId = lookups.accounts.get(key(transaction.account_name));
    if (accountId === undefined) {
      throw new Error(`Falta la cuenta "${transaction.account_name}" en la base de datos.`);
    }

    const toAccountId =
      transaction.to_account_name === null
        ? null
        : (lookups.accounts.get(key(transaction.to_account_name)) ?? null);
    if (transaction.to_account_name !== null && toAccountId === null) {
      throw new Error(`Falta la cuenta "${transaction.to_account_name}" en la base de datos.`);
    }

    const categoryId =
      transaction.category_name === null
        ? null
        : (lookups.categories.get(key(transaction.category_name)) ?? null);
    if (transaction.category_name !== null && categoryId === null) {
      throw new Error(`Falta la categoría "${transaction.category_name}" en la base de datos.`);
    }

    const goalId =
      transaction.goal_name === null
        ? null
        : (lookups.goals.get(key(transaction.goal_name)) ?? null);
    if (transaction.goal_name !== null && goalId === null) {
      throw new Error(`Falta la meta "${transaction.goal_name}" en la base de datos.`);
    }

    return {
      user_id: userId,
      occurred_on: transaction.occurred_on,
      direction: transaction.direction,
      category_id: categoryId,
      account_id: accountId,
      to_account_id: toAccountId,
      amount_usd: transaction.amount_usd,
      amount_local: transaction.amount_local,
      local_currency: transaction.local_currency,
      fx_rate_local_usd: transaction.fx_rate_local_usd,
      status: transaction.status,
      goal_id: goalId,
      tags: transaction.tags,
      notes: transaction.notes,
      source: 'sheets-import',
      source_row_hash: transaction.source_row_hash,
    };
  });

  const BATCH_SIZE = 500;
  let inserted = 0;

  for (let offset = 0; offset < payload.length; offset += BATCH_SIZE) {
    const batch = payload.slice(offset, offset + BATCH_SIZE);
    const { data, error } = await supabase
      .from('transactions')
      .upsert(batch, { onConflict: 'user_id,source_row_hash', ignoreDuplicates: true })
      .select('id');

    if (error !== null) {
      throw new Error(`Fallo insertando el lote ${offset / BATCH_SIZE + 1}: ${error.message}`);
    }
    inserted += data?.length ?? 0;
  }

  console.log(`\nInsertadas ${inserted} transacciones nuevas de ${payload.length} mapeadas.`);

  const byAccount = new Map<string, number>();
  for (const balance of balances) {
    byAccount.set(
      balance.account_name,
      (byAccount.get(balance.account_name) ?? 0) + balance.amount_usd,
    );
  }

  for (const [accountName, amount] of byAccount) {
    const accountId = lookups.accounts.get(key(accountName));
    if (accountId === undefined) {
      throw new Error(`Falta la cuenta "${accountName}" para el saldo inicial.`);
    }

    const { error } = await supabase
      .from('accounts')
      .update({ opening_balance_usd: Number(amount.toFixed(2)) })
      .eq('id', accountId)
      .eq('user_id', userId);

    if (error !== null) {
      throw new Error(`Fallo escribiendo el saldo inicial de ${accountName}: ${error.message}`);
    }
    console.log(`Saldo inicial de ${accountName}: ${usd(amount)}`);
  }

  console.log('Volver a ejecutar no duplica: las repetidas se ignoran por source_row_hash.');
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
