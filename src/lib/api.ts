import type { ZodType } from 'zod';

/**
 * JSON response helper so every API route answers in the same shape.
 */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/**
 * Error response carrying an optional per-field map the form can render inline.
 */
export function fail(
  message: string,
  status = 400,
  fields?: Record<string, string>,
): Response {
  return json({ error: message, fields }, status);
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; response: Response };

/**
 * Reads and validates a JSON body against a Zod schema, collapsing issues into
 * a field-keyed map so the client can highlight the offending inputs.
 */
export async function parseBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<ParseResult<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: fail('El cuerpo de la petición no es JSON válido') };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      fields[key] ??= issue.message;
    }
    return { ok: false, response: fail('Revisa los datos del formulario', 422, fields) };
  }

  return { ok: true, data: result.data };
}

/**
 * Maps a PostgREST error onto a response. Constraint violations are the user's
 * fault, not the server's, so they come back as 409 rather than 500.
 */
export function fromPostgrestError(error: { message: string; code?: string }): Response {
  const isConstraint = error.code?.startsWith('23') === true;
  return fail(error.message, isConstraint ? 409 : 500);
}
