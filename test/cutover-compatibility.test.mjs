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

// ——— Section 8: retirement shell + service-worker cache retirement.
// Built and verified here; DEPLOYED ONLY at the Section 9 cutover.

test("the retirement service worker exists at the live worker's own scope", async () => {
  // Same URL (/sw.js) as the live app's worker, so cached clients replace it.
  const retirement = await readFile(new URL("../cutover/sw.js", import.meta.url), "utf8");
  assert.match(retirement, /skipWaiting\(\)/);
  assert.match(retirement, /caches\.keys\(\)/);
  assert.match(retirement, /caches\.delete\(key\)/);
  assert.match(retirement, /registration\.unregister\(\)/);
  assert.match(retirement, /clients\.claim\(\)/);
  // No fetch handler and no precache list: nothing keeps the old app alive.
  assert.doesNotMatch(retirement, /addEventListener\(['"]fetch/);
  assert.doesNotMatch(retirement, /addAll|ASSETS/);
});

test("the retirement worker retires the live cache-version ladder", async () => {
  const live = await readFile(new URL("../sw.js", import.meta.url), "utf8");
  const cacheName = live.match(/const CACHE = '([^']+)'/)?.[1];
  assert.ok(cacheName?.startsWith("srs-v"), "live worker keeps its srs-v* cache version");
  const retirement = await readFile(new URL("../cutover/sw.js", import.meta.url), "utf8");
  // The retirement worker names the ladder in prose but never opens a cache.
  assert.match(retirement, /srs-v13/);
  assert.doesNotMatch(retirement, /caches\.open/);
});

test("the cutover hosting config serves the shell, worker, and redirect with no-store", async () => {
  const config = JSON.parse(await readFile(new URL("../firebase.cutover.json", import.meta.url), "utf8"));
  const hosting = config.hosting[0];
  assert.equal(hosting.target, "app");
  assert.equal(hosting.public, "cutover");
  const headerValues = hosting.headers.flatMap(entry => entry.headers.map(header => `${header.key}: ${header.value}`));
  assert.ok(headerValues.includes("Cache-Control: no-store"));
  // The rewrite must not shadow the real files: Firebase serves an existing
  // file before applying rewrites, and these three files must all exist.
  for (const file of ["index.html", "sw.js", "redirect.mjs"]) {
    await readFile(new URL(`../cutover/${file}`, import.meta.url));
  }
});

test("the LIVE hosting config never publishes the retirement worker or the freeze tool", async () => {
  // firebase.json target `app` deploys the repository root. Until Section 9,
  // an ordinary hosting deploy must not put cutover/sw.js (which purges every
  // cache origin-wide once registered) or tools/freeze.mjs at a public URL.
  const live = JSON.parse(await readFile(new URL("../firebase.json", import.meta.url), "utf8"));
  const appTarget = live.hosting.find(entry => entry.target === "app");
  for (const pattern of ["cutover/**", "tools/**", "AGENTS.md", "firebase.cutover.json"]) {
    assert.ok(appTarget.ignore.includes(pattern), `firebase.json must ignore ${pattern}`);
  }
  // And the SECTION 9 config publishes all of cutover/, so the admin freeze
  // tool must never live inside that directory.
  await assert.rejects(readFile(new URL("../cutover/freeze.mjs", import.meta.url)));
});
