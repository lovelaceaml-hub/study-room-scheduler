#!/usr/bin/env node

// Flip the server-enforced Study Rooms write kill switch (`app/writeFreeze`).
//
// SECTION 8 (rehearsal): run ONLY against the Firestore emulator. The tool
// refuses production unless BOTH production guards below are deliberately
// provided, and flipping production is a Section 9 cutover-runbook action
// that needs Anthony's explicit go.
//
// Usage (emulator — FIRESTORE_EMULATOR_HOST must be set):
//   node tools/freeze.mjs --status
//   node tools/freeze.mjs --freeze --reason "Cutover rehearsal"
//   node tools/freeze.mjs --unfreeze
//
// Production (SECTION 9 ONLY — never in rehearsal):
//   STUDY_ROOMS_FREEZE_CONFIRM=lvz-rooms node tools/freeze.mjs \
//     --freeze --allow-production --project lvz-rooms --reason "LV Zion cutover"
//
// Rollback is the same tool: --unfreeze restores writes immediately; the
// document stays (with frozen: false) as evidence of the flip and release.

import { createRequire } from "node:module";

const require = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { FREEZE_COLLECTION, FREEZE_DOCUMENT, freezeStateFrom } = require("../functions/lib/freeze.js");

function parseArguments(argv) {
  const options = {
    action: null,
    allowProduction: false,
    project: null,
    reason: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--status" || argument === "--freeze" || argument === "--unfreeze") {
      if (options.action) throw new Error("Choose exactly one of --status, --freeze, --unfreeze.");
      options.action = argument.slice(2);
    } else if (argument === "--allow-production") options.allowProduction = true;
    else if (argument === "--project") options.project = argv[++index] ?? null;
    else if (argument === "--reason") options.reason = argv[++index] ?? "";
    else throw new Error(`Unsupported option: ${argument}`);
  }
  if (!options.action) throw new Error("Choose one of --status, --freeze, --unfreeze.");
  return options;
}

function requireSafeTarget(options) {
  const emulator = process.env.FIRESTORE_EMULATOR_HOST || "";
  if (emulator) return { mode: "emulator", detail: emulator };
  if (!options.allowProduction) {
    throw new Error(
      "FIRESTORE_EMULATOR_HOST is not set. This tool runs against the emulator "
      + "during rehearsal. Production flips are a Section 9 cutover action and "
      + "require --allow-production, --project lvz-rooms, and "
      + "STUDY_ROOMS_FREEZE_CONFIRM=lvz-rooms.",
    );
  }
  if (options.project !== "lvz-rooms" || process.env.STUDY_ROOMS_FREEZE_CONFIRM !== "lvz-rooms") {
    throw new Error(
      "Production flip refused: pass --project lvz-rooms and set "
      + "STUDY_ROOMS_FREEZE_CONFIRM=lvz-rooms to confirm the target.",
    );
  }
  return { mode: "production", detail: "lvz-rooms" };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const target = requireSafeTarget(options);
  initializeApp(options.project ? { projectId: options.project } : undefined);
  const db = getFirestore();
  const ref = db.collection(FREEZE_COLLECTION).doc(FREEZE_DOCUMENT);

  if (options.action === "status") {
    const state = freezeStateFrom(await ref.get());
    console.log(`Target: ${target.mode} (${target.detail})`);
    console.log(`Writes frozen: ${state.frozen}${state.reason ? ` — ${state.reason}` : ""}`);
    return;
  }

  const frozen = options.action === "freeze";
  await ref.set({
    frozen,
    reason: options.reason || (frozen ? "Study Rooms cutover freeze" : ""),
    changedAt: FieldValue.serverTimestamp(),
    changedBy: "tools/freeze.mjs",
  });
  console.log(`Target: ${target.mode} (${target.detail})`);
  console.log(`Writes frozen: ${frozen}`);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
