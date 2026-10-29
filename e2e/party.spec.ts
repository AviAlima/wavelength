import { test, expect, type Page } from "@playwright/test";
import { createRoom, joinRoom, openHome, deleteRoom, roomUrl } from "./helpers";

async function guess(page: Page, value: number) {
  const slider = page.locator("#party-guess");
  await slider.evaluate((node, v) => {
    (node as HTMLInputElement).value = String(v);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
  await page.click("#party-lock");
}

for (const mode of ["cooperative", "competitive"] as const) {
  test(`${mode}: six player locks score once and a full rotation ends the round`, async ({ browser }) => {
    test.setTimeout(300000);
    const size = mode === "competitive" ? 6 : 3;
    const contexts = await Promise.all(Array.from({ length: size }, () => browser.newContext()));
    const pages = await Promise.all(contexts.map((ctx) => ctx.newPage()));
    const host = pages[0];
    let code: string | undefined;
    try {
      await Promise.all(pages.map((p, i) => openHome(p, `Player${i + 1}`)));
      code = await createRoom(host);
      await host.locator(`[data-capacity="${size}"]`).click();
      await expect(host.locator(`[data-capacity="${size}"]`)).toHaveAttribute("aria-pressed", "true");
      await host.locator(`[data-scoring="${mode}"]`).click();
      await expect(host.locator(`[data-scoring="${mode}"]`)).toHaveAttribute("aria-pressed", "true");
      await Promise.all(pages.slice(1).map((p) => joinRoom(p, code!)));
      await expect(host.locator(".player-row")).toHaveCount(size);
      await expect(host.locator('[data-capacity="2"]')).toBeDisabled();
      if (mode === "competitive") {
        const extraContext = await browser.newContext();
        contexts.push(extraContext);
        const extra = await extraContext.newPage();
        await openHome(extra, "Seventh");
        await extra.fill("#join-input", code!);
        const denied = extra.waitForEvent("dialog");
        await extra.click("#btn-join");
        const dialog = await denied;
        expect(dialog.message()).toBe("Room is full");
        await dialog.dismiss();
        await expect(host.locator(".player-row")).toHaveCount(6);
      }
      const read = async () => (await (await fetch(roomUrl(code!))).json()).fields;
      const before = await read();
      const ids = pages.map((_, i) => Object.keys(before.players.mapValue.fields).find((id) => before.players.mapValue.fields[id].mapValue.fields.name.stringValue === `Player${i + 1}`)!);
      await host.click("#btn-start");
      // Full 3-player cooperative lap; six-player competitive checks concurrent locks.
      const turns = mode === "cooperative" ? size : 1;
      for (let turn = 0; turn < turns; turn++) {
        await expect(host.locator("#party-progress")).toContainText(`clue ${turn + 1} of`);
        const state = await read();
        const giverId = state.party.mapValue.fields.round.mapValue.fields.giver.stringValue;
        const giver = pages[ids.indexOf(giverId)];
        await expect(giver.locator("#party-clue")).toBeVisible();
        const target = Number(state.party.mapValue.fields.round.mapValue.fields.target.integerValue);
        await giver.fill("#party-clue", `clue ${turn}`);
        await giver.click("#party-send");
        const guessers = pages.filter((page) => page !== giver);
        await expect(guessers[0].locator("#party-guess")).toBeVisible();
        await guessers[1].locator("#party-guess").focus();
        await guess(guessers[0], target);
        await expect(guessers[0].locator("#party-lock")).toBeDisabled();
        await expect(guessers[1].locator("#party-guess")).toBeFocused();
        await expect(host.locator(".party-reveal")).toHaveCount(0);
        await Promise.all(guessers.slice(1).map((p) => guess(p, target)));
        // Concurrent locks retry on the same Firestore document. A click returns
        // before those transactions commit; allow their bounded retry window.
        await expect(host.locator(".party-reveal")).toBeVisible({ timeout: 30000 });
        await expect(host.locator(".player-guess")).toHaveCount(size - 1);
        const revealed = await read();
        const numeric = (field: { integerValue?: string; doubleValue?: number }) => Number(field.integerValue ?? field.doubleValue);
        expect(numeric(revealed.score)).toBe((turn + 1) * 4);
        const scores = revealed.party.mapValue.fields.scores.mapValue.fields;
        for (const id of ids) expect(numeric(scores[id])).toBe((turn + 1) * 4);
        if (mode === "competitive") {
          await expect(host.locator("#party-scores .party-standing")).toHaveCount(size);
          await host.reload();
          await host.locator("#lang-en").click();
          await host.fill("#join-input", code!);
          await host.click("#btn-join");
          await expect(host.locator(".party-reveal")).toBeVisible();
          expect(numeric((await read()).score)).toBe(4);
        } else {
          await expect(host.locator("#party-scores .party-standing")).toHaveCount(0);
          await host.click("#party-next");
        }
      }
      if (mode === "cooperative") {
        await expect(host.locator("#screen-summary")).toBeVisible();
        await host.click("#btn-continue");
        await expect(host.locator("#party-clue")).toHaveValue("");
        await expect(host.locator("#party-progress")).toContainText("Round 2");
      }
    } finally {
      if (code) await deleteRoom(code);
      await Promise.all(contexts.map((ctx) => ctx.close()));
    }
  });
}
