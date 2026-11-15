import type { APIRoute } from 'astro';
import { fail } from '@/lib/api';
import { getExchangeRates } from '@/lib/exchange-rates';

/**
 * Returns the BCV and Binance bolivar rates for the dashboard.
 *
 * It is a proxy, not a store: the sources block browser requests, so the
 * island asks here and this route asks them. The cache is private because the
 * route sits behind the session, and short because the client sets the pace.
 * Only a total failure is an error; a partial answer is still useful.
 */
export const GET: APIRoute = async ({ locals }) => {
  if (locals.user === null) return fail('No autenticado', 401);

  const rates = await getExchangeRates();
  const empty = rates.bcvUsd === null && rates.bcvEur === null && rates.binanceUsdt === null;
  if (empty) return fail('No se pudieron obtener las tasas', 502);

  return new Response(JSON.stringify(rates), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, max-age=300',
    },
  });
};
