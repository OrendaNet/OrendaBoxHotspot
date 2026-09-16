(function () {
  const elements = {
    banner: document.getElementById('banner'),
    connChip: document.getElementById('conn-chip'),
    connText: document.getElementById('conn-text'),
    title: document.getElementById('hotspot-title'),
    reason: document.getElementById('hotspot-reason'),
    statusPill: document.getElementById('status-pill'),
    statusText: document.getElementById('status-text'),
    ssid: document.getElementById('stat-ssid'),
    internet: document.getElementById('stat-internet'),
    clients: document.getElementById('stat-clients'),
    portal: document.getElementById('stat-portal'),
    portalUrl: document.getElementById('portal-url'),
    form: document.getElementById('settings-form'),
    ssidInput: document.getElementById('ssid'),
    passwordInput: document.getElementById('password'),
    internetInput: document.getElementById('internet'),
    save: document.getElementById('save'),
    start: document.getElementById('start'),
    stop: document.getElementById('stop'),
    refresh: document.getElementById('refresh'),
    clientList: document.getElementById('clients')
  };
  let manageable = false;
  let busy = false;
  let loading = false;
  function showBanner(kind, text) {
    if (!text) { elements.banner.hidden = true; return; }
    elements.banner.className = `banner ${kind}`;
    elements.banner.textContent = text;
    elements.banner.hidden = false;
  }

  function setBusy(value) {
    busy = value;
    for (const control of [elements.save, elements.start, elements.stop, elements.refresh, elements.ssidInput, elements.passwordInput, elements.internetInput]) {
      control.disabled = value || (control !== elements.refresh && !manageable);
    }
  }

  function renderClients(clients) {
    if (!clients.length) {
      elements.clientList.innerHTML = '<p class="hint">No devices are connected yet.</p>';
      return;
    }
    elements.clientList.innerHTML = clients.map((client) => {
      const label = client.hostname || client.mac || 'Device';
      return `<div class="client-row"><strong>${escapeHtml(label)}</strong><code>${escapeHtml(client.address || '')}</code></div>`;
    }).join('');
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }

  function render(payload) {
    const hotspot = payload.hotspot || {};
    const user = payload.user || {};
    manageable = Boolean(payload.manageable);
    const active = Boolean(hotspot.active);
    const configured = Boolean(hotspot.configured || hotspot.ssid);
    elements.title.textContent = active ? (hotspot.ssid || 'Hotspot running') : configured ? 'Hotspot stopped' : 'Hotspot not configured yet';
    elements.statusText.textContent = active ? 'Running' : configured ? 'Stopped' : 'Not configured';
    elements.statusPill.className = `status-pill ${active ? 'live' : configured ? 'warn' : ''}`;
    elements.connText.textContent = `Signed in as ${user.name || user.username || 'Edge user'}`;
    elements.connChip.className = `topbar-chip ${manageable ? 'live' : 'warn'}`;
    elements.reason.textContent = hotspot.reason && hotspot.available !== false ? hotspot.reason : '';
    elements.reason.hidden = !elements.reason.textContent;
    elements.ssid.textContent = hotspot.ssid || '—';
    elements.internet.textContent = hotspot.internetAccess ? 'Shared with devices' : 'Box-hosted apps only';
    elements.clients.textContent = active ? String((hotspot.clients || []).length) : '—';
    elements.portal.textContent = hotspot.address || '—';
    elements.portalUrl.textContent = hotspot.portalUrl || 'the Box address';
    if (document.activeElement !== elements.ssidInput) elements.ssidInput.value = hotspot.ssid || '';
    elements.internetInput.checked = Boolean(hotspot.internetAccess);
    renderClients(hotspot.clients || []);
    if (!manageable) showBanner('info', 'Ask a Box administrator to approve hotspot management for this app before changing these settings.');
    else if (hotspot.available === false) showBanner('error', hotspot.reason || 'Hotspot management is unavailable on this Box.');
    else showBanner('', '');
    setBusy(busy);
  }

  async function request(route, options = {}) {
    const response = await fetch(route, {
      method: options.method || 'GET',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    let payload = {};
    try { payload = await response.json(); } catch (_) { payload = {}; }
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  }

  async function refresh({ quiet = false } = {}) {
    if (busy || loading) return;
    loading = true;
    if (!quiet) {
      setBusy(true);
      showBanner('info', 'Loading hotspot status…');
    }
    try {
      render(await request('api/state'));
    } catch (error) {
      elements.statusPill.className = 'status-pill err';
      elements.statusText.textContent = 'Unavailable';
      elements.connChip.className = 'topbar-chip err';
      elements.connText.textContent = 'Connection problem';
      showBanner('error', error.message);
    } finally {
      loading = false;
      if (!quiet) setBusy(false);
    }
  }

  async function mutate(route, body, success) {
    if (!manageable) { showBanner('error', 'Ask a Box administrator to approve hotspot management for this app.'); return false; }
    const method = route === 'api/hotspot' ? 'PUT' : 'POST';
    setBusy(true);
    showBanner('info', 'Applying changes…');
    try {
      const payload = await request(route, { method, body });
      render(payload);
      showBanner('success', success);
      return true;
    } catch (error) {
      showBanner('error', error.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  elements.form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!elements.ssidInput.value.trim()) return showBanner('error', 'Enter a WiFi name.');
    const settings = { ssid: elements.ssidInput.value.trim(), internetAccess: elements.internetInput.checked };
    if (elements.passwordInput.value) settings.password = elements.passwordInput.value;
    mutate('api/hotspot', settings, 'Settings saved.').then((saved) => { if (saved) elements.passwordInput.value = ''; });
  });
  elements.start.addEventListener('click', () => mutate('api/hotspot/start', { empty: true }, 'Hotspot started.'));
  elements.stop.addEventListener('click', () => mutate('api/hotspot/stop', { empty: true }, 'Hotspot stopped.'));
  refresh();
  elements.refresh.addEventListener('click', () => refresh());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh({ quiet: true }); });
  setInterval(() => { if (!document.hidden && !busy) refresh({ quiet: true }); }, 10000);
})();
