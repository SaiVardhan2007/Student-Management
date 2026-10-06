export const SEMESTERS = Array.from({ length: 8 }, (_, i) => ({ value: String(i + 1), label: `Semester ${i + 1}` }));
export const STATUSES = ['active', 'inactive', 'graduated', 'suspended', 'dropped'].map((s) => ({
  value: s,
  label: s[0].toUpperCase() + s.slice(1),
}));
