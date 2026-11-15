// The tracker: while the connected radio's default (primary) channel is named
// "aux", broadcast the phone's GPS position on that channel every 10 seconds.
//
// The position itself (every field of the Position message) copies the Meshtastic
// iPhone app's "provide location" feature (Meshtastic-Apple:
// AccessoryManager+Position.swift, Position+WireUnits.swift, LocationsHandler.swift).
// Two things differ on purpose: the interval is 10 seconds, and the packet is
// addressed to everyone on the channel, where the iPhone app addresses it to the
// connected radio only and leaves the broadcasting to the radio's own schedule.
(function () {
  'use strict';
  const INTERVAL_MS = 10000;
  // The radio's firmware throws away a phone position that reaches it less than 10.000 s
  // after the last one it accepted. Bluetooth delivery times wobble, so aiming at exactly
  // 10 s would lose about every other position. Half a second of margin keeps them all.
  const MARGIN_MS = 500;
  const CHECK_MS = 250;
  const CHANNEL_NAME = 'aux';
  const TRACK_UNITS_PER_DEGREE = 100000;      // ground_track is in 1e-5 degrees
  const TRACK_FULL_CIRCLE = 36000000;

  const num = (v) => (v === null || v === undefined || !isFinite(v) ? null : Number(v));

  // The iPhone app's estimate of satellites in view from the fix's accuracy
  // (LocationsHandler.satsInView). Its ranges are whole-number bands with gaps
  // between them (5 < x < 6 and so on), which are kept as they are.
  function satsInView(horizontal, vertical) {
    const h = num(horizontal), v = num(vertical) === null ? -1 : num(vertical);
    if (h === null) return 0;
    const within = (lo, hi) => h >= lo && h <= hi;
    let sats = 1;
    if (v > 0) {
      sats = 4;
      if (within(0, 5)) sats = 12;
      else if (within(6, 15)) sats = 10;
      else if (within(16, 30)) sats = 9;
      else if (within(31, 45)) sats = 7;
      else if (within(46, 60)) sats = 5;
    } else if (v < 0 && within(60, 300)) sats = 3;
    else if (v < 0 && h > 300) sats = 2;
    return sats;
  }

  // The Position message for a phone fix, or null when there is nothing usable
  // (no fix, or 0,0) -- the same cases in which the iPhone app sends nothing.
  //   fix = {latitude, longitude, altitude, accuracy, altitudeAccuracy, heading, speed, timestamp(ms)}
  function buildPosition(fix, nowMs) {
    if (!fix || num(fix.latitude) === null || num(fix.longitude) === null) return null;
    if (fix.latitude === 0 && fix.longitude === 0) return null;
    const p = {
      latitude_i: Math.trunc(fix.latitude * 1e7),
      longitude_i: Math.trunc(fix.longitude * 1e7),
      // The radio sets its clock from `time`, so it is the phone's clock now; the
      // fix can be older when the phone isn't moving, and its time goes in `timestamp`.
      time: Math.floor(nowMs / 1000),
      timestamp: Math.floor(fix.timestamp / 1000),
      altitude: Math.trunc(num(fix.altitude) === null ? 0 : fix.altitude),
      sats_in_view: satsInView(fix.accuracy, fix.altitudeAccuracy),
      location_source: 'LOC_EXTERNAL',
    };
    // Speed and track are optional: left out when the phone has no valid reading; 0 is a reading.
    const speed = num(fix.speed);
    if (speed !== null && speed >= 0) p.ground_speed = Math.round(speed * 3.6);             // m/s -> km/h
    const course = num(fix.heading);
    if (course !== null && course >= 0) p.ground_track = Math.round(course * TRACK_UNITS_PER_DEGREE) % TRACK_FULL_CIRCLE;
    // altitude_hae (height above the ellipsoid) is left unset: a web page is given one
    // altitude only, where the iPhone app has a separate ellipsoidal reading.
    return p;
  }

  // ── running state ─────────────────────────────────────────────────────────
  const listeners = [];
  const T = {
    INTERVAL_MS, MARGIN_MS, CHANNEL_NAME, buildPosition, satsInView,
    paused: false,            // the user pressed Pause
    fix: null,                // newest phone fix
    geoError: '',             // why there is no fix
    lastSent: 0, sentCount: 0, lastPosition: null, sendError: '',
    onChange(fn) { listeners.push(fn); },
  };
  const changed = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

  let watchId = null, timer = 0, wakeLock = null;

  // The radio's default channel is slot 0 (the PRIMARY one).
  T.primaryName = function () {
    const ch = Radio.channels[0];
    return ((ch && ch.settings && ch.settings.name) || '').trim();
  };
  T.auxIsDefault = function () {
    const ch = Radio.channels[0];
    return !!ch && (ch.role || 'DISABLED') === 'PRIMARY' && T.primaryName().toLowerCase() === CHANNEL_NAME;
  };
  T.active = () => Radio.state === 'connected' && T.auxIsDefault() && !T.paused;

  // One line saying what the tracker is doing, and whether that is good.
  T.status = function () {
    if (Radio.state !== 'connected') return { ok: false, text: 'Not connected to a radio.' };
    if (!T.auxIsDefault()) {
      return { ok: false, text: 'Not sending: this radio’s default channel is “' + Radio.channelName(0) +
        '”, not “aux”.' };
    }
    if (T.paused) return { ok: false, text: 'Paused. Location is not being sent.' };
    if (!navigator.geolocation) return { ok: false, text: 'This browser cannot read the phone’s location.' };
    if (!T.fix) return { ok: false, text: T.geoError || 'Waiting for the phone’s GPS…' };
    if (T.sendError) return { ok: false, text: 'Could not send: ' + T.sendError };
    if (!T.sentCount) return { ok: true, text: 'GPS ready. Sending the first position…' };
    return { ok: true, text: 'Broadcasting location on aux every 10 seconds.' };
  };

  // Runs a few times a second; sends as soon as there is a fix and the radio will
  // accept another position. The first one goes out with the first fix.
  let sending = false, lastAttempt = 0;
  async function tick() {
    if (sending || !T.active()) return;
    if (lastAttempt && Date.now() - lastAttempt < INTERVAL_MS + MARGIN_MS) return;
    const position = buildPosition(T.fix, Date.now());
    if (!position) return;
    sending = true;
    try {
      await Radio.sendPosition(position);
      T.lastSent = Date.now(); T.sentCount++; T.lastPosition = position; T.sendError = '';
    } catch (e) {
      T.sendError = (e && e.message) || String(e);
      Radio.logLine('Position not sent: ' + T.sendError);
    }
    lastAttempt = Date.now();          // measured from when the radio had it
    sending = false;
    changed();
  }

  async function holdScreen() {
    try {
      if (navigator.wakeLock && !wakeLock && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) { wakeLock = null; }
  }
  function releaseScreen() {
    try { if (wakeLock) wakeLock.release(); } catch (e) { /* already released */ }
    wakeLock = null;
  }

  function startWatching() {
    if (watchId !== null || !navigator.geolocation) return;
    watchId = navigator.geolocation.watchPosition((pos) => {
      const c = pos.coords;
      T.fix = { latitude: c.latitude, longitude: c.longitude, altitude: c.altitude, accuracy: c.accuracy,
        altitudeAccuracy: c.altitudeAccuracy, heading: c.heading, speed: c.speed, timestamp: pos.timestamp };
      T.geoError = '';
      changed();
    }, (err) => {
      T.geoError = err.code === 1
        ? 'Location permission was refused. Allow location for this page in the browser’s settings, then reconnect.'
        : err.code === 3 ? 'Still waiting for a GPS fix. Move somewhere with a view of the sky.'
          : 'The phone could not get a location (' + (err.message || 'unavailable') + ').';
      if (err.code === 1) T.fix = null;
      changed();
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  }
  function stopWatching() {
    if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  // Start or stop the GPS watch and the sender to match the current state.
  T.sync = function () {
    if (T.active()) {
      startWatching();
      holdScreen();
      if (!timer) timer = setInterval(tick, CHECK_MS);
    } else {
      stopWatching();
      releaseScreen();
      clearInterval(timer); timer = 0;
      if (Radio.state !== 'connected') { T.fix = null; T.sentCount = 0; T.lastSent = 0; T.lastPosition = null; T.sendError = ''; T.geoError = ''; }
    }
    changed();
  };
  T.setPaused = function (paused) { T.paused = !!paused; T.sync(); };

  Radio.on('state', T.sync);
  Radio.on('config', T.sync);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && T.active()) holdScreen(); });

  window.Tracker = T;
})();
