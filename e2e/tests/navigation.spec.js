import { test, expect } from '@playwright/test';
import { NAV } from '../../client/src/routes/nav.js';
import { signInAs, watchProblems } from './helpers.js';

for (const role of ['admin', 'faculty', 'student', 'parent']) {
  test(`${role}: every sidebar page loads without errors`, async ({ page }) => {
    test.setTimeout(180_000);
    const problems = watchProblems(page);
    await signInAs(page, role);

    const links = NAV.flatMap((g) => g.items).filter((i) => i.roles.includes(role));
    expect(links.length).toBeGreaterThan(4);

    for (const item of links) {
      await page.goto(item.to);
      const main = page.getByRole('main');
      await expect(main.getByRole('heading', { level: 1 }).first(), `${item.to} should render a page title`).toBeVisible();
      await expect(main.getByText('Access denied')).toHaveCount(0);
      // let data requests settle, then make sure the page did not fall into an error state
      await page.waitForLoadState('networkidle');
      await expect(main.getByText(/Unable to load|Something went wrong/i), `${item.to} should load its data`).toHaveCount(0);
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
}

test('admin can search the student list', async ({ page }) => {
  await signInAs(page, 'admin');
  await page.goto('/students');
  const search = page
    .getByRole('searchbox')
    .or(page.getByPlaceholder(/search/i))
    .first();
  await search.fill('S250001');
  await expect(page.getByRole('row').filter({ hasText: 'S250001' }).first()).toBeVisible();
});
