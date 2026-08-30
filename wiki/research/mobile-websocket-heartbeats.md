---
title: "Mobile Browser WebSocket Heartbeats Specification & Analysis"
source_title: "Mobile Browser WebSocket Heartbeats Specification & Analysis"
repository: "CIC Architecture & Research Archive - Accession 65, Box 69"
document_date: "2026-08-23"
verification_status: "verified"
category: "willow-run"
topic: mobile-websocket-heartbeats
status: active
last_updated: 2026-08-23T02:19:45.926Z
sourceRepository: kb-sync
---
# Mobile Browser WebSocket Heartbeats

Mobile operating systems heavily throttle background JS intervals (e.g., locking `setInterval` to 1 ping/minute or pausing it entirely). 

To ensure liveness under **Workstream H**:
1. Leverage the **Page Visibility API** to trigger immediate reconnection and ping when the user focuses the page.
2. Store WebSocket backoff state in a persistent client cookie or local storage to resist sleep cycles.
