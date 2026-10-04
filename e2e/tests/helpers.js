import { expect } from '@playwright/test';

export const PASSWORD = 'E2e@Passw0rd1';

export const USERS = {
  admin: 'admin@college.local',
  faculty: 'meera.iyer@college.local',
  student: 's250001@college.local',
  parent: 'parent@college.local',
};

export async function signIn(page, email, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function signInAs(page, role) {
  await signIn(page, USERS[role]);
  await expect(page.getByRole('main').getByRole('heading', { level: 1 }).first()).toBeVisible();
}

/** Collect browser console errors, uncaught exceptions and 5xx API responses. */
export function watchProblems(page) {
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`);
  });
  return problems;
}
