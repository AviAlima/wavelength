import { expect, type Page } from "@playwright/test";

export const roomUrl = (code: string) =>
  `https://firestore.googleapis.com/v1/projects/wavelength-pal/databases/(default)/documents/rooms/${code}`;

export async function deleteRoom(code: string) {
  await fetch(roomUrl(code), { method: "DELETE" });
}

export async function openHome(page: Page, nick: string) {
  await page.goto("/");
  await page.fill("#nick-input", nick);
}

export async function createRoom(page: Page): Promise<string> {
  await page.click("#btn-create");
  await page.waitForSelector("#screen-lobby:not([hidden])");
  const code = (await page.textContent("#lobby-code"))!.trim();
  expect(code).toMatch(/^[A-Z0-9]{5}$/);
  return code;
}

export async function joinRoom(page: Page, code: string) {
  await page.fill("#join-input", code);
  await page.click("#btn-join");
  await page.waitForSelector("#screen-lobby:not([hidden])");
}
