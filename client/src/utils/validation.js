/** Mirrors the server password policy so users get instant feedback. */
export function passwordProblem(p = '') {
  if (p.length < 8) return 'Password must be at least 8 characters';
  if (!/[a-z]/.test(p)) return 'Password needs a lowercase letter';
  if (!/[A-Z]/.test(p)) return 'Password needs an uppercase letter';
  if (!/[0-9]/.test(p)) return 'Password needs a number';
  return null;
}

export const ALLOWED_EXT = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'csv', 'png', 'jpg', 'jpeg', 'zip'];
export const MAX_FILE_MB = 10;

/** Client-side file check (server re-validates type + size). */
export function fileProblem(file, { exts = ALLOWED_EXT, maxMb = MAX_FILE_MB } = {}) {
  if (!file) return null;
  const ext = file.name.split('.').pop().toLowerCase();
  if (!exts.includes(ext)) return `File type .${ext} is not allowed. Allowed: ${exts.join(', ')}`;
  if (file.size > maxMb * 1024 * 1024) return `File is too large (max ${maxMb} MB)`;
  return null;
}
