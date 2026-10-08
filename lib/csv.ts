// Builds CSV text and CSV download responses for the report/export routes.
/** CSV helpers with spreadsheet-formula-injection protection. */
// Values that start with a formula character but are harmless: phone numbers (+91 98765-43210) and plain negative numbers (-12.5).
const SAFE_LEADING = /^(\+[0-9][0-9 -]*|-[0-9]+(\.[0-9]+)?)$/;

/** One CSV cell: quoted when needed, and spreadsheet formulas are neutralised with a leading apostrophe. */
export function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !SAFE_LEADING.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export type CsvColumn = { label: string; value: string | ((row: any) => unknown) };

export function toCsv(rows: any[], columns: CsvColumn[]): string {
  const head = columns.map((c) => cell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => cell(typeof c.value === 'function' ? c.value(r) : r[c.value])).join(','));
  return [head, ...body].join('\r\n');
}

/** A CSV file download response (UTF-8 BOM so Excel opens it correctly). */
export function csvResponse(filename: string, rows: any[], columns: CsvColumn[]): Response {
  return new Response('﻿' + toCsv(rows, columns), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` },
  });
}
