import { test, expect } from "@playwright/test";
import { createRoom, joinRoom, deleteRoom, openHome, roomUrl } from "./helpers";

const num = (v: Record<string, string> | undefined): number =>
  Number(v?.doubleValue ?? v?.integerValue);

function pointsFor(target: number, guess: number): number {
  const d = Math.abs(target - guess);
  if (d < 6) return 4;
  if (d < 12) return 3;
  if (d < 20) return 2;
  if (d < 30) return 1;
  return 0;
}

async function sendClue(page: import("@playwright/test").Page, cardIdx: number, clue: string) {
  const card = page.locator("#collect-list .q-card").nth(cardIdx);
  await card.locator("input").fill(clue);
  await card.locator("button.btn.primary").click();
}

async function lockGuess(page: import("@playwright/test").Page, cardIdx: number, x: number) {
  const card = page.locator("#collect-list .q-card").nth(cardIdx);
  await card.locator(".dial-bar").click({ position: { x, y: 27 } });
  await card.locator("button.btn.primary").click();
}

test("up-front flow: each player sees the fixed target and writes clues, guesses on the partner's targets, then a shared summary reveals all", async ({ browser }) => {
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
    await expect(guest.locator("#lobby-collective")).toContainText("all spectra up front");

    await host.click("#btn-start");
    await expect(host.locator("#screen-collect")).toBeVisible();
    await expect(guest.locator("#screen-collect")).toBeVisible();

    await expect(host.locator("#collect-title")).toContainText("write a clue");
    await expect(host.locator("#collect-progress")).toHaveText("Clues 0 of 2");
    await expect(guest.locator("#collect-progress")).toHaveText("Clues 0 of 1");

    const hostCards = host.locator("#collect-list .q-card");
    await expect(hostCards).toHaveCount(2);
    await expect(host.locator("#collect-list .q-card .marker.target")).toHaveCount(2);
    await expect(host.locator("#collect-list .q-card .badge").first()).toHaveText(/Target: \d+/);
    const guestCards = guest.locator("#collect-list .q-card");
    await expect(guestCards).toHaveCount(1);
    await expect(guest.locator("#collect-list .q-card .marker.target")).toHaveCount(1);

    await sendClue(host, 0, "sunny");
    await sendClue(host, 1, "beach");
    await sendClue(guest, 0, "spicy");

    await expect(host.locator("#collect-title")).toHaveText("Guess the targets — use your partner's clues", { timeout: 15000 });
    await expect(guest.locator("#collect-title")).toHaveText("Guess the targets — use your partner's clues");

    await expect(host.locator("#collect-progress")).toHaveText("Guesses 0 of 1");
    await expect(guest.locator("#collect-progress")).toHaveText("Guesses 0 of 2");
    await expect(host.locator("#collect-list .q-card .clue-box").first()).toContainText("spicy");
    await expect(guest.locator("#collect-list .q-card .clue-box").first()).toContainText("sunny");

    await lockGuess(host, 0, 350);
    await lockGuess(guest, 0, 200);
    await lockGuess(guest, 1, 400);

    await expect(host.locator("#screen-summary")).toBeVisible({ timeout: 15000 });
    await expect(guest.locator("#screen-summary")).toBeVisible();
    await expect(host.locator("#summary-round")).toContainText("3 questions played");
    await expect(host.locator("#summary-playback .q-card")).toHaveCount(3);
    await expect(host.locator("#summary-playback .q-card .marker.target.reveal")).toHaveCount(3);

    const room = (await (await fetch(roomUrl(code))).json()).fields;
    const items = Object.values(room.setup.mapValue.fields.q.mapValue.fields) as Record<string, string>[];
    let expected = 0;
    for (const it of items) {
      const f = it.mapValue.fields;
      expected += pointsFor(num(f.target), num(f.answer));
    }
    const dbScore = Number(room.score.integerValue ?? room.score.doubleValue);
    expect(dbScore).toBe(expected);
    await expect(host.locator("#summary-total")).toContainText("Total score: " + expected);

    await host.click("#btn-continue");
    await expect(host.locator("#screen-collect")).toBeVisible();
    await expect(host.locator("#collect-round")).toHaveText("Round 2");
    await expect(host.locator("#collect-list .q-card")).toHaveCount(2);

    const room2 = (await (await fetch(roomUrl(code))).json()).fields;
    expect(Number(room2.score.integerValue ?? room2.score.doubleValue)).toBe(expected);
  } finally {
    for (const c of codes) await deleteRoom(c);
    await ctxHost.close();
    await ctxGuest.close();
  }
});

test("each player can skip two spectra (dots deplete); skipped spectra are dropped", async ({ browser }) => {
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
    await host.locator("#collect-list .q-card").first().locator("button.btn:not(.primary)").click();
    await expect(host.locator("#skip-dots .skip-dot:not(.used)")).toHaveCount(1);
    await host.locator("#collect-list .q-card").first().locator("button.btn:not(.primary)").click();
    await expect(host.locator("#skip-dots .skip-dot:not(.used)")).toHaveCount(0);
    await expect(host.locator("#collect-list .q-card")).toHaveCount(0);
    await expect(host.locator("#collect-progress")).toHaveText("You skipped all of yours");

    await sendClue(guest, 0, "sweet");

    await expect(host.locator("#collect-title")).toHaveText("Guess the targets — use your partner's clues", { timeout: 15000 });
    await expect(host.locator("#collect-progress")).toHaveText("Guesses 0 of 1");
    await expect(guest.locator("#collect-progress")).toHaveText("Nothing to guess on your side");

    await lockGuess(host, 0, 260);

    await expect(host.locator("#screen-summary")).toBeVisible({ timeout: 15000 });
    await expect(host.locator("#summary-round")).toContainText("1 questions played");
    await expect(host.locator("#summary-playback .q-card")).toHaveCount(1);
  } finally {
    for (const c of codes) await deleteRoom(c);
    await ctxHost.close();
    await ctxGuest.close();
  }
});
