import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInAs } from './helpers.js';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function audit(page, label) {
  await page.waitForLoadState('networkidle');
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = violations.map((v) => {
    const sample = v.nodes
      .slice(0, 6)
      .map((n) => {
        const d = n.any?.[0]?.data;
        const extra = d?.contrastRatio ? ` [${d.fgColor} on ${d.bgColor}, ratio ${d.contrastRatio}]` : '';
        return `    - ${n.target.join(' ')}${extra}`;
      })
      .join('\n');
    return `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s)\n${sample}`;
  });
  expect(summary, `${label} has WCAG A/AA violations:\n${summary.join('\n')}`).toEqual([]);
}

test('login page is accessible', async ({ page }) => {
  await page.goto('/login');
  await audit(page, '/login');
});

test('register and forgot-password pages are accessible', async ({ page }) => {
  for (const path of ['/register', '/forgot-password']) {
    await page.goto(path);
    await audit(page, path);
  }
});

const PAGES = {
  admin: ['/', '/students', '/faculty', '/academic-setup', '/reports', '/settings', '/audit-logs', '/import'],
  faculty: ['/', '/attendance', '/marks', '/assignments'],
  student: ['/', '/timetable', '/attendance', '/results', '/fees', '/library'],
  parent: ['/', '/my-children', '/fees'],
};

for (const [role, paths] of Object.entries(PAGES)) {
  test(`${role} pages are accessible`, async ({ page }) => {
    test.setTimeout(120_000);
    await signInAs(page, role);
    for (const path of paths) {
      await page.goto(path);
      await expect(page.getByRole('main').getByRole('heading', { level: 1 }).first()).toBeVisible();
      await audit(page, `${role} ${path}`);
    }
  });
}
