import { expect, test, type Page } from '@playwright/test';

const ADMIN = { email: 'admin@test.local', password: 'admin-password-1' };

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('link', { name: 'Workspace' })).toBeVisible();
}

test.describe.serial('workspace UI (real API + sandbox, scripted model)', () => {
  test('unauthenticated users are sent to the login page', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('admin adds a key, builds a page with the agent, sees files, preview and terminal', async ({
    page,
  }) => {
    await login(page, ADMIN.email, ADMIN.password);

    // BYOK through the Settings page: saved, masked, tested.
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByLabel('Provider').selectOption({ label: 'Anthropic' });
    await page.getByLabel('API key').fill('sk-ant-ui-test-key-7777');
    await page.getByRole('button', { name: 'Save & test' }).click();
    await expect(page.getByText('••••7777')).toBeVisible();
    await expect(page.getByText('active', { exact: true })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('sk-ant-ui-test-key-7777');

    // Create a project from the sidebar.
    await page.getByRole('link', { name: 'Workspace' }).click();
    await page.getByRole('button', { name: 'New project' }).click();
    await page.getByLabel('Name').fill('UI site');
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page.getByRole('heading', { name: 'New conversation' })).toBeVisible();

    // Pick the model for this conversation, then chat.
    await page.getByLabel('Model').first().selectOption({ label: 'Claude Sonnet 4.5' });
    await page.getByPlaceholder(/Message the agent/).fill('Build a hello page and preview it');
    await page.getByRole('button', { name: 'Send' }).click();

    // Streaming state, then tool calls rendered as collapsible cards with results.
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
    await expect(page.getByText('fs_write')).toBeVisible();
    await expect(page.getByText('shell_exec')).toBeVisible();
    await expect(page.getByText('preview_register')).toBeVisible();
    await expect(page.getByText('Done. The page is in the')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
    await expect(page.locator('.code-block')).toBeVisible();

    await page.getByRole('button', { name: /shell_exec/ }).click();
    await expect(page.getByText('Hello from the UI test').first()).toBeVisible();

    // Files tab: the agent's file is in the tree and opens in the editor.
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await page.getByRole('button', { name: 'site', exact: true }).waitFor();
    await page.getByRole('button', { name: 'index.html', exact: true }).click();
    await expect(page.locator('.monaco-editor')).toContainText('Hello from the UI test');

    // Preview tab: sandboxed iframe served through the signed proxy.
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const frame = page.frameLocator('iframe[title="Preview"]');
    await expect(frame.getByRole('heading', { name: 'Hello from the UI test' })).toBeVisible();
    await expect(page.locator('iframe[title="Preview"]')).toHaveAttribute('sandbox', /allow-scripts/);

    // Terminal tab: interactive shell in the same sandbox.
    await page.getByRole('button', { name: 'Terminal', exact: true }).click();
    await expect(page.getByText(/bash in \/workspace · open/)).toBeVisible();
    await page.locator('.xterm').click();
    await page.keyboard.type('echo term-$((40+2)) && whoami\n');
    await expect(page.locator('.xterm-rows')).toContainText('term-42');

    // Activity and usage reflect what happened.
    await page.getByRole('button', { name: 'Activity', exact: true }).click();
    await expect(page.getByRole('button', { name: /^shell ls -la site/ })).toBeVisible();
    await page.getByRole('button', { name: 'Usage', exact: true }).click();
    await expect(page.getByText('anthropic/claude-sonnet-4-5')).toBeVisible();
  });

  test('admin creates a member; the member sees no admin area and no subscription options', async ({
    page,
    browser,
  }) => {
    await login(page, ADMIN.email, ADMIN.password);
    await page.getByRole('link', { name: 'Admin' }).click();
    await page.getByLabel('Email (becomes the username)').fill('member@test.local');
    await page.getByLabel('Name (optional)').fill('Member');
    await page.getByRole('button', { name: 'Create & generate invite' }).click();
    const invite = await page.locator('#invite-text').inputValue();
    const oneTime = /One-time password: (\S+)/.exec(invite)?.[1] ?? '';

    const memberPage = await (await browser.newContext()).newPage();
    await memberPage.goto('/login');
    await memberPage.getByLabel('Email').fill('member@test.local');
    await memberPage.getByLabel('Password').fill(oneTime);
    await memberPage.getByRole('button', { name: 'Sign in' }).click();
    await memberPage.getByLabel('One-time password').fill(oneTime);
    await memberPage.getByLabel('New password (min. 10 characters)').fill('member-password-1');
    await memberPage.getByLabel('Repeat new password').fill('member-password-1');
    await memberPage.getByRole('button', { name: 'Set password' }).click();
    await expect(memberPage.getByRole('link', { name: 'Workspace' })).toBeVisible();
    await expect(memberPage.getByRole('link', { name: 'Admin' })).toHaveCount(0);
    await memberPage.goto('/admin');
    await expect(memberPage.getByRole('button', { name: 'Users' })).toHaveCount(0);
    // The admin's project is not visible to the member.
    await memberPage.goto('/');
    await expect(memberPage.getByText('UI site')).toHaveCount(0);
  });
});

test.describe.serial('one-time password invite', () => {
  test('admin creates a user, copies the invite; the user must set their own password at first sign-in', async ({
    browser,
  }) => {
    const adminCtx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const admin = await adminCtx.newPage();
    await login(admin, ADMIN.email, ADMIN.password);
    await admin.getByRole('link', { name: 'Admin' }).click();
    await admin.getByLabel('Email (becomes the username)').fill('nina@test.local');
    await admin.getByRole('button', { name: 'Create & generate invite' }).click();

    const invite = admin.locator('#invite-text');
    await expect(invite).toBeVisible();
    const text = await invite.inputValue();
    expect(text).toContain('Username: nina@test.local');
    const password = /One-time password: (\S+)/.exec(text)?.[1] ?? '';
    expect(password).toHaveLength(16);
    await admin.getByRole('button', { name: 'Copy invite' }).click();
    await expect(admin.getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(await admin.evaluate(() => navigator.clipboard.readText())).toBe(text);
    await adminCtx.close();

    const userCtx = await browser.newContext();
    const user = await userCtx.newPage();
    await user.goto('/login');
    await user.getByLabel('Email').fill('nina@test.local');
    await user.getByLabel('Password').fill(password);
    await user.getByRole('button', { name: 'Sign in' }).click();
    await expect(user.getByRole('heading', { name: 'Choose your own password' })).toBeVisible();
    await expect(user.getByRole('link', { name: 'Workspace' })).toHaveCount(0);

    await user.getByLabel('One-time password').fill(password);
    await user.getByLabel('New password (min. 10 characters)').fill('nina-own-password-1');
    await user.getByLabel('Repeat new password').fill('nina-own-password-1');
    await user.getByRole('button', { name: 'Set password' }).click();
    await expect(user.getByRole('link', { name: 'Workspace' })).toBeVisible();
    await userCtx.close();
  });
});
