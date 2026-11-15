# Aux Tracker

A simplified version of Meshtastic Mobile (`Z:\Claude\Meshtastic-Mobile`). It connects to a
Meshtastic radio over Bluetooth and, **when the radio's default (primary) channel is named
"aux"**, broadcasts this phone's GPS position on that channel **every 10 seconds**. It also sends and
receives messages and shows the node list and map, exactly as Meshtastic Mobile does.

**It cannot change any radio setting.** There is no Settings screen, and the code that writes
settings, channels, owner name, or restarts the radio has been removed (`tests.html` checks this).

## How the location is sent

The position data copies the Meshtastic iPhone app's "provide location" feature
(Meshtastic-Apple: `AccessoryManager+Position.swift`, `Position+WireUnits.swift`,
`LocationsHandler.swift`), field for field. The packet that carries it is a broadcast:

| Field | Value |
|-------|-------|
| packet `to` | everyone (broadcast). The iPhone app sends to the connected radio only. |
| packet `channel` | 0, the default channel |
| packet `hop_limit` | the radio's configured hop limit (3 if unset). Without it the firmware keeps a phone broadcast to direct neighbours only. |
| packet `id` | a new random id each time; `want_ack` not set |
| `portnum` | `POSITION_APP`, `want_response` false |
| `latitude_i`, `longitude_i` | degrees x 1e7, truncated |
| `time` | the phone's clock now (the radio sets its clock from it) |
| `timestamp` | when the GPS fix was taken |
| `altitude` | whole metres, 0 when the phone has none |
| `sats_in_view` | the iPhone app's estimate from the fix's accuracy |
| `ground_speed` | km/h, only when the phone reports a speed |
| `ground_track` | 1e-5 degrees, only when the phone reports a course |
| `location_source` | `LOC_EXTERNAL` |

Nothing is sent when there is no fix or the fix is 0,0. The first position goes out with the
first GPS fix.

What the radio does with it (from the firmware source, `PhoneAPI.cpp`, `Router.cpp`,
`PositionModule.cpp`):

- **10-second floor.** The radio discards a phone position that arrives less than 10.000 s
  after the last one it accepted. Bluetooth timing wobbles, so the app spaces sends 10.5 s
  apart (`MARGIN_MS` in `tracker.js`); in practice a position goes out about every 10.5 to 11
  seconds. Aiming at exactly 10 would lose roughly every other one.
- **Channel precision applies.** The radio rounds the position to the aux channel's position
  precision before transmitting, and removes the location entirely when that precision is 0.
- **The radio takes it too.** A broadcast is also applied to the radio itself, so its own
  position and clock follow the phone, unless the radio is set to a fixed position.
- **Airtime.** A position every 10 seconds is heavy traffic. It suits a private aux channel
  with a few radios. In regions with a duty-cycle limit the radio stops transmitting when the
  limit is reached.

Differences from the iPhone app:

- the packet is broadcast to the channel, where the iPhone app gives it to the connected
  radio and lets the radio broadcast on its own schedule;
- the interval is fixed at 10 seconds (the iPhone app's is a setting);
- `altitude_hae` is never set: a web page is given one altitude, not a separate ellipsoidal one;
- a web page only runs while it is open and in front, so tracking stops when the screen locks
  or another app is in front. The app asks the phone to keep the screen on while tracking.

## The "aux" check

Slot 0 must be the PRIMARY channel and its name must be `aux` (any capitalisation, spaces
ignored). A secondary channel named aux does not count. When the check fails the Tracker card
says so and nothing is sent.

## Browsers

Android: Chrome. iPhone: the Bluefy browser (Safari cannot use Bluetooth radios). Allow
location when asked. The page must be served over https.

## Files

| File | What it is |
|------|------------|
| `tracker.js` | the aux check, the GPS watch, the 10-second sender, the position builder |
| `radio.js` | Bluetooth link and client protocol, with all settings-writing code removed |
| `app.js`, `index.html`, `style.css` | the screens: Tracker, Messages, Nodes, Map, Info |
| `proto.js`, `schema.js` | protobuf encode/decode (`schema.js` is generated) |
| `demo.js` | a pretend radio whose default channel is "aux" (`?demo`) |
| `tests.html`, `tests/` | open `tests.html`: position bytes vs the real protobuf library |
| `tools/` | Python generators |

Run locally: `python -m http.server --directory . 8470`, then `http://localhost:8470/?demo`.
After changing any file, bump `CACHE` in `sw.js`.
