import { test, expect } from "@playwright/test";
import { createRoom, joinRoom, deleteRoom, openHome } from "./helpers";

test("two separate devices join as two players; host starts, guest waits", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const host = await ctxA.newPage();
  const guest = await ctxB.newPage();
  const codes: string[] = [];

  try {
    await openHome(host, "Avi");
    const code = await createRoom(host);
    codes.push(code);
    await expect(host.locator(".player-row")).toHaveCount(1);

    await openHome(guest, "Babi");
    await joinRoom(guest, code);

    await expect(host.locator(".player-row")).toHaveCount(2);
    await expect(guest.locator(".player-row")).toHaveCount(2);
    await expect(host.locator(".player-row").filter({ hasText: "Avi (you)" })).toHaveCount(1);
    await expect(guest.locator(".player-row").filter({ hasText: "Babi (you)" })).toHaveCount(1);

    await expect(host.locator("#btn-start")).toBeVisible();
    await expect(host.locator("#btn-start")).toBeEnabled();
    await expect(guest.locator("#btn-start")).toBeHidden();
    await expect(guest.locator("#lobby-note")).toBeVisible();

    await host.click("#btn-start");
    await expect(host.locator("#screen-game")).toBeVisible();
    await expect(guest.locator("#screen-game")).toBeVisible();
  } finally {
    for (const c of codes) await deleteRoom(c);
    await ctxA.close();
    await ctxB.close();
  }
});

test("duplicated tab from home joins as a second player (the shared-identity bug)", async ({ browser }) => {
  const ctx = await browser.newContext();
  const tabA = await ctx.newPage();
  const tabB = await ctx.newPage();
  const codes: string[] = [];

  try {
    await openHome(tabA, "Avi");
    await openHome(tabB, "Babi");
    const code = await createRoom(tabA);
    codes.push(code);

    await tabB.fill("#join-input", code);
    await tabB.click("#btn-join");
    await tabB.waitForSelector("#screen-lobby:not([hidden])");

    await expect(tabA.locator(".player-row")).toHaveCount(2);
    await expect(tabB.locator(".player-row")).toHaveCount(2);
    await expect(tabA.locator("#btn-start")).toBeEnabled();
  } finally {
    for (const c of codes) await deleteRoom(c);
    await ctx.close();
  }
});

test("name is required for both joining and creating", async ({ browser }) => {
  const ctxHost = await browser.newContext();
  const ctxGuest = await browser.newContext();
  const host = await ctxHost.newPage();
  const guest = await ctxGuest.newPage();
  const codes: string[] = [];

  try {
    await openHome(host, "Avi");
    const code = await createRoom(host);
    codes.push(code);

    await guest.goto("/");
    await guest.click("#btn-create");
    await expect(guest.locator("#nick-error")).toBeVisible();
    await expect(guest.locator("#screen-cats")).toBeHidden();
    await expect(guest.locator("#nick-input")).toBeFocused();

    await guest.fill("#join-input", code);
    await guest.click("#btn-join");
    await expect(guest.locator("#nick-error")).toBeVisible();
    await expect(guest.locator("#screen-lobby")).toBeHidden();

    await guest.fill("#nick-input", "Babi");
    await expect(guest.locator("#nick-error")).toBeHidden();
    await guest.click("#btn-join");
    await expect(guest.locator("#screen-lobby")).toBeVisible();
    await expect(guest.locator(".player-row").filter({ hasText: "Babi (you)" })).toHaveCount(1);
  } finally {
    for (const c of codes) await deleteRoom(c);
    await ctxHost.close();
    await ctxGuest.close();
  }
});

test("reload keeps identity and does not duplicate the player", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const codes: string[] = [];

  try {
    await openHome(page, "Avi");
    const code = await createRoom(page);
    codes.push(code);

    await page.reload();
    await page.fill("#nick-input", "Avi");
    await page.fill("#join-input", code);
    await page.click("#btn-join");
    await page.waitForSelector("#screen-lobby:not([hidden])");

    await expect(page.locator(".player-row")).toHaveCount(1);
    await expect(page.locator(".player-row")).toContainText("Avi (you)");
  } finally {
    for (const c of codes) await deleteRoom(c);
    await ctx.close();
  }
});
