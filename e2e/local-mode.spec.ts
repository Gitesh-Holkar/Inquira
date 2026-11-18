import { expect, test } from "@playwright/test";

/**
 * A fresh local install, start to finish: the first person creates the owner account, sees the example
 * company, adds a document, adds a teammate who sets a password with a one-time link, and signs in again.
 * Run with playwright.local.config.ts against an install nobody has used yet.
 */
const OWNER = { email: "owner@example.com", password: "owner password 123" };
const QA = { email: "qa@example.com", password: "qa person pass 456" };

test("fresh local install: owner, example data, document, teammate with a sign-in link", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Create the owner account" })).toBeVisible();
  await page.getByLabel("Your email").fill(OWNER.email);
  await page.getByLabel("Password (at least 10 characters)").fill(OWNER.password);
  await page.getByLabel("Password again").fill(OWNER.password);
  await page.getByRole("button", { name: "Create owner account" }).click();
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await expect(page.getByText("Signed in to Example Ingredients Pvt. Ltd.")).toBeVisible();

  // Example data
  await page.goto("/rates");
  await page.getByLabel("Filter products").fill("Pea Protein Isolate");
  await expect(page.getByLabel("Pea Protein Isolate Standard Price ₹/kg", { exact: true }).locator("visible=true")).toHaveValue(/^300(\.00)?$/);

  // A document goes to the disk volume and comes back
  await page.goto("/documents");
  await page.getByLabel("Product", { exact: true }).selectOption({ label: "Pea Protein Isolate" });
  await page.getByLabel(/^File \(PDF/).setInputFiles({ name: "COA-local.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nlocal coa\n") });
  await page.getByLabel("Expiry date").fill("2030-01-31");
  await page.getByRole("button", { name: "Add document" }).click();
  await expect(page.getByText("Document added")).toBeVisible();
  const href = await page.getByRole("link", { name: "Download COA-local.pdf" }).getAttribute("href");
  expect((await (await page.request.get(href!)).body()).toString()).toContain("local coa");

  // A teammate gets a one-time link (no email in local mode)
  await page.goto("/settings?tab=members");
  await page.getByLabel("Email address").fill(QA.email);
  await page.getByLabel("Role", { exact: true }).selectOption("qa");
  await page.getByRole("button", { name: "Add member" }).click();
  const link = await page.locator("code").filter({ hasText: "/login/set-password?token=" }).innerText();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible(); // the first-run screen is gone for good

  await page.goto(link);
  await page.getByLabel("Password (at least 10 characters)").fill(QA.password);
  await page.getByLabel("Password again").fill(QA.password);
  await page.getByRole("button", { name: "Set password and sign in" }).click();
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await page.goto("/rates");
  await expect(page.getByText("Read-only — only admins can change rates")).toBeVisible(); // QA does not change prices by default
  await page.getByRole("button", { name: "Sign out" }).click();

  // The link worked once
  await page.goto(link);
  await page.getByLabel("Password (at least 10 characters)").fill("another password 789");
  await page.getByLabel("Password again").fill("another password 789");
  await page.getByRole("button", { name: "Set password and sign in" }).click();
  await expect(page.getByText(/expired or was already used/)).toBeVisible();

  // Wrong password, then the right one
  await page.goto("/login");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill("wrong password 000");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/Email or password is incorrect/)).toBeVisible();
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
});
