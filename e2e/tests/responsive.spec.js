import { test, expect } from '@playwright/test';
import { signInAs } from './helpers.js';

test('mobile: login has no horizontal scroll', async ({ page }) => {
  await page.goto('/login');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('mobile: navigation drawer opens, navigates and closes', async ({ page }) => {
  await signInAs(page, 'student');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link', { name: 'Timetable' })).not.toBeInViewport();
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  await expect(nav.getByRole('link', { name: 'Timetable' })).toBeInViewport();
  await nav.getByRole('link', { name: 'Timetable' }).click();
  await expect(page).toHaveURL(/\/timetable$/);
  await expect(nav.getByRole('link', { name: 'Timetable' })).not.toBeInViewport();
});

test('mobile: key pages never overflow the viewport', async ({ page }) => {
  await signInAs(page, 'student');
  for (const path of ['/', '/attendance', '/timetable', '/fees', '/library']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
  }
});
