import { test, expect } from "@playwright/test";
import { createRoom, joinRoom, deleteRoom, openHome, roomUrl } from "./helpers";

const num = (v: Record<string, string> | undefined): number =>
  Number(v?.doubleValue ?? v?.integerValue);

test("collective round: both pre-answer their share (host one extra on odd), then results play back", async ({ browser }) => {
  const ctxHost = await browser.newContext();
  const ctxGuest = await browser.newContext();
  const host = await ctxHost.newPage();
  const guest = await ctxGuest.newPage();
  const codes: string[] = [];

  try {
    await openHome(host, "Avi");
    const code = await createRoom(host, null, { collective: true });
    codes.push(code);
    await host.fill("#qpr-input", "3");
    await host.locator("#qpr-input").blur();
    await expect(host.locator("#collective-toggle")).toBeChecked();

    await openHome(guest, "Babi");
    await joinRoom(guest, code);
    await expect(guest.locator("#collective-toggle")).toBeHidden();
    await expect(guest.locator("#lobby-collective")).toContainText("together up front");

    await host.click("#btn-start");
    await expect(host.locator("#screen-collect")).toBeVisible();
    await expect(guest.locator("#screen-collect")).toBeVisible();

    await expect(host.locator("#collect-queue")).toHaveText("Question 1 of 2 — your turn");
    await expect(guest.locator("#collect-queue")).toHaveText("Question 1 of 1 — your turn");

    await guest.locator("#collect-bar").click({ position: { x: 300, y: 27 } });
    await guest.click("#btn-answer");
    await expect(guest.locator("#collect-done")).toBeVisible();
    await expect(guest.locator("#collect-done")).toContainText("waiting for Avi");

    await host.locator("#collect-bar").click({ position: { x: 180, y: 27 } });
    await host.click("#btn-answer");
    await expect(host.locator("#collect-queue")).toHaveText("Question 2 of 2 — your turn");
    await host.locator("#collect-bar").click({ position: { x: 400, y: 27 } });
    await host.click("#btn-answer");
    await expect(host.locator("#collect-done")).toBeVisible();

    await expect(guest.locator("#screen-game")).toBeVisible({ timeout: 15000 });
    await expect(host.locator("#screen-game")).toBeVisible();
    await expect(host.locator("#round-info")).toContainText("placed the marker");
    await expect(host.locator("#reveal-panel")).toBeVisible();
    await expect(host.locator("#reveal-delta")).toContainText("placed it at");

    await expect(host.locator("#score")).toHaveText("0");
    await host.click("#btn-next");
    await expect(host.locator("#round-num")).toHaveText("2");
    await host.click("#btn-next");
    await expect(host.locator("#round-num")).toHaveText("3");
    await expect(host.locator("#btn-next")).toHaveText("Finish round");
    await host.click("#btn-next");

    await expect(host.locator("#screen-summary")).toBeVisible();
    await expect(host.locator("#summary-round")).toContainText("3 questions played");
    const room2 = (await (await fetch(roomUrl(code))).json()).fields;
    const total = Number(room2.score.integerValue ?? room2.score.doubleValue);
    await expect(host.locator("#summary-total")).toContainText("Total score: " + total);

    await host.click("#btn-continue");
    await expect(host.locator("#screen-collect")).toBeVisible();
    await expect(host.locator("#collect-round")).toHaveText("Round 2");

    const room3 = (await (await fetch(roomUrl(code))).json()).fields;
    expect(Number(room3.score.integerValue ?? room3.score.doubleValue)).toBe(total);
  } finally {
    for (const c of codes) await deleteRoom(c);
    await ctxHost.close();
    await ctxGuest.close();
  }
});

test("each player can skip two questions (dots deplete); skipped questions are dropped", async ({ browser }) => {
  const ctxHost = await browser.newContext();
  const ctxGuest = await browser.newContext();
  const host = await ctxHost.newPage();
  const guest = await ctxGuest.newPage();
  const codes: string[] = [];

  try {
    await openHome(host, "Avi");
    const code = await createRoom(host, null, { collective: true });
    codes.push(code);
    await host.fill("#qpr-input", "3");
    await host.locator("#qpr-input").blur();

    await openHome(guest, "Babi");
    await joinRoom(guest, code);
    await host.click("#btn-start");
    await expect(host.locator("#screen-collect")).toBeVisible();

    await expect(host.locator("#skip-dots .skip-dot:not(.used)")).toHaveCount(2);
    await host.click("#btn-skip");
    await expect(host.locator("#skip-dots .skip-dot:not(.used)")).toHaveCount(1);
    await expect(host.locator("#collect-queue")).toHaveText("Question 2 of 2 — your turn");
    await host.click("#btn-skip");
    await expect(host.locator("#skip-dots .skip-dot:not(.used)")).toHaveCount(0);
    await expect(host.locator("#btn-skip")).toBeDisabled();
    await expect(host.locator("#collect-done")).toBeVisible();

    await guest.locator("#collect-bar").click({ position: { x: 250, y: 27 } });
    await guest.click("#btn-answer");
    await expect(guest.locator("#screen-game")).toBeVisible({ timeout: 15000 });

    await expect(host.locator("#reveal-panel")).toBeVisible();
    await expect(host.locator("#round-num")).toHaveText("1");
    await expect(host.locator("#btn-next")).toHaveText("Finish round");
    await host.click("#btn-next");
    await expect(host.locator("#screen-summary")).toBeVisible();
    await expect(host.locator("#summary-round")).toContainText("1 questions played");
  } finally {
    for (const c of codes) await deleteRoom(c);
    await ctxHost.close();
    await ctxGuest.close();
  }
});