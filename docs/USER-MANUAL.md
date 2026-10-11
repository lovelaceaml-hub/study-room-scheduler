# User Manual

## Reserve a room or other resource

Open https://lvrooms.web.app, choose a day and resource, then tap an open time
or choose **Reserve**. Follow the steps and confirm the details. Your browser
remembers your name on that device. **My reservations** shows the bookings
made from that device, where you can cancel or end an eligible reservation
early.

## View the lobby schedule

Open https://lvrooms.web.app/tv.html. The page shows current room status,
upcoming reservations and the day's timeline. It refreshes automatically.

## Admin

Open https://lvrooms.web.app/admin/ and enter the Admin PIN. Admin can review
and search reservations, add or manage bookings, keep private notes, and
remove old records. Lock the page when finished. The page locks automatically
after inactivity. Do not use a branch preview to make changes because it
connects to the live backend.

## Connection and freshness

The member and Admin pages refresh automatically while open. A booking or
Admin change refreshes immediately. Admin stops background polling while its
page is hidden and refreshes when you return if the data is at least 30
seconds old. The lobby TV refreshes every minute and keeps its last schedule
available when the connection is lost.
