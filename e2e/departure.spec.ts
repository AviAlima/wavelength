import { test, expect } from "@playwright/test";
import { createRoom, joinRoom, openHome, deleteRoom } from "./helpers";

for (const who of ["host", "guest"] as const) {
  test(`only the remaining player is notified when the ${who} leaves a running game`, async ({ browser }) => {
    const a = await browser.newContext();
    const b = await browser.newContext();
    const host = await a.newPage();
    const guest = await b.newPage();
    let code: string | undefined;
    const hostAlerts: string[] = [];
    const guestAlerts: string[] = [];
    host.on("dialog", async (dialog) => { hostAlerts.push(dialog.message()); await dialog.dismiss(); });
    guest.on("dialog", async (dialog) => { guestAlerts.push(dialog.message()); await dialog.dismiss(); });
    try {
      await openHome(host, "Avi");
      code = await createRoom(host);
      await openHome(guest, "Babi");
      await joinRoom(guest, code);
      await host.click("#btn-start");
      await expect(host.locator("#screen-game")).toBeVisible();
      await expect(guest.locator("#screen-game")).toBeVisible();
      const leaving = who === "host" ? host : guest;
      const remaining = who === "host" ? guest : host;
      await leaving.click("#btn-leave-game");
      await leaving.click("#btn-confirm-leave");
      await expect(leaving.locator("#screen-home")).toBeVisible();
      await expect(remaining.locator("#screen-home")).toBeVisible();
      expect(who === "host" ? hostAlerts : guestAlerts).toEqual([]);
      expect(who === "host" ? guestAlerts : hostAlerts).toEqual(["Another player left and the party closed."]);
    } finally {
      if (code) await deleteRoom(code);
      await Promise.all([a.close(), b.close()]);
    }
  });
}

test("a lobby guest leaving only notifies the host and keeps the room open", async ({ browser }) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const host = await a.newPage();
  const guest = await b.newPage();
  let code: string | undefined;
  const alerts: string[] = [];
  guest.on("dialog", async (dialog) => { alerts.push(dialog.message()); await dialog.dismiss(); });
  try {
    await openHome(host, "Avi");
    code = await createRoom(host);
    await openHome(guest, "Babi");
    await joinRoom(guest, code);
    await expect(host.locator(".player-row")).toHaveCount(2);
    await guest.click("#btn-leave");
    await guest.click("#btn-confirm-leave");
    await expect(guest.locator("#screen-home")).toBeVisible();
    await expect(host.locator("#lobby-departure")).toHaveText("Babi left the party.");
    await expect(host.locator("#screen-lobby")).toBeVisible();
    await expect(host.locator(".player-row")).toHaveCount(1);
    expect(alerts).toEqual([]);
  } finally {
    if (code) await deleteRoom(code);
    await Promise.all([a.close(), b.close()]);
  }
});
