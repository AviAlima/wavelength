import { expect, type Page } from "@playwright/test";

export const roomUrl = (code: string) =>
  `https://firestore.googleapis.com/v1/projects/wavelength-pal/databases/(default)/documents/rooms/${code}`;

export async function deleteRoom(code: string) {
  await fetch(roomUrl(code), { method: "DELETE" });
}

export async function openHome(page: Page, nick: string) {
  await page.goto("/");
  await page.locator("#lang-en").click();
  await page.fill("#nick-input", nick);
}

export async function createRoom(
  page: Page,
  keepOnly: string[] | null = null,
  opts: { collective?: boolean } = {},
): Promise<string> {
  await page.click("#btn-create");
  await page.waitForSelector("#screen-cats:not([hidden])");
  if (keepOnly) {
    for (const cb of await page.locator("#cat-list input").all()) {
      const val = await cb.getAttribute("value");
      if (val && !keepOnly.includes(val)) await cb.uncheck();
    }
  }
  await page.click("#btn-create-cats");
  await page.waitForSelector("#screen-lobby:not([hidden])");
  const code = (await page.textContent("#lobby-code"))!.trim();
  expect(code).toMatch(/^[A-Z0-9]{5}$/);
  const roomCollective = async () =>
    ((await (await fetch(roomUrl(code))).json()).fields.collective as { booleanValue?: boolean } | undefined)?.booleanValue ?? true;
  const toggle = page.locator("#collective-toggle");
  if (opts.collective === true) {
    if (!(await toggle.isChecked())) await toggle.check();
    await expect.poll(roomCollective).toBe(true);
  } else {
    if (await toggle.isChecked()) await toggle.uncheck();
    await expect.poll(roomCollective).toBe(false);
  }
  return code;
}

export async function joinRoom(page: Page, code: string) {
  await page.fill("#join-input", code);
  await page.click("#btn-join");
  await page.waitForSelector("#screen-lobby:not([hidden])");
}
