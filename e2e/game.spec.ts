import { test, expect, type Page } from "@playwright/test";
import { createRoom, joinRoom, deleteRoom, openHome, roomUrl } from "./helpers";

function pointsFor(guess: number, target: number): number {
  const d = Math.abs(guess - target);
  if (d < 6) return 4;
  if (d < 12) return 3;
  if (d < 20) return 2;
  if (d < 30) return 1;
  return 0;
}

const num = (v: Record<string, string> | undefined): number =>
  Number(v?.doubleValue ?? v?.integerValue);

test("full round flow: clue -> guess -> reveal -> next round with alternating giver", async ({ browser }) => {
  const ctxHost = await browser.newContext();
  const ctxGuest = await browser.newContext();
  const host = await ctxHost.newPage();
  const guest = await ctxGuest.newPage();
  const codes: string[] = [];

  try {
    await openHome(host, "Avi");
    const code = await createRoom(host);
    codes.push(code);
    await openHome(guest, "Babi");
    await joinRoom(guest, code);
    await expect(host.locator("#btn-start")).toBeEnabled();
    await host.click("#btn-start");

    await expect(host.locator("#screen-game")).toBeVisible();
    await expect(guest.locator("#screen-game")).toBeVisible();

    const hostIsGiver = await host.locator("#giver-panel").isVisible();
    const guestIsGiver = await guest.locator("#giver-panel").isVisible();
    expect(hostIsGiver !== guestIsGiver).toBeTruthy();

    const giver = hostIsGiver ? host : guest;
    const guesser = hostIsGiver ? guest : host;

    await expect(giver.locator("#clue-input-wrap")).toBeVisible();
    await expect(giver.locator("#target-marker")).toBeVisible();
    await expect(guesser.locator("#guess-wait")).toBeVisible();
    const specLeft = await giver.textContent("#spec-left");
    await expect(guesser.locator("#spec-left")).toHaveText(specLeft!);

    await giver.fill("#clue-input", "banana");
    await giver.click("#btn-send");

    await expect(guesser.locator("#guess-dial")).toBeVisible();
    await expect(guesser.locator("#clue-box")).toContainText("banana");
    await expect(giver.locator("#giver-wait")).toBeVisible();

    const dial = guesser.locator("#dial-bar");
    await dial.click({ position: { x: 350, y: 27 } });
    await guesser.click("#btn-lock");

    await expect(guesser.locator("#reveal-panel")).toBeVisible();
    await expect(host.locator("#reveal-panel")).toBeVisible();
    await expect(guesser.locator("#reveal-clue")).toContainText("banana");
    await expect(guesser.locator("#reveal-points")).toBeVisible();

    const room = (await (await fetch(roomUrl(code))).json()).fields;
    const guess = num(room.round.mapValue.fields.guess);
    const target = num(room.round.mapValue.fields.target);
    const expected = pointsFor(guess, target);

    const giverRound1 = await host.textContent("#round-info");
    await host.click("#btn-next");

    await expect(host.locator("#round-num")).toHaveText("2");
    await expect(guesser.locator("#round-num")).toHaveText("2");
    const giverRound2 = await host.textContent("#round-info");
    expect(giverRound1).not.toBe(giverRound2);

    await expect(host.locator("#score")).toHaveText(String(expected));
    await expect(guesser.locator("#guess-arrow")).toBeHidden();
  } finally {
    for (const c of codes) await deleteRoom(c);
    await ctxHost.close();
    await ctxGuest.close();
  }
});

test("round summary after N questions, then continue with accumulated score", async ({ browser }) => {
  const ctxHost = await browser.newContext();
  const ctxGuest = await browser.newContext();
  const host = await ctxHost.newPage();
  const guest = await ctxGuest.newPage();
  const codes: string[] = [];

  try {
    await openHome(host, "Avi");
    const code = await createRoom(host);
    codes.push(code);
    await host.fill("#qpr-input", "1");
    await host.locator("#qpr-input").blur();
    await expect(host.locator("#qpr-input")).toHaveValue("1");

    await openHome(guest, "Babi");
    await joinRoom(guest, code);
    await expect(guest.locator("#lobby-qpr")).toContainText("Questions per round: 1");

    await host.click("#btn-start");
    await expect(host.locator("#screen-game")).toBeVisible();
    await expect(host.locator("#round-group")).toHaveText("1");

    const hostIsGiver = await host.locator("#giver-panel").isVisible();
    const giver = hostIsGiver ? host : guest;
    const guesser = hostIsGiver ? guest : host;
    await giver.fill("#clue-input", "banana");
    await giver.click("#btn-send");
    const dial = guesser.locator("#dial-bar");
    await dial.click({ position: { x: 350, y: 27 } });
    await guesser.click("#btn-lock");
    await expect(host.locator("#reveal-panel")).toBeVisible();
    await expect(host.locator("#btn-next")).toHaveText("Finish round");
    await host.click("#btn-next");

    await expect(host.locator("#screen-summary")).toBeVisible();
    await expect(guest.locator("#screen-summary")).toBeVisible();
    await expect(host.locator("#summary-title")).toHaveText("Round 1 complete!");
    await expect(host.locator("#btn-continue")).toBeVisible();
    await expect(guest.locator("#summary-wait")).toBeVisible();

    const totalBefore = (await host.textContent("#summary-total"))!;
    const room = (await (await fetch(roomUrl(code))).json()).fields;
    const roundScore = num(room.roundScore);
    const guess = num(room.round.mapValue.fields.guess);
    const target = num(room.round.mapValue.fields.target);
    expect(roundScore).toBe(pointsFor(guess, target));
    await host.click("#btn-continue");
    await expect(host.locator("#screen-game")).toBeVisible();
    await expect(host.locator("#round-num")).toHaveText("2");
    await expect(host.locator("#round-group")).toHaveText("2");
    const totalAfter = (await host.textContent("#score"))!;
    expect(totalAfter).toBe(totalBefore.replace("Total score: ", ""));
  } finally {
    for (const c of codes) await deleteRoom(c);
    await ctxHost.close();
    await ctxGuest.close();
  }
});

test("version footer is displayed", async ({ page }: { page: Page }) => {
  await openHome(page, "Avi");
  await expect(page.locator("#version")).toHaveText("1.3.0");
});
