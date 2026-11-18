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

  // Quote draft without Gmail → saved, with a clear warning (once a COA exists, it first asks what to attach)
  await page.getByRole("button", { name: "Create quote draft" }).first().click();
  const attachDialog = page.getByRole("dialog", { name: "Attach documents?" });
  const asked = await attachDialog.waitFor({ state: "visible", timeout: 3000 }).then(() => true, () => false);
  if (asked) await attachDialog.getByRole("button", { name: "Without attachments" }).click();
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

  // Edit a product: add another name buyers use
  const editDialog = page.getByRole("dialog", { name: "Edit product" });
  await expect(async () => {
    if (!(await editDialog.isVisible())) await page.getByRole("button", { name: "Edit product" }).click();
    await expect(editDialog).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 30_000 });
  await editDialog.getByLabel("Product", { exact: true }).selectOption({ label: "Mung Starch" });
  await editDialog.getByLabel("Other names buyers use (comma separated)").fill(`moong starch, mung bean starch ${test.info().project.name}`);
  await editDialog.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product saved")).toBeVisible();

  // Remove a discontinued product, then restore it from Removed products
  await expect(async () => {
    if (!(await editDialog.isVisible())) await page.getByRole("button", { name: "Edit product" }).click();
    await expect(editDialog).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 30_000 });
  await editDialog.getByLabel("Product", { exact: true }).selectOption({ label: "Wheat Starch" });
  await editDialog.getByRole("button", { name: "Remove product" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove product" }).click();
  await expect(page.getByText("Wheat Starch removed")).toBeVisible();
  await page.getByText("Removed products").click();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("Wheat Starch restored")).toBeVisible();

  // Import a price list (G-KB-6): paste, read what would change, apply. A line with no known GST rate is left out.
  await page.getByRole("link", { name: "Import price list" }).click();
  await expect(page.getByRole("heading", { name: "Import price list" })).toBeVisible();
  const mobile = test.info().project.name === "mobile";
  const preview = page.getByTestId("price-list-preview");
  // The mapping (which heading has which GST % and pack size) is saved for this company and can be changed here.
  await page.getByText("How Inquira reads your list (mapping)").click();
  await expect(page.getByLabel("Mapping")).toHaveValue(/"Proteins"/);
  await expect(async () => {
    await page.getByLabel("Mapping").fill("not a mapping");
    await page.getByRole("button", { name: "Save mapping" }).click();
    await expect(page.getByText(/could not be read/)).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30_000 });
  await page.reload(); // the saved mapping is untouched
  await expect(async () => {
    await page.getByLabel("Price list").fill(`Not A Known Product - 5 Rs/Kg\nStarches:\nMung Starch - ${mobile ? 112 : 111} Rs/Kg`);
    await page.getByRole("button", { name: "Show changes" }).click();
    await expect(preview).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30_000 });
  await expect(preview).toContainText("2 lines read: 1 to save, 0 unchanged, 1 with a problem");
  await expect(preview.getByRole("region", { name: "Price changes" })).toContainText(mobile ? "Mung Starch: ₹111 → ₹112" : "Mung Starch: ₹105 → ₹111");
  await expect(preview.getByRole("region", { name: "Will NOT be written" })).toContainText("Not A Known Product");
  await noHorizontalScroll(page);
  await shot(page, "06b-import-price-list");
  await page.getByRole("button", { name: "Apply 1 change" }).click();
  await page.getByRole("button", { name: "Save rates" }).click();
  await expect(page.getByText("Saved 1 rate")).toBeVisible();
  await expect(page).toHaveURL(/\/rates$/);

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
  // Sign-in is always on (GOAL G-PLT-1): no signed-in page renders for a visitor.
  for (const p of ["/", "/review", "/rates", "/rates/import", "/documents", "/templates", "/indiamart", "/settings", "/leads/00000000-0000-4000-8000-000000000000", "/oauth/authorize?client_id=x"]) {
    await page.goto(p);
    await expect(page, p).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  }
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

test("documents: add, download and attach to a quote; members: add, change role, remove", async ({ page }) => {
  await signIn(page);
  const proj = test.info().project.name;

  // Documents (G-KB-4)
  await page.goto("/documents");
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  const title = `COA-e2e-${proj}`;
  await expect(async () => {
    await page.getByLabel("Product", { exact: true }).selectOption({ label: "Chickpea Protein Isolate" });
    await page.getByLabel("Type", { exact: true }).selectOption("coa");
    await page.getByLabel(/^File \(PDF/).setInputFiles({ name: `${title}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4\n${title}\n`) });
    await page.getByLabel("Batch number").fill("B-42");
    await page.getByLabel("Expiry date").fill("2030-12-31");
    await page.getByRole("button", { name: "Add document" }).click();
    await expect(page.getByText("Document added")).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30_000 });
  const item = page.getByRole("list", { name: "Documents" }).getByRole("listitem").filter({ hasText: title });
  await expect(item).toContainText("Batch B-42");
  await expect(item).toContainText(/Valid, \d+ days left/);
  await noHorizontalScroll(page);
  await shot(page, "12-documents");
  const href = await item.getByRole("link", { name: `Download ${title}.pdf` }).getAttribute("href");
  const file = await page.request.get(href!);
  expect(file.status()).toBe(200);
  expect(file.headers()["content-disposition"]).toContain(`${title}.pdf`);
  expect((await file.body()).toString()).toContain(title);

  // The lead for that product now offers the COA when creating a quote
  await page.goto("/leads");
  await expect(async () => {
    if (!/\/leads\/[0-9a-f-]{36}/.test(page.url())) await page.getByRole("link", { name: /Chickpea Isolate Protein/ }).first().click();
    await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}/, { timeout: 3000 });
  }).toPass({ timeout: 30_000 });
  const attach = page.getByRole("dialog", { name: "Attach documents?" });
  await expect(async () => {
    if (!(await attach.isVisible())) await page.getByRole("button", { name: "Create quote draft" }).first().click();
    await expect(attach).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 30_000 });
  await attach.getByRole("checkbox").first().check();
  await attach.getByRole("button", { name: "Create draft with 1 file" }).click();
  await expect(page.getByText(/Gmail is not connected|Draft not created/).first()).toBeVisible();

  // Members (G-PLT-2)
  await page.goto("/settings?tab=members");
  const email = `teammate-${proj}@example.com`;
  await expect(async () => {
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Role", { exact: true }).selectOption("qa");
    await page.getByRole("button", { name: "Add member" }).click();
    await expect(page.getByText(`Next step for ${email}`)).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30_000 });
  await noHorizontalScroll(page);
  await shot(page, "13-members");
  // Custom access: let this QA person change prices too
  const access = page.getByRole("dialog", { name: `Access for ${email}` });
  await expect(async () => {
    if (!(await access.isVisible())) await page.getByRole("button", { name: `Access of ${email}` }).click();
    await expect(access).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 30_000 });
  await access.getByRole("checkbox", { name: "Change prices and import price lists" }).check();
  await expect(access.getByText("Added")).toBeVisible();
  await access.getByRole("button", { name: "Save access" }).click();
  await expect(page.getByText(`Access saved for ${email}`)).toBeVisible();
  await expect(page.getByRole("list", { name: "Members" }).getByRole("listitem").filter({ hasText: email })).toContainText("Custom access");
  await page.getByLabel(`Role of ${email}`).selectOption("viewer");
  await expect(page.getByText(`${email} is now Viewer; custom access was reset`)).toBeVisible();
  await page.getByRole("button", { name: `Remove ${email}` }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove member" }).click();
  await expect(page.getByText(`${email} removed`)).toBeVisible();
  await expect(page.getByRole("list", { name: "Members" })).not.toContainText(email);
});

