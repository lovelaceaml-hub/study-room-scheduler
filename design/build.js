#!/usr/bin/env node
'use strict';
/* Assembles the Claude Design card pages: wraps each card fragment with the
   shared tokens + component styles so every card is self-contained.
   Run: node design/build.js  ->  writes design/cards/<name>.html */

const fs = require('node:fs');
const path = require('node:path');

const here = __dirname;
const tokens = fs.readFileSync(path.join(here, 'tokens.css'), 'utf8');
const components = fs.readFileSync(path.join(here, 'components.css'), 'utf8');

const CARDS = {
  'foundations': {
    group: 'Foundations',
    title: 'Tokens — color, type, shape',
    body: `
<div class="wrap">
  <h1>LV Zion Study Rooms</h1>
  <p class="hint">Crisp &amp; efficient · one sans family · light and dark follow the phone. Toggle your system theme to preview both.</p>
  <div class="card"><h2>Accent &amp; neutrals</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px">
      ${[
        ['--primary', 'Primary', '#2F52D9 / #7E97FF'],
        ['--bg', 'Background', '#F5F6F8 / #101216'],
        ['--surface', 'Surface', '#FFFFFF / #191C22'],
        ['--line', 'Border', '#E2E5EB / #2A2F39'],
        ['--ink', 'Ink', '#171A20 / #E9EBEF'],
        ['--ink-soft', 'Ink soft', '#4E5666 / #ADB4C0']
      ].map(([v, label, hex]) => `
      <div style="border:1px solid var(--line);border-radius:10px;overflow:hidden">
        <div style="height:56px;background:var(${v})"></div>
        <div style="padding:7px 9px;font-size:12px"><strong>${label}</strong><br><span style="color:var(--ink-faint)">${hex}</span></div>
      </div>`).join('')}
    </div>
  </div>
  <div class="card"><h2>Status colors</h2>
    <p class="hint">The four reservation states stay distinguishable in both themes.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <span class="badge status-approved">&#10003; Approved</span>
      <span class="badge" style="background:var(--info-tint);color:var(--info)">&#9670; Tentative</span>
      <span class="badge status-waiting">In line — 2nd</span>
      <span class="badge status-pending">Pending review</span>
      <span class="badge status-declined">Declined</span>
    </div>
  </div>
  <div class="card"><h2>Type scale</h2>
    <div style="font-size:var(--fs-title);font-weight:800;letter-spacing:-0.02em">Reserve a study room — 26</div>
    <div style="font-size:var(--fs-xl);font-weight:800">Section title — 22</div>
    <div style="font-size:var(--fs-lg);font-weight:700">Card heading — 17</div>
    <div style="font-size:var(--fs-md)">Body text — 15</div>
    <div style="font-size:var(--fs-sm);color:var(--ink-soft)">Secondary — 13.5</div>
    <div style="font-size:var(--fs-xs);color:var(--ink-faint);font-weight:700;text-transform:uppercase;letter-spacing:.06em">Label — 12</div>
  </div>
</div>`
  },

  'buttons-forms': {
    group: 'Components',
    title: 'Buttons & form fields',
    body: `
<div class="wrap">
  <div class="card"><h2>Buttons</h2>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <button class="btn primary">Send request</button>
      <button class="btn">Cancel</button>
      <button class="btn danger">Decline</button>
      <button class="btn small">Small</button>
      <button class="btn primary" disabled>Submitting…</button>
    </div>
  </div>
  <div class="card"><h2>Form fields</h2>
    <div class="fld">Your name</div>
    <input type="text" value="Anthony" placeholder="Full name">
    <div class="fld">Purpose</div>
    <div class="need-row">
      <button class="purpose-chip active">Contact</button>
      <button class="purpose-chip">New Member</button>
      <button class="purpose-chip">Meeting</button>
      <button class="purpose-chip">Other</button>
    </div>
    <div class="fld">Certainty</div>
    <div class="need-row">
      <button class="certainty-btn confirmed active">Confirmed</button>
      <button class="certainty-btn tentative">Tentative</button>
    </div>
  </div>
  <div class="card"><h2>Admin PIN gate</h2>
    <div class="lock-title">Admin is locked</div>
    <p class="hint">Enter the admin PIN to approve or decline requests.</p>
    <div class="pin-row"><input type="password" value="1234" placeholder="PIN"><button class="btn primary">Unlock</button></div>
    <p class="pin-error">Incorrect Admin PIN.</p>
  </div>
</div>`
  },

  'header-tabs': {
    group: 'Components',
    title: 'Header, tabs & date selector',
    body: `
<header id="masthead"><div class="head-in">
  <div class="head-brand"><span class="head-title">LV Zion Study Rooms</span><span class="head-date">Saturday, July 18 selected</span></div>
  <span class="sync-pill">Live</span>
</div>
<div class="tabs">
  <button class="tab active">Reservations</button>
  <button class="tab">My reservations</button>
  <button class="tab">Admin</button>
</div></header>
<div class="wrap">
  <div class="card"><h2>Choose a day</h2>
    <div class="date-selector">
      <button class="date-choice saturday active"><span class="date-choice-day">Saturday</span><span class="date-choice-date">July 18</span></button>
      <button class="date-choice tuesday"><span class="date-choice-day">Tuesday</span><span class="date-choice-date">July 21</span></button>
    </div>
  </div>
  <div class="card"><h2>Resource toggle</h2>
    <div class="member-resource-toggle">
      <button class="member-resource active">Study room</button>
      <button class="member-resource">Whiteboard</button>
      <button class="member-resource">TV</button>
    </div>
  </div>
  <div class="card"><h2>Sync states</h2>
    <div style="display:flex;gap:16px"><span class="sync-pill">Live</span><span class="sync-pill off">Reconnecting</span></div>
  </div>
</div>`
  },

  'calendar': {
    group: 'Components',
    title: 'Reservation calendar grid',
    body: `
<div class="wrap">
  <p class="calendar-help">Tap a time to reserve 30 minutes. Tap a later time to make your reservation longer.</p>
  <div class="member-calendar-scroll">
    <div class="member-calendar-row unit-header">
      <div class="member-time"><small>Select a time</small><span>Time</span></div>
      <div class="member-squares" style="--capacity:4"><span>1</span><span>2</span><span>3</span><span>4</span></div>
    </div>
    <div class="member-service"><span>Morning service</span><span>9:00 AM–10:00 AM</span></div>
    <div class="member-calendar-row">
      <button class="member-time selectable">10:00 AM</button>
      <div class="member-squares" style="--capacity:4">
        <div class="member-square taken booking-start">Anthony · Contact</div>
        <div class="member-square taken booking-start">Skye · New Member</div>
        <div class="member-square"></div>
        <div class="member-square"></div>
      </div>
    </div>
    <div class="member-calendar-row">
      <button class="member-time selectable">10:30 AM</button>
      <div class="member-squares" style="--capacity:4">
        <div class="member-square taken booking-end"></div>
        <div class="member-square taken booking-middle"></div>
        <div class="member-square pending"></div>
        <div class="member-square pending"></div>
      </div>
    </div>
    <div class="member-calendar-row">
      <button class="member-time selectable selected">11:00 AM</button>
      <div class="member-squares" style="--capacity:4">
        <div class="member-square selected"></div>
        <div class="member-square selected"></div>
        <div class="member-square taken booking-end"></div>
        <div class="member-square mine">Yours</div>
      </div>
    </div>
    <div class="member-calendar-row">
      <button class="member-time selectable">11:30 AM</button>
      <div class="member-squares" style="--capacity:4">
        <div class="member-square"></div>
        <div class="member-square cancelled"></div>
        <div class="member-square"></div>
        <div class="member-square"></div>
      </div>
    </div>
  </div>
  <div class="member-selection-summary">
    <span><strong>11:00 AM–11:30 AM</strong> · Study room</span>
    <button class="btn primary">Continue</button>
  </div>
  <div class="card" style="margin-top:18px"><h2>Legend</h2>
    <div style="display:grid;gap:6px;font-size:var(--fs-sm)">
      <span><span style="display:inline-block;width:16px;height:16px;border-radius:4px;background:var(--surface-sunken);vertical-align:-3px"></span> Reserved by someone</span>
      <span><span style="display:inline-block;width:16px;height:16px;border-radius:4px;border:1.5px dashed var(--warn);vertical-align:-3px"></span> Requested — awaiting approval</span>
      <span><span style="display:inline-block;width:16px;height:16px;border-radius:4px;background:var(--ok-tint);border:1px solid var(--ok);vertical-align:-3px"></span> Your reservation</span>
      <span><span style="display:inline-block;width:16px;height:16px;border-radius:4px;background:var(--primary-tint);border:1px solid var(--primary);vertical-align:-3px"></span> Your current selection</span>
    </div>
  </div>
</div>`
  },

  'booking-sheet': {
    group: 'Components',
    title: 'Booking bottom sheet',
    body: `
<div class="modal-backdrop" style="position:relative;min-height:640px;align-items:flex-end">
  <section class="booking-dialog">
    <div class="booking-dialog-head">
      <div><div class="booking-kicker">Sat, Jul 18</div><h2>Request this time</h2></div>
      <button class="modal-close">&times;</button>
    </div>
    <p class="booking-time-summary"><strong>Study room</strong> · 11:00 AM–11:30 AM</p>
    <p class="hint booking-approval-hint">Saturday requests go to the approver first — check My reservations for the decision.</p>
    <div class="fld">Your name</div>
    <input type="text" value="Anthony" placeholder="Full name">
    <div class="fld">Purpose</div>
    <div class="need-row">
      <button class="purpose-chip active">Contact</button>
      <button class="purpose-chip">New Member</button>
      <button class="purpose-chip">Meeting</button>
      <button class="purpose-chip">Other</button>
    </div>
    <div class="modal-actions"><button class="btn">Cancel</button><button class="btn primary">Send request</button></div>
  </section>
</div>`
  },

  'lists-feed': {
    group: 'Components',
    title: 'Schedule updates & my reservations',
    body: `
<div class="wrap">
  <section class="activity-feed">
    <div class="activity-title">Schedule updates</div>
    <div class="activity-table">
      <div class="activity-row activity-head"><span>Update</span><span>Member</span><span>Purpose</span><span>Start</span><span>End</span></div>
      <div class="activity-row approved"><span><strong>Reserved Study Room 1</strong></span><span>Sister Grace</span><span>Group study</span><span>10:00 AM</span><span>11:00 AM</span></div>
      <div class="activity-row pending"><span><strong>Requested TV</strong></span><span>Brother Daniel</span><span>Contact</span><span>1:00 PM</span><span>1:30 PM</span></div>
      <div class="activity-row cancelled"><span><strong>Cancelled Whiteboard 2</strong></span><span>Sister Hana</span><span>Meeting</span><span>4:00 PM</span><span>4:30 PM</span></div>
    </div>
  </section>
  <div class="approval-notice"><strong>You’re approved.</strong> Study Room 2 · 11:00 AM–12:00 PM</div>
  <div class="card"><h2>Your requests</h2>
    <div class="req-row">
      <div class="req-head">Study room <span class="badge status-approved">Approved — Study Room 2</span></div>
      <div class="req-sub">11:00 AM–12:00 PM · Group study</div>
      <div class="req-actions"><a href="#" class="cancel-link">Plans changed? Cancel</a></div>
    </div>
    <div class="req-row">
      <div class="req-head">TV <span class="badge status-waiting">In line — 2nd</span></div>
      <div class="req-sub">1:00 PM–1:30 PM · Contact</div>
      <div class="req-actions"><a href="#" class="cancel-link">Plans changed? Cancel</a></div>
    </div>
    <div class="req-row">
      <div class="req-head">Whiteboard <span class="badge status-declined">Declined</span></div>
      <div class="req-sub">4:00 PM–4:30 PM · Meeting</div>
    </div>
  </div>
</div>`
  },

  'admin-queue': {
    group: 'Components',
    title: 'Admin pending queue',
    body: `
<div class="wrap">
  <div class="card">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
      <h2 style="margin:0">Admin</h2>
      <button class="btn small danger">Lock admin</button>
    </div>
    <p class="section-note" style="margin-top:8px">Approve or decline requests, review the day, add bookings directly.</p>
  </div>
  <div class="card"><h2>Pending requests</h2>
    <div class="req-row">
      <div class="req-head">Sister Grace <span class="badge-cert confirmed">&#10003;</span> <span class="badge status-pending">Pending review</span></div>
      <div class="req-sub">Study room · 11:00 AM–12:00 PM · Group study · asked Jul 16 at 7:12 PM</div>
      <div class="fld">Assign a room</div>
      <div class="assign-row">
        <button class="assign-chip active recommended">Room 1</button>
        <button class="assign-chip">Room 2</button>
        <button class="assign-chip" disabled>Room 3 — taken</button>
        <button class="assign-chip">Room 4</button>
      </div>
      <div class="modal-actions" style="justify-content:flex-start">
        <button class="btn primary">Approve</button>
        <button class="btn danger">Decline</button>
      </div>
    </div>
    <div class="pending-lane" style="margin-top:14px">
      <div class="pending-lane-title">Requested — awaiting approval</div>
      <div style="font-size:var(--fs-sm)">Brother Daniel · TV · 1:00 PM–1:30 PM</div>
    </div>
  </div>
</div>`
  },

  'tv-board': {
    group: 'Lobby TV',
    title: 'Lobby TV board (16:9)',
    body: `
<div style="width:960px;height:540px;background:var(--bg);display:flex;flex-direction:column;overflow:hidden">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:20px 28px 12px">
    <div>
      <div style="font-size:13px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--primary)">Lobby schedule</div>
      <div style="font-size:34px;font-weight:800;letter-spacing:-0.02em">Study Rooms</div>
      <div style="color:var(--ink-faint);font-size:15px">Saturday, July 18, 2026</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:40px;font-weight:800;letter-spacing:-0.02em">3:36 PM</div>
      <span class="sync-pill">Live</span>
    </div>
  </div>
  <div style="flex:1;margin:0 28px 14px;background:var(--surface);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow-card);padding:18px 22px;display:grid;grid-template-columns:1fr 1fr;gap:8px 26px;align-content:start">
    ${[
      ['Study Room 1', 'Sister Grace · Group study', '10:00–11:00 AM', 'ok'],
      ['Study Room 2', 'Anthony · Contact', '11:00–11:30 AM', 'ok'],
      ['Whiteboard 1', 'Brother Daniel · Meeting', '1:00–1:30 PM', 'warn'],
      ['TV 2', 'Sister Hana · New Member', '4:00–4:30 PM', 'ok']
    ].map(([unit, who, time, kind]) => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 4px;border-bottom:1px solid var(--line)">
      <div style="display:flex;align-items:center;gap:12px;min-width:0">
        <span style="width:10px;height:10px;border-radius:50%;background:var(--${kind});flex:none"></span>
        <div style="min-width:0"><div style="font-weight:800;font-size:19px">${unit}</div>
        <div style="color:var(--ink-soft);font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${who}</div></div>
      </div>
      <div style="font-weight:700;font-size:17px;white-space:nowrap">${time}</div>
    </div>`).join('')}
  </div>
  <div style="display:flex;justify-content:space-between;padding:0 28px 16px;color:var(--ink-faint);font-size:13px">
    <span>Approved reservations</span>
    <span><span style="color:var(--ok)">&#9679;</span> Assigned &nbsp; <span style="color:var(--warn)">&#9679;</span> Awaiting approval</span>
  </div>
</div>`
  }
};

const outDir = path.join(here, 'cards');
fs.mkdirSync(outDir, { recursive: true });
for (const [name, card] of Object.entries(CARDS)) {
  const html = `<!-- @dsCard group="${card.group}" -->
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${card.title}</title>
<style>
${tokens}
${components}
body { padding-bottom: 20px; }
</style>
</head>
<body>
${card.body}
</body>
</html>`;
  fs.writeFileSync(path.join(outDir, `${name}.html`), html);
  console.log('built', name + '.html');
}
