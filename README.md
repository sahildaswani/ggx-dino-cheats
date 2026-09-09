# GGX Dino Run — Cheat Panel

A browser cheat panel for **GGX Dino Run** (internal GOGOX multiplayer dino game,
Firebase Realtime Database backend). Injects a draggable overlay with score farming,
coin vacuum, movement hacks, teleport, cross-map kicks, and chat flooding.

> **Disclaimer:** For educational and authorized security-testing purposes only, on a
> system you are permitted to test. Everything here is attributable to your account —
> abuse the chat flood and an admin can (and will) server-side mute you.

## Install

1. Sign in to the game.
2. Open DevTools → **Console**.
3. Paste the entire contents of [`cheat-panel.js`](cheat-panel.js), press Enter.
4. A draggable panel appears top-right. Click **–** to collapse it.

Does not survive a page reload — re-paste after refreshing. For persistence, use
Chrome DevTools → Sources → **Overrides** or a userscript manager.

## Features

| Control | What it does |
|---|---|
| **Farm** | Adds ~4.4 pts/sec through the game's own score-write queue, so every write is indistinguishable from real play. Auto-stops below the admin suspicion thresholds (total 20k / daily 5k). |
| **Coin vacuum** | Coin spawns are deterministic (seeded PRNG per wave) and claiming is a first-come transaction with no proximity check. Claims every sky + cave coin the instant it spawns, map-wide. |
| **Flood chat** | The anti-spam rule throttles *writes*, not *messages* — one multi-path `update()` spends a single 1s throttle slot on 20 messages. |
| **Disco** | Cycles all 4 dino colors every 300ms via the game's own `setChar()` — legit-shaped writes, but your dino strobes on everyone's screen. The last color becomes your saved character. |
| **Speed slider** | ×1–8 run speed. Hooks the frame loop after physics and re-boosts `me.vx` (the `RUN` const is frozen, but velocity state is mutable). |
| **Jump slider** | ×1–3 jump power (height scales with the square: ×2 ≈ 14 tiles). Detects the takeoff frame and swaps in a bigger `me.vy`. |
| **Chat as…** | Impersonation: type a name, hit **Set**, and everything you send through the normal chat box goes out under that name. Empty + Set restores your real name. See below for why this works. |
| **TP** | Teleports to any x coordinate. Positions are self-reported; the DB can't validate physics. |
| **Kick selected** | Kicks any online player from any range — the 26px range check lives only in the button handler, not in the network call. |

## Why these work

The game has no server: all logic runs in the browser and every write goes straight to
Firebase RTDB, so the security rules are the only gate. A patch added content
validation (uid/name pinning, message types, inventory) and write throttling — but:

- **Throttles count writes, not messages** → batch-write bypass.
- **Positions are self-reported** → teleport, speed, jump, and cross-map kicks are
  unfixable in rules alone.
- **Score writes can't be bound to real gameplay in rules** → paced farming passes.
- **Display names are client-chosen and never stored server-side** — the rules can pin
  `uid === auth.uid` (that's what killed fake-uid stun-locks), but there is no server-side
  record of your name to compare a message against → impersonation survives. Note the side
  effects: score/farm writes and system messages also carry the spoofed name, and mentions
  of the spoofed name ping your client.

### Fixed by the patch (RIP)

- Free shop items via direct inventory writes
- Fake admin notices
- Stun-locking via fake uids (also: victim-side kick dedup)

## Proper fixes (for the game maintainers)

1. Move chat/order/score writes behind Cloud Functions; treat RTDB rules as a
   secondary layer, not the gate.
2. Have the *victim's* client validate kicker distance before playing the launch.
3. Validate coin claims server-side against the deterministic spawn schedule
   (claim time must be ≥ spawn time, one claim per coin, sane claim rate).
4. Pin display names server-side: write `dino/profiles/{uid}/name` once at join
   (validated for length/charset), then have chat rules require
   `msg.name === profiles/{auth.uid}/name`.
