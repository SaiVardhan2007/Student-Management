import { describe, expect, it } from 'vitest';
import { fileProblem, passwordProblem } from '../utils/validation.js';
import { getPath, setPath, titleCase, toLocalInput } from '../utils/format.js';
import { validateField } from '../components/DynamicForm.jsx';

describe('passwordProblem', () => {
  it('mirrors the server password policy', () => {
    expect(passwordProblem('short1A')).toMatch(/8 characters/);
    expect(passwordProblem('alllowercase1')).toMatch(/uppercase/);
    expect(passwordProblem('ALLUPPERCASE1')).toMatch(/lowercase/);
    expect(passwordProblem('NoNumbersHere')).toMatch(/number/);
    expect(passwordProblem('Valid@Pass1')).toBeNull();
  });
});

describe('fileProblem', () => {
  const file = (name, size = 1000) => ({ name, size });
  it('rejects disallowed types and oversize files, accepts normal ones', () => {
    expect(fileProblem(file('virus.exe'))).toMatch(/not allowed/);
    expect(fileProblem(file('big.pdf', 11 * 1024 * 1024))).toMatch(/too large/);
    expect(fileProblem(file('notes.PDF'))).toBeNull();
    expect(fileProblem(null)).toBeNull();
    expect(fileProblem(file('photo.gif'), { exts: ['png', 'jpg'] })).toMatch(/not allowed/);
  });
});

describe('format helpers', () => {
  it('reads and writes dotted paths immutably', () => {
    const a = { guardian: { name: 'X' } };
    const b = setPath(a, 'guardian.phone', '123');
    expect(b).toEqual({ guardian: { name: 'X', phone: '123' } });
    expect(a.guardian.phone).toBeUndefined();
    expect(getPath(b, 'guardian.phone')).toBe('123');
    expect(getPath(b, 'address.city')).toBeUndefined();
  });

  it('formats labels and local datetime inputs', () => {
    expect(titleCase('in_progress')).toBe('In Progress');
    expect(toLocalInput('2026-01-05T10:30:00')).toBe('2026-01-05T10:30');
    expect(toLocalInput(null)).toBe('');
  });
});

describe('validateField', () => {
  it('validates required, email, phone and number ranges', () => {
    expect(validateField({ label: 'Name', required: true }, '', {})).toBe('Name is required');
    expect(validateField({ type: 'email' }, 'nope', {})).toMatch(/valid email/);
    expect(validateField({ type: 'email' }, 'a@b.co', {})).toBeNull();
    expect(validateField({ type: 'tel' }, 'abc', {})).toMatch(/valid phone/);
    expect(validateField({ type: 'number', min: 0, max: 10 }, '11', {})).toMatch(/at most 10/);
    expect(validateField({ type: 'number', min: 0 }, '-1', {})).toMatch(/at least 0/);
    expect(validateField({ type: 'text' }, '', {})).toBeNull(); // optional + empty
    expect(validateField({ validate: (v) => (v === 'x' ? 'bad' : null) }, 'x', {})).toBe('bad');
  });
});
