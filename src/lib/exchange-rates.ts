import { get } from 'node:https';
import { rootCertificates } from 'node:tls';
import { z } from 'zod';
import { BCV_INTERMEDIATE_PEM } from '@/lib/bcv-ca';

/**
 * Server-side retrieval of the bolivar exchange rates shown on the dashboard.
 *
 * Neither the BCV site nor the Binance P2P endpoint sends CORS headers, so the
 * browser cannot call them directly; an API route calls this module instead.
 * Each source is fetched independently and a failure in one leaves its fields
 * null without hiding the other.
 */

/** Rates in bolivares per unit of foreign currency, plus when they were read. */
export type ExchangeRates = {
  bcvUsd: number | null;
  bcvEur: number | null;
  bcvValueDate: string | null;
  binanceUsdt: number | null;
  fetchedAt: string;
};

const BCV_URL = 'https://www.bcv.org.ve/';
const BINANCE_P2P_URL = 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';
const TIMEOUT_MS = 8000;
const BINANCE_SAMPLE = 5;

const binanceResponseSchema = z.object({
  data: z.array(z.object({ adv: z.object({ price: z.string() }) })),
});

type BcvRates = Pick<ExchangeRates, 'bcvUsd' | 'bcvEur' | 'bcvValueDate'>;

/**
 * Parses a number written in Venezuelan notation (`1.010,56078251`), returning
 * null for anything that does not yield a positive finite value.
 */
function parseVesNumber(raw: string): number | null {
  const value = Number(raw.trim().replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Extracts the rate inside the BCV block with the given element id (`dolar`,
 * `euro`). The figure is the first `strong-tb` after the block opens.
 */
function extractBcvRate(html: string, id: string): number | null {
  const match = html.match(
    new RegExp(`id="${id}"[\\s\\S]*?<strong[^>]*class="strong-tb"[^>]*>([^<]+)</strong>`),
  );
  return match === null ? null : parseVesNumber(match[1]!);
}

/**
 * Downloads the BCV home page over `node:https` rather than `fetch`, because
 * only the former accepts extra CAs: the site serves an incomplete chain that
 * `BCV_INTERMEDIATE_PEM` completes. Verification is never turned off.
 */
function getBcvHtml(): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = get(
      BCV_URL,
      { ca: [...rootCertificates, BCV_INTERMEDIATE_PEM], timeout: TIMEOUT_MS },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`BCV respondió ${response.statusCode}`));
          return;
        }
        response.setEncoding('utf8');
        let body = '';
        response.on('data', (chunk: string) => (body += chunk));
        response.on('end', () => resolve(body));
        response.on('error', reject);
      },
    );
    request.on('timeout', () => request.destroy(new Error('BCV no respondió a tiempo')));
    request.on('error', reject);
  });
}

/**
 * Reads the official USD and EUR rates and their value date from the BCV home
 * page. The value date is the day the rate applies to, often a future business
 * day, and is returned as `YYYY-MM-DD`.
 */
export async function fetchBcvRates(): Promise<BcvRates> {
  const html = await getBcvHtml();

  const date = html.match(/property="dc:date"[^>]*content="(\d{4}-\d{2}-\d{2})/);
  return {
    bcvUsd: extractBcvRate(html, 'dolar'),
    bcvEur: extractBcvRate(html, 'euro'),
    bcvValueDate: date === null ? null : date[1]!,
  };
}

/**
 * Averages the top Binance P2P adverts for buying USDT with bolivares. A single
 * advert is easily an outlier; the mean of the first few is what a buyer would
 * realistically pay.
 */
export async function fetchBinanceUsdt(): Promise<number | null> {
  const response = await fetch(BINANCE_P2P_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      asset: 'USDT',
      fiat: 'VES',
      tradeType: 'BUY',
      page: 1,
      rows: BINANCE_SAMPLE,
      payTypes: [],
      publisherType: null,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Binance respondió ${response.status}`);

  const parsed = binanceResponseSchema.parse(await response.json());
  const prices = parsed.data
    .map((entry) => Number(entry.adv.price))
    .filter((price) => Number.isFinite(price) && price > 0);

  if (prices.length === 0) return null;
  return prices.reduce((sum, price) => sum + price, 0) / prices.length;
}

/**
 * Fetches every source in parallel. A rejected source is logged and reported as
 * null so the dashboard can still show whatever did arrive.
 */
export async function getExchangeRates(): Promise<ExchangeRates> {
  const [bcv, binance] = await Promise.allSettled([fetchBcvRates(), fetchBinanceUsdt()]);

  if (bcv.status === 'rejected') console.error('[exchange-rates] BCV', bcv.reason);
  if (binance.status === 'rejected') console.error('[exchange-rates] Binance', binance.reason);

  const bcvRates: BcvRates =
    bcv.status === 'fulfilled' ? bcv.value : { bcvUsd: null, bcvEur: null, bcvValueDate: null };

  return {
    ...bcvRates,
    binanceUsdt: binance.status === 'fulfilled' ? binance.value : null,
    fetchedAt: new Date().toISOString(),
  };
}
