import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { resetTestDb, getTestDbPath } from '../helpers/test-db';

const nowIso = () => new Date().toISOString();

const PROVIDER_ID = 'provider-scope-test-01';
const PROJECT_ID = 'project-scope-test-01';

test.describe('Provider env scope API', () => {
  test.beforeEach(() => {
    resetTestDb();

    const dbPath = getTestDbPath();
    if (!dbPath) throw new Error('Test database not initialized');

    const db = new Database(dbPath);
    const now = nowIso();

    db.prepare(
      `INSERT INTO projects (id, name, description, root_path, is_private, owner_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(PROJECT_ID, 'Scope Test Project', 'env scope test', '/tmp/scope-test', 0, null, now, now);

    db.prepare(
      `INSERT INTO providers (id, name, bin_path, mcp_configured, env, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(PROVIDER_ID, 'codex', null, 0, JSON.stringify({ SCOPE_TEST_KEY: 'test_value' }), now, now);

    db.close();
  });

  test('GET /api/providers returns envScopes field', async ({ page }) => {
    const response = await page.request.get('/api/providers');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body).toHaveProperty('items');
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]).toHaveProperty('envScopes');
  });

  test('PUT /api/providers/:id accepts and returns envScopes', async ({ page }) => {
    const putRes = await page.request.put(`/api/providers/${PROVIDER_ID}`, {
      data: { envScopes: {} },
    });
    expect(putRes.ok()).toBeTruthy();
    const updated = await putRes.json();
    expect(updated).toHaveProperty('envScopes');
  });

  test('PUT /api/providers/:id rejects unknown env key in envScopes', async ({ page }) => {
    const putRes = await page.request.put(`/api/providers/${PROVIDER_ID}`, {
      data: { envScopes: { __nonexistent_key__: [] } },
    });
    expect(putRes.status()).toBe(400);
  });
});

test.describe('Provider env scope UI', () => {
  test.beforeEach(() => {
    resetTestDb();

    const dbPath = getTestDbPath();
    if (!dbPath) throw new Error('Test database not initialized');

    const db = new Database(dbPath);
    const now = nowIso();

    db.prepare(
      `INSERT INTO projects (id, name, description, root_path, is_private, owner_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(PROJECT_ID, 'Scope Test Project', 'env scope test', '/tmp/scope-test', 0, null, now, now);

    db.prepare(
      `INSERT INTO providers (id, name, bin_path, mcp_configured, env, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(PROVIDER_ID, 'codex', null, 0, JSON.stringify({ SCOPE_TEST_KEY: 'test_value' }), now, now);

    db.close();
  });

  test('scopes env var to project and persists after save and reopen', async ({ page }) => {
    await page.goto('/providers');
    await page.waitForLoadState('domcontentloaded');

    // Open edit dialog for the seeded provider
    await page.getByRole('button', { name: 'Edit' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Click the Filter icon next to SCOPE_TEST_KEY
    const filterBtn = page.getByRole('button', { name: 'Scope SCOPE_TEST_KEY to projects' });
    await filterBtn.click();
    await expect(page.getByPlaceholder('Search projects…')).toBeVisible();

    // Check the project in the popover
    await page.getByRole('checkbox', { name: 'Scope Test Project' }).click();

    // Verify Filter icon now shows filled + count state
    await expect(filterBtn).toContainText('(1)');

    // Close popover then submit
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Update' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();

    // Reopen the same provider edit dialog
    await page.getByRole('button', { name: 'Edit' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Verify Filter icon already shows scoped state (scope round-tripped via GET)
    await expect(
      page.getByRole('button', { name: 'Scope SCOPE_TEST_KEY to projects' }),
    ).toContainText('(1)');

    // Open the popover and verify the checkbox is pre-checked
    await page.getByRole('button', { name: 'Scope SCOPE_TEST_KEY to projects' }).click();
    await expect(page.getByPlaceholder('Search projects…')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Scope Test Project' })).toBeChecked();
  });
});
