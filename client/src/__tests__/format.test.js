import { describe, expect, it } from 'vitest';
import {
  fmtDate,
  fmtMoney,
  fmtSize,
  fullName,
  getPath,
  idOf,
  initials,
  pct,
  setPath,
  titleCase,
  toInputDate,
  toLocalInput,
} from '../utils/format.js';

describe('format helpers', () => {
  it('shows a dash for missing values', () => {
    expect(fmtDate(null)).toBe('—');
    expect(fmtMoney(undefined)).toBe('—');
    expect(pct(null)).toBe('—');
    expect(fullName(null)).toBe('—');
  });

  it('formats names, initials and titles', () => {
    expect(fullName({ firstName: 'Asha', lastName: 'Rao' })).toBe('Asha Rao');
    expect(initials('asha rao kumar')).toBe('AR');
    expect(initials('')).toBe('?');
    expect(titleCase('in_progress')).toBe('In Progress');
  });

  it('formats numbers and sizes', () => {
    expect(pct(82)).toBe('82%');
    expect(fmtSize(500)).toBe('1 KB');
    expect(fmtSize(2 * 1048576)).toBe('2.0 MB');
    expect(fmtMoney(1500)).toMatch(/1.?500/);
  });

  it('converts dates for inputs', () => {
    expect(toInputDate('2026-03-05T10:00:00Z')).toBe('2026-03-05');
    expect(toInputDate('')).toBe('');
    expect(toLocalInput('')).toBe('');
    expect(toLocalInput(new Date(2026, 2, 5, 9, 7))).toBe('2026-03-05T09:07');
  });

  it('reads and writes dotted paths immutably', () => {
    const src = { guardian: { name: 'A' }, x: 1 };
    const next = setPath(src, 'guardian.phone', '123');
    expect(next).toEqual({ guardian: { name: 'A', phone: '123' }, x: 1 });
    expect(src.guardian.phone).toBeUndefined();
    expect(getPath(next, 'guardian.phone')).toBe('123');
    expect(getPath(next, 'a.b.c')).toBeUndefined();
    expect(setPath({}, 'a.b.c', 1)).toEqual({ a: { b: { c: 1 } } });
  });

  it('unwraps populated ids', () => {
    expect(idOf({ _id: '7', name: 'x' })).toBe('7');
    expect(idOf('9')).toBe('9');
    expect(idOf(null)).toBeNull();
  });
});
