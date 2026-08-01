import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { destinationFor } from "../cutover/redirect.mjs";

test("ordinary legacy visits move to the authenticated LV Zion module", () => {
  assert.equal(destinationFor(""), "https://lvzion.vercel.app/rooms");
  assert.equal(destinationFor("?demo=1"), "https://lvzion.vercel.app/rooms");
});

test("tv=1 legacy displays move to the privacy-filtered lobby", () => {
  assert.equal(destinationFor("?tv=1"), "https://lvzion.vercel.app/rooms/tv");
  assert.equal(destinationFor("?mode=display&tv=1"), "https://lvzion.vercel.app/rooms/tv");
});

test("cutover hosting has no scheduler scripts or Firebase writes", async () => {
  const html = await readFile(new URL("../cutover/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /firebase-config|app\.js|tv\.js|memberCreateBooking|adminBookingAction/);
  assert.match(html, /This page cannot create or change a reservation/);
});
