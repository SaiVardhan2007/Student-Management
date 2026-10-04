import { test, expect } from '@playwright/test';
import { signIn, signInAs, USERS, PASSWORD } from './helpers.js';

test.describe('authentication', () => {
  test('signed-out visitors are sent to the login page', async ({ page }) => {
    await page.goto('/students');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('validation messages appear before any request is made', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Enter a valid email address')).toBeVisible();
    await expect(page.getByText('Password is required')).toBeVisible();
  });

  test('wrong password shows a friendly error', async ({ page }) => {
    await signIn(page, USERS.student, 'Wrong@12345');
    await expect(page.getByRole('alert')).toContainText('Invalid email or password');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('admin signs in, keeps the session across a reload, and signs out', async ({ page }) => {
    await signInAs(page, 'admin');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Audit Logs' })).toBeVisible();

    // the access token is memory-only, so a reload must restore the session through the httpOnly refresh cookie
    await page.reload();
    await expect(page.getByRole('main').getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page).toHaveURL(/\/$/);

    await page.getByRole('button', { name: /System Admin/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);

    // the session is really gone: a fresh visit stays on the login page
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('no token is written to web storage and the refresh cookie is httpOnly', async ({ page, context }) => {
    await signInAs(page, 'student');
    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    expect(storage).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./); // a JWT header
    const cookie = (await context.cookies()).find((c) => c.name === 'sms_refresh');
    expect(cookie).toBeTruthy();
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Strict');
    expect(await page.evaluate(() => document.cookie)).not.toContain('sms_refresh');
  });

  test('role guard: a student cannot open admin pages', async ({ page }) => {
    await signInAs(page, 'student');
    await page.goto('/users');
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
  });

  test('repeated wrong passwords lock the account temporarily', async ({ page }) => {
    const email = 's250030@college.local';
    for (let i = 0; i < 5; i++) {
      await signIn(page, email, 'Wrong@12345');
      await expect(page.getByRole('alert')).toContainText('Invalid email or password');
    }
    await signIn(page, email, PASSWORD);
    await expect(page.getByRole('alert')).toContainText(/Too many failed attempts/);
  });

  test('unknown routes show the not-found page', async ({ page }) => {
    await page.goto('/definitely/not/here');
    await expect(page.getByText(/exist or has moved/)).toBeVisible();
  });

  test('forgot-password never reveals whether an email exists', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill('nobody@nowhere.test');
    await page.getByRole('button', { name: /reset link|send/i }).click();
    await expect(page.getByText(/if an account exists/i)).toBeVisible();
  });
});
