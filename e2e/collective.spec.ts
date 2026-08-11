import { test, expect, type Page } from "@playwright/test";
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

async function sendClue(page: Page, clue: string) {
  const card = page.locator("#collect-list .q-card").first();
  await card.locator("input").fill(clue);
  await card.locator("button.btn.primary").click();
}

async function lockGuess(page: Page, x: number) {
  const card = page.locator("#collect-list .q-card").first();
  await card.locator(".dial-bar").click({ position: { x, y: 27 } });
  await card.locator("button.btn.primary").click();
}

test("up-front flow: spectra one at a time, turns alternate, review plays back on both screens", async ({ browser }) => {
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

    // clue stage — one spectrum at a time, secret target marked
    await expect(host.locator("#collect-progress")).toHaveText("Spectrum 1 of 1 — write a clue");
    await expect(host.locator("#collect-list .q-card .marker.target")).toHaveCount(1);
    await expect(host.locator("#collect-list .q-card .badge")).toHaveText(/Target: \d+/);
    await sendClue(host, "sunny");
    await expect(host.locator("#collect-done")).toContainText(/waiting for Babi/i);

    await expect(guest.locator("#collect-progress")).toHaveText("Spectrum 1 of 2 — write a clue");
    await sendClue(guest, "spicy");
    await expect(guest.locator("#collect-progress")).toHaveText("Spectrum 2 of 2 — write a clue");
    await sendClue(guest, "hot");

    // guessing — host first, then alternating question by question
    await expect(host.locator("#collect-title")).toHaveText("Your turn — guess the targets", { timeout: 15000 });
    await expect(host.locator("#collect-progress")).toHaveText("Guessing 1 of 2");
    await expect(host.locator("#collect-list .q-card .clue-box")).toContainText("spicy");
    await expect(guest.locator("#waiting-title")).toHaveText("Avi is answering…");
    await expect(guest.locator(".waiting-dots span")).toHaveCount(3);

    await lockGuess(host, 350);

    // guest's turn — one question
    await expect(guest.locator("#collect-title")).toHaveText("Your turn — guess the targets", { timeout: 15000 });
    await expect(guest.locator("#collect-progress")).toHaveText("Guessing 1 of 1");
    await expect(host.locator("#waiting-title")).toHaveText("Babi is answering…");
    await lockGuess(guest, 200);

    // back to the host — the second question
    await expect(host.locator("#collect-title")).toHaveText("Your turn — guess the targets", { timeout: 15000 });
    await expect(host.locator("#collect-progress")).toHaveText("Guessing 2 of 2");
    await expect(guest.locator("#waiting-title")).toHaveText("Avi is answering…");
    await lockGuess(host, 400);

    // review — host-driven, one question at a time, no auto-advance
    await expect(host.locator("#collect-title")).toHaveText("Review — how close were you?", { timeout: 15000 });
    await expect(guest.locator("#collect-title")).toHaveText("Review — how close were you?");
    await expect(host.locator("#collect-progress")).toHaveText("Review 1 of 3");
    await expect(guest.locator("#collect-progress")).toHaveText("Review 1 of 3");
    await expect(guest.getByRole("button", { name: "Next" })).toHaveCount(0);
    await expect(guest.getByRole("button", { name: "Skip review" })).toHaveCount(0);

    // stays put without the host
    await host.waitForTimeout(4200);
    await expect(host.locator("#collect-progress")).toHaveText("Review 1 of 3");
    await expect(guest.locator("#collect-progress")).toHaveText("Review 1 of 3");

    await host.getByRole("button", { name: "Next" }).click();
    await expect(host.locator("#collect-progress")).toHaveText("Review 2 of 3");
    await expect(guest.locator("#collect-progress")).toHaveText("Review 2 of 3");
    await host.getByRole("button", { name: "Next" }).click();
    await expect(host.locator("#collect-progress")).toHaveText("Review 3 of 3");
    await expect(guest.locator("#collect-progress")).toHaveText("Review 3 of 3");
    await host.getByRole("button", { name: "Finish review" }).click();

    // summary with accumulated score matching the DB
    await expect(host.locator("#screen-summary")).toBeVisible({ timeout: 15000 });
    await expect(guest.locator("#screen-summary")).toBeVisible();
    await expect(host.locator("#summary-round")).toContainText("3 questions played");

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
    await expect(host.locator("#collect-round")).toHaveText("Round 2");
    await expect(host.locator("#collect-progress")).toHaveText("Spectrum 1 of 1 — write a clue");
    await expect(guest.locator("#collect-progress")).toHaveText("Spectrum 1 of 2 — write a clue");

    const room2 = (await (await fetch(roomUrl(code))).json()).fields;
    expect(Number(room2.score.integerValue ?? room2.score.doubleValue)).toBe(expected);
  } finally {
    for (const c of codes) await deleteRoom(c);
    await ctxHost.close();
    await ctxGuest.close();
  }
});

test("each player can skip two spectra; skipped spectra are dropped", async ({ browser }) => {
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
    await host.locator("#collect-list .q-card button.btn:not(.primary)").click();
    await expect(host.locator("#skip-dots .skip-dot:not(.used)")).toHaveCount(1);
    await expect(host.locator("#collect-progress")).toHaveText("You skipped all of yours");
    await expect(host.locator("#collect-done")).toContainText(/waiting for Babi/i);

    await expect(guest.locator("#collect-progress")).toHaveText("Spectrum 1 of 2 — write a clue");
    await guest.locator("#collect-list .q-card button.btn:not(.primary)").click();
    await expect(guest.locator("#collect-progress")).toHaveText("Spectrum 1 of 1 — write a clue");
    await guest.locator("#collect-list .q-card button.btn:not(.primary)").click();
    await expect(guest.locator("#collect-progress")).toHaveText("You skipped all of yours");

    // every spectrum skipped — review has nothing to show
    await expect(host.locator("#collect-title")).toHaveText("Review — how close were you?", { timeout: 15000 });
    await expect(host.locator("#collect-progress")).toHaveText("No questions this round");
    await expect(host.getByRole("button", { name: "See results" })).toBeVisible();
    await host.getByRole("button", { name: "See results" }).click();

    await expect(host.locator("#screen-summary")).toBeVisible({ timeout: 15000 });
    await expect(host.locator("#summary-round")).toContainText("0 questions played");
    await expect(host.locator("#summary-total")).toContainText("Total score: 0");
  } finally {
    for (const c of codes) await deleteRoom(c);
    await ctxHost.close();
    await ctxGuest.close();
  }
});
