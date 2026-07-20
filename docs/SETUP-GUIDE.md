# LV Zion Study Rooms — Setup Guide

## Current status

The shorter address and revised scheduler are **Live** at
**https://lvrooms.web.app**.

The previous address, **https://lvz-rooms.web.app**, remains available and sends
visitors to the shorter address automatically.

The mobile, scheduling, TV, and demo update was deployed and live-verified on July 20,
2026. The current branch's simplified Home, compact reservation rows, and study-room
TV layout are awaiting a separate deployment and verification.

## Open the member app

1. Open Safari, Chrome, or another current web browser.
2. Go to **https://lvrooms.web.app**.
3. The app opens without an account screen. It quietly identifies the device so each
   member can manage only their own new requests.
4. To make a request, open **Reservations**, use the arrows to choose Tuesday or
   Saturday, select Study room, Whiteboard, or TV, and open Morning, Afternoon, or
Evening. Tap the time side of a compact connected row, answer **When should it end?**
with the exact ending, tap **Continue**, and complete the short name-and-purpose form.
Tap the attached availability side instead when you want to inspect who has rooms or
which requests are pending.

The member app has no separate **Sign up** screen. The time menus are divided around
service periods, which cannot be selected. On the current branch, Home begins with a
live Day overview split into expandable Morning, Afternoon, and Evening sections, then
shows the scrollable update feed. Tapping an open Home slot takes the member straight to
Reservations with that time ready for an end-time choice.

## Install it on an iPhone

1. Open **https://lvrooms.web.app** in **Safari**.
2. Tap the **Share** button—the square with the upward arrow.
3. Scroll down and tap **Add to Home Screen**.
4. Leave the name as **Study Rooms**, then tap **Add**.
5. Open the new Study Rooms icon from the Home Screen.

If an older version was installed from the previous address, remove that Home Screen
icon after the new site is live, then repeat the steps above using the shorter address.

## Install it on an Android phone

1. Open **https://lvrooms.web.app** in **Chrome**.
2. Tap the three-dot menu in the upper-right corner.
3. Tap **Install app** or **Add to Home screen**.
4. Tap **Install** or **Add** to confirm.
5. Open Study Rooms from the Home Screen or app drawer.

## Set up the lobby TV

The lobby screen does not require an Admin unlock.

1. Turn on the TV and the device that provides its web browser.
2. Open the browser.
3. Go to **https://lvrooms.web.app/?tv=1**.
4. Put the browser into full-screen mode if the TV device offers that option.
5. Confirm that the upper-right status reads **Live**.
6. Choose the Tuesday or Saturday to display with the TV day setting, then leave the
   page open. It updates automatically when requests are submitted, approved, declined,
   or cancelled.

Confirm that the selected date and study-room availability cards agree with the
approved-reservation timeline. The current-time marker appears only when the TV is
showing today. Pending requests and Whiteboard/TV lanes do not appear on the lobby TV.

If the TV loses internet access, the last received schedule stays visible and the
status changes to **Reconnecting**. It returns to **Live** after data reconnects.

## Share the right links

- Members: **https://lvrooms.web.app**
- Lobby TV: **https://lvrooms.web.app/?tv=1**
- Previous bookmarks: **https://lvz-rooms.web.app** redirects to the new address

The TV link is meant for a public lobby screen. It abbreviates names and hides private
request and Admin details.

## Preview the filled mock schedule

For a safe walkthrough before using a real reservation, add `?demo=1` to the member
address. The filled TV demo is available at `?tv=1&demo=1`. Mock rooms, approved
study-room bookings, service bands, and cancellations stay in that browser and are never
written to the live schedule.

## Admin access

The Admin PIN remains **0000**. Enter it on the Admin tab only on a trusted device.
The app verifies it through a protected backend service and grants a short-lived
Admin session. Tap **Lock admin** when the work is finished.

## If something looks out of date

1. Check that the address begins with **https://lvrooms.web.app**.
2. Refresh the page once.
3. If the schedule is still connecting, wait a moment and refresh once.
4. If an old Home Screen installation continues showing the previous design, remove
   its icon and install again from the shorter address.