test("AI: set up a tier (no call is made), dashboard card, Needs details view, request type on a lead", async ({ page }) => {
  await signIn(page);
  await expect(page.getByTestId("ai-card")).toBeVisible();
  await page.goto("/settings?tab=ai");
  const basic = page.locator("form").filter({ has: page.getByLabel("Model name") }).first();
  await expect(page.getByRole("heading", { name: "Basic AI" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Advanced AI" })).toBeVisible();
  // Saving stores settings only; "Test connection" (which would call the provider) is never clicked here.
  await expect(async () => {
    await basic.getByLabel("Model name").fill("e2e-test-model");
    await basic.getByLabel("API key").fill("e2e-fake-key-not-real");
    await basic.getByLabel(/Use Basic AI/).check();
    await basic.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/Saved\. Click Test connection/)).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByText("On, not tested yet").first()).toBeVisible();
  await expect(page.getByText("e2e-fake-key-not-real")).toHaveCount(0);
  await noHorizontalScroll(page);
  await shot(page, "13-settings-ai");

  await page.goto("/");
  await expect(page.getByTestId("ai-card")).toContainText("Basic");
  await page.goto("/leads?view=details");
  await expect(page.getByRole("tab", { name: "Needs details" })).toHaveAttribute("aria-selected", "true");
  await noHorizontalScroll(page);

  await page.goto("/leads");
  await expect(async () => {
    if (!/\/leads\/[0-9a-f-]{36}/.test(page.url())) await page.getByRole("link", { name: /Chickpea Isolate Protein/ }).first().click();
    await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}/, { timeout: 3000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByText("Wants", { exact: true })).toBeVisible();
  await expect(page.getByText(/New enquiry/).first()).toBeVisible();
});

test("an Accounts member sees no Settings and cannot open it", async ({ page }) => {
  await signIn(page);
  const email = `accounts-${test.info().project.name}@example.com`;
  await page.goto("/settings?tab=members");
  await expect(async () => {
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Role", { exact: true }).selectOption("accounts");
    await page.getByRole("button", { name: "Add member" }).click();
    await expect(page.getByText(`Next step for ${email}`)).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30_000 });
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: /Sign in/ }).click();
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main" }).locator("visible=true");
  await expect(nav.getByRole("link", { name: "Leads" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Documents" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await page.goto("/settings");
  await expect(page).toHaveURL(/denied=1/);
  await expect(page.getByText("You don't have access to that page")).toBeVisible();
  await noHorizontalScroll(page);
});

