// Aux Tracker: the screens. radio.js talks to the radio; tracker.js sends the phone's position.
// There is no settings screen: this app never changes a radio's configuration.
(function () {
  'use strict';
  const APP_VERSION = '1.0.0';
  const $ = (id) => document.getElementById(id);
  const BROADCAST = Radio.BROADCAST;

  // ── small DOM helpers ─────────────────────────────────────────────────────
  function h(tag, attrs) {
    const el = document.createElement(tag);
    Object.keys(attrs || {}).forEach((k) => {
      const v = attrs[k];
      if (v === undefined || v === null) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k in el) el[k] = v;
      else el.setAttribute(k, v);
    });
    for (let i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) kid.forEach((k) => add(el, k));
    else el.appendChild(typeof kid === 'object' ? kid : document.createTextNode(String(kid)));
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

  let toastTimer = 0;
  function toast(text) {
    const t = $('toast');
    t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }
  function busy(text) {
    $('busy').hidden = !text;
    $('busyText').textContent = text || '';
  }
  let sheetResolve = null;
  function openSheet(content) {
    clear($('sheet')).appendChild(content);
    $('sheetWrap').hidden = false;
    $('sheet').scrollTop = 0;
  }
  function closeSheet(result) {
    $('sheetWrap').hidden = true;
    clear($('sheet'));
    if (sheetResolve) { const r = sheetResolve; sheetResolve = null; r(result === undefined ? -1 : result); }
  }
  $('sheetWrap').addEventListener('click', (e) => { if (e.target === $('sheetWrap')) closeSheet(); });
  // A question with buttons; resolves to the index of the button pressed (-1 if dismissed).
  function ask(title, body, buttons) {
    if (sheetResolve) closeSheet();
    return new Promise((resolve) => {
      const box = h('div', {}, h('h2', { text: title }),
        typeof body === 'string' ? h('pre', { text: body }) : body,
        (buttons || [{ label: 'OK', cls: 'primary' }]).map((b, i) =>
          h('button', { class: 'wide ' + (b.cls || ''), text: b.label, onclick: () => closeSheet(i) })));
      openSheet(box);
      sheetResolve = resolve;
    });
  }
  const tell = (title, text) => ask(title, text, [{ label: 'OK', cls: 'primary' }]);

  function ago(secs) {
    if (!secs) return 'never';
    const d = Math.max(0, Math.floor(Date.now() / 1000) - secs);
    if (d < 60) return 'now';
    if (d < 3600) return Math.floor(d / 60) + 'm ago';
    if (d < 86400) return Math.floor(d / 3600) + 'h ago';
    return Math.floor(d / 86400) + 'd ago';
  }
  const pad2 = (n) => String(n).padStart(2, '0');
  function clock(ms) {
    const d = new Date(ms), today = new Date();
    const time = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    return d.toDateString() === today.toDateString() ? time : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + time;
  }
  function miles(a, b) {
    const R = 3958.8, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function batteryText(m) {
    if (!m || m.battery_level === undefined) return '';
    const volts = m.voltage ? ' (' + m.voltage.toFixed(2) + ' V)' : '';
    return (m.battery_level > 100 ? 'Plugged in' : m.battery_level + '%') + volts;
  }
  const same = (type, a, b) => JSON.stringify(PB.toJSON(type, a || {})) === JSON.stringify(PB.toJSON(type, b || {}));
  const connected = () => Radio.state === 'connected';
  const isDemo = () => !!(Radio.transport && Radio.transport.kind === 'demo');

  // ── tabs ──────────────────────────────────────────────────────────────────
  let currentTab = 'radio';
  function showTab(name) {
    currentTab = name;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
    document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    if (name === 'messages') { openConversation(convKey); }
    if (name === 'nodes') renderNodes();
    if (name === 'map') showMap();
    if (name === 'info') renderInfo();
  }
  document.querySelectorAll('#nav button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

  // ── Radio tab ─────────────────────────────────────────────────────────────
  function browserHelp() {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return h('div', { class: 'card warn' },
      h('h2', { text: 'This browser can’t use Bluetooth radios' }),
      ios
        ? [h('p', { text: 'On iPhone and iPad, Safari and Chrome do not allow web pages to use Bluetooth. Install the free “Bluefy – Web BLE Browser” app from the App Store, then open this same page address in Bluefy.' }),
          h('p', { class: 'muted small', text: 'Page address: ' + location.href.split('?')[0] })]
        : h('p', { text: 'Open this page in Chrome on Android, or in Chrome or Edge on a PC. Firefox and Samsung Internet do not support Web Bluetooth. The page must be loaded over https.' }),
      h('p', { class: 'muted small', text: 'You can still look around with the demo radio below.' }));
  }

  function renderRadio() {
    const tab = clear($('tab-radio'));
    const badge = $('linkBadge');
    const me = Radio.me();
    const user = (me && me.user) || {};
    badge.className = 'badge ' + (connected() ? 'on' : Radio.state === 'disconnected' ? 'off' : 'busy-b');
    badge.textContent = connected() ? (user.short_name || 'Connected') + (isDemo() ? ' (demo)' : '')
      : Radio.state === 'disconnected' ? 'Not connected'
        : Radio.state === 'rebooting' ? 'Reconnecting…' : 'Connecting…';

    const banner = $('banner');
    const unset = connected() && ['UNSET', undefined].includes((Radio.config.lora || {}).region);
    if (Radio.state === 'rebooting') { banner.hidden = false; banner.textContent = Radio.statusText; }
    else if (unset) { banner.hidden = false; banner.textContent = 'This radio has no LoRa region set, so it cannot transmit. This app does not change radio settings: set the region with the Meshtastic app or the PC program.'; }
    else banner.hidden = true;

    if (Radio.state === 'disconnected') {
      if (!BleTransport.supported()) tab.appendChild(browserHelp());
      tab.appendChild(h('div', { class: 'card' },
        h('h2', { text: 'Connect to a radio' }),
        h('p', { class: 'muted', text: 'Turn the radio on and keep it close. If the phone asks for a pairing PIN, it is the 6-digit number on the radio’s screen (123456 on radios without a screen, unless you changed it).' }),
        Radio.statusText ? h('p', { class: 'hint bad', text: Radio.statusText }) : null,
        h('button', { class: 'primary wide', text: 'Connect by Bluetooth', disabled: !BleTransport.supported(), onclick: connectBle }),
        h('button', { class: 'wide', text: 'Try the demo radio', onclick: connectDemo }),
        h('p', { class: 'muted small', style: 'margin-top:12px', text: 'Only one app can hold a radio’s Bluetooth link at a time: close the Meshtastic app (or the PC program’s Bluetooth connection) first.' })));
      tab.appendChild(aboutTrackerCard());
      return;
    }
    if (!connected()) {
      tab.appendChild(h('div', { class: 'card' },
        h('h2', { text: Radio.state === 'rebooting' ? 'Reconnecting' : 'Connecting' }),
        h('div', { class: 'spinner' }),
        h('p', { text: Radio.statusText || 'Working…' }),
        h('p', { class: 'muted small', text: 'Bluetooth can take a minute, and reading a full node list takes longer. Be patient.' }),
        h('button', { class: 'wide', text: 'Cancel', onclick: () => Radio.disconnect() })));
      return;
    }
    tab.appendChild(trackerCard());
    const lora = Radio.config.lora || {};
    const meta = Radio.metadata || {};
    const pos = Radio.position(me);
    const rows = [
      ['Name', (user.long_name || '?') + ' (' + (user.short_name || '?') + ')'],
      ['Node ID', Radio.nodeId(Radio.myNum)],
      ['Hardware', String(user.hw_model || meta.hw_model || '?')],
      ['Firmware', meta.firmware_version || '?'],
      ['Role', String((Radio.config.device || {}).role || 'CLIENT')],
      ['Region', String(lora.region || 'UNSET')],
      ['Modem', lora.use_preset ? String(lora.modem_preset || 'LONG_FAST') : 'Custom'],
      ['Default channel', Radio.channelName(0)],
      ['Battery', batteryText(me && me.device_metrics) || 'not reported yet'],
      ['Position', pos ? pos.lat.toFixed(5) + ', ' + pos.lon.toFixed(5) : 'none'],
      ['Nodes known', String(Radio.nodes.size)],
      ['Link', Radio.transport.kind + (Radio.transport.name ? ' – ' + Radio.transport.name : '')],
    ];
    tab.appendChild(h('div', { class: 'card' },
      h('h2', { text: 'Radio' }),
      h('dl', { class: 'kv' }, rows.map((r) => [h('dt', { text: r[0] }), h('dd', { text: r[1] })])),
      h('button', { class: 'wide', text: 'Disconnect', onclick: () => Radio.disconnect() })));
    if (isDemo()) {
      tab.appendChild(h('div', { class: 'card warn' }, h('p', { style: 'margin:0', text: 'This is the built-in demo radio. Nothing here is real and nothing is transmitted. Its default channel is named “aux”, so the tracker runs.' })));
    }
  }

  async function connectBle() {
    const t = new BleTransport();
    try { await t.pick(); } catch (e) {
      if (e && e.name === 'NotFoundError') return;         // chooser closed
      tell('Bluetooth', Radio.describeError(e));
      return;
    }
    try { await Radio.connect(t); } catch (e) { tell('Could not connect', e.message); }
  }
  async function connectDemo() {
    try { await Radio.connect(new DemoTransport()); } catch (e) { tell('Demo', e.message); }
  }

  // ── Messages ──────────────────────────────────────────────────────────────
  let msgs = [];
  let unread = {};
  let convKey = 'c0';
  const msgStoreKey = () => 'auxtracker.msgs.' + Radio.nodeId(Radio.myNum);

  function loadMsgs() {
    try { msgs = JSON.parse(localStorage.getItem(msgStoreKey()) || '[]'); } catch (e) { msgs = []; }
    msgs.forEach((m) => { if (m.status === 'sending') m.status = 'unknown'; });
    unread = {};
  }
  function saveMsgs() {
    if (!Radio.myNum || isDemo()) return;
    if (msgs.length > 400) msgs = msgs.slice(-400);
    try { localStorage.setItem(msgStoreKey(), JSON.stringify(msgs)); } catch (e) { /* storage full */ }
  }
  function convTitle(key) {
    return key[0] === 'c' ? '# ' + Radio.channelName(+key.slice(1)) : Radio.nodeName(+key.slice(1));
  }
  function conversations() {
    const keys = [];
    Radio.channels.forEach((ch, i) => { if (ch && (ch.role || 'DISABLED') !== 'DISABLED') keys.push('c' + i); });
    if (!keys.length) keys.push('c0');
    msgs.forEach((m) => { if (!keys.includes(m.key)) keys.push(m.key); });
    if (!keys.includes(convKey)) keys.push(convKey);
    return keys;
  }
  function renderConvBar() {
    const bar = clear($('convBar'));
    conversations().forEach((key) => {
      bar.appendChild(h('button', { class: key === convKey ? 'active' : '', onclick: () => openConversation(key) },
        convTitle(key), unread[key] ? h('span', { class: 'n', text: unread[key] }) : null));
    });
    $('unreadDot').hidden = !Object.values(unread).some(Boolean);
  }
  function statusLabel(m) {
    switch (m.status) {
      case 'sending': return 'Sending…';
      case 'sent': return 'Sent';
      case 'delivered': return 'Delivered';
      case 'relayed': return 'Sent, not yet confirmed by the recipient';
      case 'noack': return 'No acknowledgement';
      case 'unknown': return '';
      default: return m.status ? 'Failed: ' + m.status : '';
    }
  }
  function renderMsgs() {
    const list = clear($('msgList'));
    const mine = msgs.filter((m) => m.key === convKey);
    if (!mine.length) list.appendChild(h('p', { class: 'empty', text: connected() ? 'No messages here yet.' : 'Connect to a radio to send and receive messages.' }));
    mine.forEach((m) => {
      const st = m.out ? statusLabel(m) : '';
      const failed = m.out && !['sending', 'sent', 'delivered', 'relayed', 'unknown'].includes(m.status);
      list.appendChild(h('div', { class: 'msg' + (m.out ? ' out' : '') },
        !m.out && convKey[0] === 'c' ? h('div', { class: 'who', text: Radio.nodeName(m.from) }) : null,
        m.text,
        h('div', { class: 'meta' + (failed ? ' fail' : ''), text: clock(m.time) + (st ? ' · ' + st : '') })));
    });
    list.scrollTop = list.scrollHeight;
    $('msgSend').disabled = !connected();
    $('msgInput').placeholder = 'Message ' + convTitle(convKey);
  }
  function openConversation(key) {
    convKey = key;
    unread[key] = 0;
    renderConvBar();
    renderMsgs();
  }
  function startDirect(num) {
    showTab('messages');
    openConversation('d' + num);
    $('msgInput').focus();
  }

  Radio.on('message', (m) => {
    const key = m.to === BROADCAST ? 'c' + m.channel : 'd' + m.from;
    msgs.push({ key, id: m.id, from: m.from, to: m.to, text: m.text, time: m.time, out: false });
    saveMsgs();
    if (currentTab === 'messages' && key === convKey) renderMsgs();
    else {
      unread[key] = (unread[key] || 0) + 1;
      toast(Radio.nodeName(m.from) + ': ' + m.text.slice(0, 80));
      if (navigator.vibrate) navigator.vibrate(120);
    }
    renderConvBar();
  });
  Radio.on('ack', (a) => {
    const m = msgs.find((x) => x.out && x.id === a.id);
    if (!m) return;
    if (!a.ok) m.status = a.reason;
    else if (m.to === BROADCAST) m.status = 'sent';
    else m.status = a.from === m.to ? 'delivered' : (m.status === 'delivered' ? 'delivered' : 'relayed');
    saveMsgs();
    if (currentTab === 'messages' && m.key === convKey) renderMsgs();
  });

  $('msgForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('msgInput').value.trim();
    if (!text || !connected()) return;
    const dm = convKey[0] === 'd';
    const to = dm ? +convKey.slice(1) : BROADCAST;
    const channel = dm ? 0 : +convKey.slice(1);
    try {
      const id = await Radio.sendText(text, to, channel);
      const m = { key: convKey, id, from: Radio.myNum, to, text, time: Date.now(), out: true, status: 'sending' };
      msgs.push(m);
      $('msgInput').value = '';
      $('msgInput').style.height = '';
      saveMsgs(); renderConvBar(); renderMsgs();
      setTimeout(() => {
        if (m.status === 'sending') { m.status = 'noack'; saveMsgs(); if (m.key === convKey) renderMsgs(); }
      }, 90000);
    } catch (err) { toast(err.message); }
  });
  $('msgInput').addEventListener('input', () => {
    const t = $('msgInput');
    t.style.height = 'auto';
    t.style.height = Math.min(110, t.scrollHeight + 2) + 'px';
  });
  $('msgInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); $('msgForm').requestSubmit(); }
  });

  // ── Nodes ─────────────────────────────────────────────────────────────────
  function nodeRows() {
    const myPos = Radio.position(Radio.me());
    return Array.from(Radio.nodes.values()).map((n) => {
      const pos = Radio.position(n);
      const user = n.user || {};
      return { n, num: n.num >>> 0, pos, user,
        long: user.long_name || Radio.nodeId(n.num), short: user.short_name || '?',
        dist: myPos && pos && n.num !== Radio.myNum ? miles(myPos, pos) : null };
    });
  }
  function renderNodes() {
    if (currentTab !== 'nodes') return;
    const list = clear($('nodeList'));
    const q = $('nodeSearch').value.trim().toLowerCase();
    const sort = $('nodeSort').value;
    let rows = nodeRows();
    const total = rows.length;
    if (q) rows = rows.filter((r) => (r.long + ' ' + r.short + ' ' + Radio.nodeId(r.num) + ' ' + (r.user.hw_model || '')).toLowerCase().includes(q));
    const big = (v) => (v === null || v === undefined ? Infinity : v);
    rows.sort((a, b) => {
      if (a.num === Radio.myNum) return -1;
      if (b.num === Radio.myNum) return 1;
      switch (sort) {
        case 'name': return a.long.localeCompare(b.long);
        case 'distance': return big(a.dist) - big(b.dist);
        case 'snr': return (b.n.snr === undefined ? -999 : b.n.snr) - (a.n.snr === undefined ? -999 : a.n.snr);
        case 'hops': return big(a.n.hops_away) - big(b.n.hops_away);
        default: return (b.n.last_heard || 0) - (a.n.last_heard || 0);
      }
    });
    $('nodeCount').textContent = connected()
      ? (q ? rows.length + ' of ' + total : total) + ' nodes in the radio’s list'
      : 'Connect to a radio to see its node list.';
    rows.forEach((r) => {
      const mine = r.num === Radio.myNum;
      const sub = [String(r.user.role || ''), String(r.user.hw_model || '')].filter(Boolean).join(' · ') || Radio.nodeId(r.num);
      list.appendChild(h('button', { class: 'node' + (mine ? ' me' : ''), onclick: () => nodeSheet(r.num) },
        h('span', { class: 'chip', text: r.short }),
        h('span', { class: 'mid' }, h('div', { class: 'name', text: r.long }), h('div', { class: 'sub', text: sub })),
        h('span', { class: 'right' },
          h('b', { text: mine ? 'This radio' : ago(r.n.last_heard) }),
          mine ? batteryText(r.n.device_metrics).split(' (')[0]
            : [r.dist !== null ? r.dist.toFixed(1) + ' mi' : null,
              r.n.snr !== undefined && r.n.snr !== 0 ? r.n.snr.toFixed(1) + ' dB' : null,
              r.n.hops_away !== undefined ? r.n.hops_away + ' hop' + (r.n.hops_away === 1 ? '' : 's') : null]
              .filter(Boolean).slice(0, 2).join(' · '))));
    });
  }
  let nodesTimer = 0;
  function nodesChanged() {
    if (nodesTimer) return;
    nodesTimer = setTimeout(() => {
      nodesTimer = 0;
      renderNodes();
      if (currentTab === 'map') updateMarkers(false);
      if (currentTab === 'radio') renderRadio();
    }, 400);
  }
  $('nodeSearch').addEventListener('input', renderNodes);
  $('nodeSort').addEventListener('change', renderNodes);

  function nodeSheet(num) {
    const n = Radio.nodes.get(num);
    if (!n) return;
    const user = n.user || {}, pos = Radio.position(n), myPos = Radio.position(Radio.me());
    const mine = num === Radio.myNum;
    const heard = n.last_heard ? new Date(n.last_heard * 1000) : null;
    const rows = [
      ['Short name', user.short_name || '?'],
      ['Node ID', Radio.nodeId(num)],
      ['Hardware', String(user.hw_model || '?')],
      ['Role', String(user.role || 'CLIENT')],
      ['Last heard', mine ? 'this radio' : heard ? heard.toLocaleDateString() + ' ' + pad2(heard.getHours()) + ':' + pad2(heard.getMinutes()) + ' (' + ago(n.last_heard) + ')' : 'never'],
      ['Signal (SNR)', n.snr !== undefined && !mine ? n.snr.toFixed(2) + ' dB' : '—'],
      ['Hops away', n.hops_away !== undefined && !mine ? String(n.hops_away) : '—'],
      ['Channel', Radio.channelName(n.heard_channel !== undefined ? n.heard_channel : (n.channel || 0))],
      ['Battery', batteryText(n.device_metrics) || '—'],
      ['Position', pos ? pos.lat.toFixed(5) + ', ' + pos.lon.toFixed(5) + (pos.alt ? ' (' + pos.alt + ' m)' : '') : 'none'],
      ['Distance', pos && myPos && !mine ? miles(myPos, pos).toFixed(1) + ' mi' : '—'],
      ['Heard via', n.via_mqtt ? 'MQTT (internet)' : 'radio'],
    ];
    openSheet(h('div', {},
      h('h2', { text: user.long_name || Radio.nodeId(num) }),
      h('dl', { class: 'kv' }, rows.map((r) => [h('dt', { text: r[0] }), h('dd', { text: r[1] })])),
      !mine && !user.is_unmessagable ? h('button', { class: 'primary wide', text: 'Send a direct message', onclick: () => { closeSheet(); startDirect(num); } }) : null,
      pos ? h('button', { class: 'wide', text: 'Show on map', onclick: () => { closeSheet(); showTab('map'); focusNode(num); } }) : null,
      h('button', { class: 'wide', text: 'Close', onclick: () => closeSheet() })));
  }

  // ── Map (Leaflet + Esri street tiles, same as the desktop program) ───────
  const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/';
  const TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
  let map = null, markers = new Map(), leafletLoading = null, pendingFocus = null;

  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (leafletLoading) return leafletLoading;
    leafletLoading = new Promise((resolve, reject) => {
      document.head.appendChild(h('link', { rel: 'stylesheet', href: LEAFLET + 'leaflet.css' }));
      document.head.appendChild(h('script', { src: LEAFLET + 'leaflet.js', onload: resolve,
        onerror: () => { leafletLoading = null; reject(new Error('The map needs an internet connection.')); } }));
    });
    return leafletLoading;
  }
  async function showMap() {
    try { await loadLeaflet(); } catch (e) { $('mapNote').textContent = e.message; return; }
    if (!map) {
      map = L.map('map', { zoomControl: true }).setView([27.95, -82.5], 9);
      L.tileLayer(TILES, { maxZoom: 19, attribution: 'Tiles © Esri' }).addTo(map);
    }
    setTimeout(() => { map.invalidateSize(); updateMarkers(!pendingFocus); if (pendingFocus) focusNode(pendingFocus); }, 50);
  }
  function updateMarkers(fit) {
    if (!map) return;
    const seen = new Set(), points = [];
    Radio.nodes.forEach((n) => {
      const pos = Radio.position(n);
      if (!pos) return;
      const num = n.num >>> 0, mine = num === Radio.myNum;
      seen.add(num); points.push([pos.lat, pos.lon]);
      let m = markers.get(num);
      if (!m) {
        m = L.circleMarker([pos.lat, pos.lon], { radius: mine ? 10 : 8, weight: 2, color: '#0a1929',
          fillColor: mine ? '#ff9f1c' : '#2ec4b6', fillOpacity: 0.95 }).addTo(map);
        m.on('click', () => nodeSheet(num));
        markers.set(num, m);
      } else m.setLatLng([pos.lat, pos.lon]);
      const label = (n.user && n.user.short_name) || Radio.nodeId(num).slice(-4);
      if (m.labelText !== label) {
        m.unbindTooltip();
        m.bindTooltip(document.createTextNode(label).textContent, { permanent: true, direction: 'top', offset: [0, -8], className: 'node-label' });
        m.labelText = label;
      }
    });
    markers.forEach((m, num) => { if (!seen.has(num)) { m.remove(); markers.delete(num); } });
    $('mapNote').textContent = connected()
      ? points.length + ' of ' + Radio.nodes.size + ' nodes have reported a position. Orange is this radio.'
      : 'Connect to a radio to see its nodes on the map.';
    if (fit && points.length) map.fitBounds(points, { padding: [40, 40], maxZoom: 14 });
  }
  function focusNode(num) {
    pendingFocus = num;
    const m = markers.get(num);
    if (!map || !m) return;
    pendingFocus = null;
    map.setView(m.getLatLng(), Math.max(map.getZoom(), 13));
  }

  // ── Tracker card (on the Tracker tab) ─────────────────────────────────────
  function aboutTrackerCard() {
    return h('div', { class: 'card' },
      h('h2', { text: 'What this app does' }),
      h('p', { class: 'muted', text: 'When the connected radio’s default channel is named “aux”, Aux Tracker broadcasts this phone’s GPS position on that channel every 10 seconds, using the same position data the Meshtastic iPhone app sends. It also sends and receives messages and shows the nodes and the map.' }),
      h('p', { class: 'muted small', style: 'margin:0', text: 'It cannot change any radio setting. Keep this page open and the screen on while tracking.' }));
  }
  function fixAge(ms) {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    return s < 2 ? 'just now' : s < 90 ? s + ' s ago' : Math.round(s / 60) + ' min ago';
  }
  function radioPositionNotes() {
    const pc = Radio.config.position || {};
    const ch = Radio.channels[0] || {};
    const precision = ((ch.settings || {}).module_settings || {}).position_precision || 0;
    const notes = [];
    if (!precision) notes.push('Position sharing is turned off on the aux channel (position precision 0), so the radio removes the location from every position before transmitting it.');
    else if (precision < 32) notes.push('The aux channel’s position precision is ' + precision + ' bits, so the radio rounds each position before transmitting it. 32 bits sends the exact position.');
    if (pc.fixed_position) notes.push('This radio is set to a fixed position and also broadcasts that itself, so other stations will see it jump between the fixed position and the phone’s.');
    if (String(pc.gps_mode || '') === 'ENABLED') notes.push('The radio’s own GPS is on and it broadcasts its own positions too, alongside the phone’s.');
    return notes;
  }
  function trackerCard() {
    const st = Tracker.status();
    const fix = Tracker.fix, sent = Tracker.lastPosition, pc = Radio.config.position || {};
    const hops = (Radio.config.lora || {}).hop_limit || 3;
    const rows = [
      ['Default channel', Radio.channelName(0) + (Tracker.auxIsDefault() ? '  ✓' : '')],
      ['Phone GPS', fix ? fix.latitude.toFixed(5) + ', ' + fix.longitude.toFixed(5) : '—'],
      ['Accuracy', fix && fix.accuracy !== null && fix.accuracy !== undefined ? '±' + Math.round(fix.accuracy) + ' m, fix ' + fixAge(fix.timestamp) : '—'],
      ['Speed / course', sent && sent.ground_speed !== undefined
        ? sent.ground_speed + ' km/h' + (sent.ground_track !== undefined ? ' / ' + (Math.round(sent.ground_track / 100000) % 360) + '°' : '')
        : '—'],
      ['Last sent', Tracker.lastSent ? clock(Tracker.lastSent) + ':' + pad2(new Date(Tracker.lastSent).getSeconds()) + ' (' + fixAge(Tracker.lastSent) + ')' : '—'],
      ['Positions sent', String(Tracker.sentCount)],
      ['Sent to', 'everyone on aux, up to ' + hops + ' hop' + (hops === 1 ? '' : 's')],
    ];
    const canRun = connected() && Tracker.auxIsDefault();
    return h('div', { class: 'card tracker ' + (st.ok ? 'good' : 'idle') },
      h('h2', { text: 'Tracker' }),
      h('p', { class: 'tracker-status', text: st.text }),
      h('dl', { class: 'kv' }, rows.map((r) => [h('dt', { text: r[0] }), h('dd', { text: r[1] })])),
      radioPositionNotes().map((n) => h('p', { class: 'hint bad', style: 'margin:10px 0 0', text: n })),
      canRun ? h('button', { class: 'wide' + (Tracker.paused ? ' primary' : ''), text: Tracker.paused ? 'Resume sending location' : 'Pause sending location',
        onclick: () => Tracker.setPaused(!Tracker.paused) }) : null,
      h('p', { class: 'muted small', style: 'margin:10px 0 0', text: 'Keep this page open and in front. A phone stops a web page’s GPS and Bluetooth when the screen locks or another app is in front.' }));
  }

  // ── Info tab: reference, log and about (nothing here changes the radio) ───
  let logBox = null;
  function logText() {
    return Radio.log.slice(-200).map((l) => { const d = new Date(l.t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) + '  ' + l.text; }).join('\n') || 'Nothing logged yet.';
  }
  function renderInfo() {
    if (currentTab !== 'info') return;
    const tab = clear($('tab-info'));
    const pc = Radio.config.position || {};
    if (connected()) {
      const ch = Radio.channels[0] || {};
      const rows = [
        ['Default channel (slot 0)', Radio.channelName(0)],
        ['Other channels', Radio.channels.map((c, i) => (i && c && (c.role || 'DISABLED') !== 'DISABLED' ? Radio.channelName(i) : null)).filter(Boolean).join(', ') || 'none'],
        ['Channel position precision', String(((ch.settings || {}).module_settings || {}).position_precision || 0) + ' bits'],
        ['Hop limit', String((Radio.config.lora || {}).hop_limit || 3)],
        ['Radio’s own position broadcast', (pc.position_broadcast_secs || 900) + ' s' + (pc.position_broadcast_smart_enabled ? ' (smart on)' : '')],
        ['Fixed position', pc.fixed_position ? 'yes' : 'no'],
        ['Radio GPS mode', String(pc.gps_mode || 'DISABLED')],
      ];
      tab.appendChild(h('div', { class: 'card' },
        h('h2', { text: 'Radio settings that affect tracking' }),
        h('dl', { class: 'kv' }, rows.map((r) => [h('dt', { text: r[0] }), h('dd', { text: r[1] })])),
        h('p', { class: 'muted small', style: 'margin:10px 0 0', text: 'Shown for reference only. This app cannot change them; use the Meshtastic app or the PC program.' })));
    }
    logBox = h('div', { class: 'log', text: logText() });
    tab.appendChild(h('div', { class: 'card' }, h('h2', { text: 'Log' }), logBox));
    tab.appendChild(h('div', { class: 'card' },
      h('h2', { text: 'About' }),
      h('p', { text: 'Aux Tracker ' + APP_VERSION }),
      h('p', { class: 'muted small', text: 'A simplified version of Meshtastic Mobile. While the radio’s default channel is named “aux” it broadcasts this phone’s GPS position on that channel every ' + (Tracker.INTERVAL_MS / 1000) + ' seconds, with the same position data the Meshtastic iPhone app sends. It never changes a radio’s configuration.' }),
      h('p', { class: 'muted small', text: 'A position every 10 seconds is a lot of radio traffic. It suits a private aux channel with a handful of radios; on a busy public mesh it would crowd out other stations. The radio will not accept positions from a phone any faster than this.' }),
      h('p', { class: 'muted small', text: 'Android: open in Chrome. iPhone: open in the Bluefy browser (Safari cannot use Bluetooth radios). Allow location when asked.' }),
      h('p', { class: 'muted small', text: 'Messages are stored only on this phone. Map tiles © Esri. Meshtastic® is a registered trademark of Meshtastic LLC; this app is independent and not affiliated with or endorsed by the Meshtastic project.' }),
      h('button', { class: 'wide', text: 'Show the disclaimer', onclick: () => window.showDisclaimer && window.showDisclaimer() })));
  }

  // ── radio events ──────────────────────────────────────────────────────────
  let lastState = 'disconnected';
  let slowTimer = 0;
  Radio.on('state', (state) => {
    clearTimeout(slowTimer);
    if (state === 'configuring') {
      slowTimer = setTimeout(() => {
        if (Radio.state === 'configuring') {
          Radio.statusText = 'Still reading from the radio… If the phone asked for a pairing PIN, enter it. If nothing happens, cancel and connect again.';
          renderRadio();
        }
      }, 40000);
    }
    if (state === 'connected' && lastState !== 'connected') {
      loadMsgs();
      if (!conversations().includes(convKey)) convKey = 'c0';
      Radio.logLine(Tracker.auxIsDefault()
        ? 'Default channel is "aux": broadcasting the phone’s location on it every ' + (Tracker.INTERVAL_MS / 1000) + ' s'
        : 'Default channel is "' + Radio.channelName(0) + '", not "aux": location is not sent');
    }
    lastState = state;
    renderRadio(); renderConvBar(); renderMsgs(); renderNodes(); renderInfo();
    if (currentTab === 'map') updateMarkers(state === 'connected');
  });
  Radio.on('nodes', nodesChanged);
  Radio.on('telemetry', () => { if (currentTab === 'radio') renderRadio(); });
  Radio.on('config', () => { renderRadio(); renderConvBar(); renderInfo(); });
  Radio.on('notice', (text) => toast(text));
  Radio.on('log', () => { if (logBox && logBox.isConnected) { logBox.textContent = logText(); logBox.scrollTop = logBox.scrollHeight; } });
  Tracker.onChange(() => { if (currentTab === 'radio') renderRadio(); });
  setInterval(() => {
    if (currentTab === 'nodes' && connected()) renderNodes();
    if (currentTab === 'radio' && connected()) renderRadio();        // keeps the "x s ago" lines current
  }, 5000);

  renderRadio(); renderConvBar(); renderMsgs();
  if (/[?&]demo\b/.test(location.search)) connectDemo();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.MeshApp = { showTab, version: APP_VERSION };
})();
