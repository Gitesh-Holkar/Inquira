import { expect, test, type Page } from "@playwright/test";

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `docs/screenshots/${name}-${test.info().project.name === "mobile" ? "390" : "1440"}.png`, fullPage: true, caret: "initial" });

async function signIn(page: Page) {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await shot(page, "01-login");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByRole("button", { name: /Sign in/ }).click();
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "page must not scroll horizontally").toBeLessThanOrEqual(1);
}

test("main flows", async ({ page }) => {
  await signIn(page);
  await expect(page.getByTestId("reconciliation")).toContainText("received today");
  await expect(page.getByTestId("indiamart-card")).toContainText("skipped");
  await noHorizontalScroll(page);
  await shot(page, "02-dashboard");

  // Lead inbox
  await page.goto("/leads");
  await expect(page.getByRole("heading", { name: "Leads" })).toBeVisible();
  const items = page.getByRole("list", { name: "Leads" }).getByRole("listitem");
  await expect(items.first()).toBeVisible();
  await noHorizontalScroll(page);
  await shot(page, "03-inbox");

  // International view
  await page.getByRole("tab", { name: "International" }).click();
  await expect(page.getByText("Peanut Flour Powder for Protein Supplements")).toBeVisible();

  // Lead detail + WhatsApp editable text
  await page.goto("/leads");
  await expect(async () => {
    if (!/\/leads\/[0-9a-f-]{36}/.test(page.url())) await page.getByRole("link", { name: /Chickpea Isolate Protein/ }).first().click();
    await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}/, { timeout: 3000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Buyer" })).toBeVisible();
  await noHorizontalScroll(page);
  await shot(page, "04-lead-detail");
  const dialog = page.getByRole("dialog", { name: "WhatsApp message" });
  const msg = dialog.getByRole("textbox", { name: "Message" });
  // Dev server hydrates lazily on first load: retry the first click until the dialog opens.
  await expect(async () => {
    if (!(await dialog.isVisible())) await page.getByRole("button", { name: "WhatsApp" }).first().click();
    await expect(msg).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 30_000 });
  await expect(msg).toHaveValue(/Hello Vikram/);
  const wa = dialog.getByRole("link", { name: "Open WhatsApp" });
  await expect(wa).toHaveAttribute("href", /^https:\/\/wa\.me\/919000000707\?text=Hello%20Vikram/);
  await page.keyboard.press("Escape");

  // Add a note (audit trail + timeline)
  const note = `E2E (${test.info().project.name}): asked for COA`;
  await page.getByLabel("New note").fill(note);
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText(note)).toBeVisible();

  // Quote draft without Gmail → saved, with a clear warning
  await page.getByRole("button", { name: "Create quote draft" }).first().click();
  await expect(page.getByText(/Gmail is not connected|Draft not created/).first()).toBeVisible();

  // Review queue
  await page.goto("/review");
  await expect(page.getByRole("heading", { name: "Review queue" })).toBeVisible();
  await noHorizontalScroll(page);
  await shot(page, "05-review");

  // Rates: edit a cell, see the change counter
  await page.goto("/rates");
  await expect(page.getByRole("heading", { name: "Rates" })).toBeVisible();
  await noHorizontalScroll(page);
  await shot(page, "06-rates");
  await page.getByLabel("Filter products").fill("Pea Protein Isolate");
  const price = page.getByLabel("Pea Protein Isolate Standard Price ₹/kg", { exact: true }).locator("visible=true");
  const newPrice = test.info().project.name === "mobile" ? "356" : "355";
  await expect(async () => {
    await price.fill(newPrice);
    await expect(page.getByRole("button", { name: /Save 1 change/ })).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 30_000 });
  await page.getByRole("button", { name: /Save 1 change/ }).click();
  await page.getByRole("button", { name: "Save rates" }).click();
  await expect(page.getByText(/Saved 1 rate/)).toBeVisible();

  // Templates live preview
  await page.goto("/templates");
  await expect(page.getByTestId("quote_email-preview")).toContainText("Rs. 350.00/kg");
  await noHorizontalScroll(page);
  await shot(page, "07-templates");

  // Settings
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "TradeIndia" })).toBeVisible();
  await noHorizontalScroll(page);
  await shot(page, "08-settings");
  await page.goto("/settings?tab=mcp");
  await expect(async () => {
    await page.getByLabel("Token name").fill(`e2e-${test.info().project.name}`);
    await page.getByRole("button", { name: "Create token" }).click();
    await expect(page.getByText(/won't be shown again/)).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30_000 });
  await shot(page, "09-mcp-token");

  // IndiaMART log
  await page.goto("/indiamart");
  await expect(page.getByText("Pea Protein Isolate 500 kg, Pune")).toBeVisible();
  await shot(page, "10-indiamart");
});

test("dark mode renders", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await signIn(page);
  await page.goto("/leads");
  await expect(page.getByRole("list", { name: "Leads" })).toBeVisible();
  await shot(page, "11-inbox-dark");
});

test("signed-out users are sent to login; MCP needs auth", async ({ page, request }) => {
  await page.goto("/leads");
  await expect(page).toHaveURL(/\/login\?next=%2Fleads/);
  const r = await request.post("/api/mcp", { data: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  expect(r.status()).toBe(401);
  expect(r.headers()["www-authenticate"]).toContain("resource_metadata=");
  const meta = await request.get("/.well-known/oauth-protected-resource");
  expect((await meta.json()).resource).toMatch(/\/api\/mcp$/);
});

test("sign-in explains failed email links", async ({ page }) => {
  // Supabase's own error (expired / already used) → back to /login with a reason.
  await page.goto("/auth/callback?error=access_denied&error_code=otp_expired");
  await expect(page).toHaveURL(/\/login\?error=link_expired/);
  await expect(page.getByText(/expired or was already used/)).toBeVisible();
  await page.goto("/login?error=other_browser");
  await expect(page.getByText(/same browser where you asked for it/)).toBeVisible();
  // Implicit-flow links put the error in the URL hash.
  await page.goto("/login#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
  await expect(page.getByText(/expired or was already used/)).toBeVisible();
  await expect(page.getByText(/There is no public sign-up/)).toBeVisible();
});

test("flagged rates can be confirmed without changing them", async ({ page }) => {
  await signIn(page);
  await page.goto("/rates");
  const mark = page.getByRole("button", { name: "Mark correct" }).locator("visible=true").first();
  const acked = page.getByText("Will confirm").locator("visible=true");
  // Dev server hydrates lazily: click until the first flagged row shows "Will confirm" (never twice).
  await expect(async () => {
    if (!(await acked.count())) await mark.click();
    await expect(page.getByRole("button", { name: /Save 1 change/ })).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 30_000 });
  await expect(acked).toHaveCount(1);
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("button", { name: /Save 1 change/ })).toBeHidden();
});
