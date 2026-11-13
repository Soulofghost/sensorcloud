// SensorCloud Industrial IoT Console Controller
const API_BASE = '/api/v1';

let autoStreamTimer = null;

// DOM Elements
const statNodes = document.getElementById('statNodes');
const statTelemetry = document.getElementById('statTelemetry');
const statAlerts = document.getElementById('statAlerts');
const statHealth = document.getElementById('statHealth');
const sseStatus = document.getElementById('sseStatus');
const refreshDataBtn = document.getElementById('refreshDataBtn');

const devicesContainer = document.getElementById('devicesContainer');
const provisionDrawer = document.getElementById('provisionDrawer');
const newDeviceForm = document.getElementById('newDeviceForm');

const telemetryStream = document.getElementById('telemetryStream');
const alertsContainer = document.getElementById('alertsContainer');

const simTickBtn = document.getElementById('simTickBtn');
const simOverheatBtn = document.getElementById('simOverheatBtn');
const simAutoBtn = document.getElementById('simAutoBtn');

function toggleProvisionModal() {
  provisionDrawer.classList.toggle('hidden');
}

// 1. Fetch Fleet Analytics Summary
async function fetchSummary() {
  try {
    const res = await fetch(`${API_BASE}/analytics/summary`);
    if (!res.ok) throw new Error('Failed to load summary');
    const data = await res.json();

    statNodes.textContent = data.activeDevices;
    statTelemetry.textContent = data.totalTelemetry.toLocaleString();
    statAlerts.textContent = data.totalAlerts;
    statHealth.textContent = `${data.fleetHealthScore.toFixed(1)}%`;
  } catch (err) {
    console.error('Error fetching summary:', err);
  }
}

// 2. Fetch Devices
async function fetchDevices() {
  try {
    const res = await fetch(`${API_BASE}/devices`);
    if (!res.ok) throw new Error('Failed to load devices');
    const devices = await res.json();

    devicesContainer.innerHTML = devices.map(d => `
      <div class="device-card">
        <div class="dev-main">
          <span class="dev-name">${escapeHtml(d.name)}</span>
          <span class="dev-meta font-mono">
            ID: <strong>${d.id}</strong> | MODEL: ${d.model} | FW: ${d.firmwareVersion}
          </span>
          <span class="dev-meta">
            LOC: ${escapeHtml(d.location)} | LAST SEEN: ${new Date(d.lastSeenAt || d.createdAt).toLocaleTimeString()}
          </span>
        </div>
        <div class="dev-stats">
          <span class="badge-status badge-active">${d.status}</span>
          <span class="battery-tag">⚡ ${d.batteryPct.toFixed(1)}%</span>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Error loading devices:', err);
  }
}

// Provision New Device
newDeviceForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('devName').value.trim();
  const deviceType = document.getElementById('devType').value;
  const model = document.getElementById('devModel').value.trim();
  const location = document.getElementById('devLocation').value.trim();

  try {
    const res = await fetch(`${API_BASE}/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, deviceType, model, location })
    });

    if (!res.ok) throw new Error('Device provisioning failed');
    newDeviceForm.reset();
    toggleProvisionModal();
    fetchDevices();
    fetchSummary();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
});

// 3. Fetch Telemetry History
async function fetchTelemetry() {
  try {
    const res = await fetch(`${API_BASE}/telemetry/history?limit=30`);
    if (!res.ok) throw new Error('Failed to load telemetry');
    const logs = await res.json();

    if (logs.length === 0) {
      telemetryStream.innerHTML = '<div class="empty-state">No telemetry ingested yet. Click "Trigger Telemetry Sweep" below.</div>';
      return;
    }

    telemetryStream.innerHTML = logs.map(l => `
      <div class="stream-item ${l.isAnomaly ? 'anomaly' : ''}">
        <div>
          <strong class="font-mono text-cyan">${l.deviceId}</strong>
          <span class="font-mono" style="margin-left:0.5rem; color:var(--text-muted);">${l.metric}:</span>
          <strong class="font-mono ${l.isAnomaly ? 'text-coral' : 'text-emerald'}">${l.value} ${l.unit}</strong>
        </div>
        <div class="font-mono text-dim" style="font-size:0.7rem;">
          ${new Date(l.createdAt).toLocaleTimeString()}
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Error fetching telemetry:', err);
  }
}

// 4. Fetch Alert Events
async function fetchAlerts() {
  try {
    const res = await fetch(`${API_BASE}/alerts?limit=15`);
    if (!res.ok) throw new Error('Failed to load alerts');
    const alerts = await res.json();

    if (alerts.length === 0) {
      alertsContainer.innerHTML = '<div class="empty-state">No threshold rule breaches detected.</div>';
      return;
    }

    alertsContainer.innerHTML = alerts.map(a => `
      <div class="alert-item">
        <div style="display:flex; justify-content:space-between; margin-bottom:0.2rem;">
          <strong class="text-coral font-mono">[${a.severity}] ${a.deviceId}</strong>
          <span class="font-mono text-dim" style="font-size:0.7rem;">${new Date(a.createdAt).toLocaleTimeString()}</span>
        </div>
        <p style="color:var(--text-main); font-size:0.78rem;">${escapeHtml(a.message)}</p>
      </div>
    `).join('');
  } catch (err) {
    console.error('Error fetching alerts:', err);
  }
}

// 5. Simulator Triggers
async function triggerSimulatorSweep(forceAnomaly = false) {
  try {
    const res = await fetch(`${API_BASE}/simulator/tick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forceAnomaly })
    });
    if (!res.ok) throw new Error('Simulator sweep failed');
    fetchSummary();
    fetchTelemetry();
    fetchAlerts();
    fetchDevices();
  } catch (err) {
    alert(`Simulator error: ${err.message}`);
  }
}

simTickBtn.addEventListener('click', () => triggerSimulatorSweep(false));
simOverheatBtn.addEventListener('click', () => triggerSimulatorSweep(true));

simAutoBtn.addEventListener('click', () => {
  if (autoStreamTimer) {
    clearInterval(autoStreamTimer);
    autoStreamTimer = null;
    simAutoBtn.textContent = 'Start Auto-Stream (3s Interval)';
    simAutoBtn.className = 'btn btn-secondary';
  } else {
    autoStreamTimer = setInterval(() => triggerSimulatorSweep(false), 3000);
    simAutoBtn.textContent = 'Stop Auto-Stream (Streaming Active)';
    simAutoBtn.className = 'btn btn-coral';
  }
});

refreshDataBtn.addEventListener('click', () => {
  fetchSummary();
  fetchDevices();
  fetchTelemetry();
  fetchAlerts();
});

// 6. Connect Server-Sent Events (SSE)
function initSSE() {
  try {
    const evtSource = new EventSource(`${API_BASE}/telemetry/stream`);
    evtSource.onmessage = (e) => {
      // Refresh views on incoming broadcast
      fetchSummary();
      fetchTelemetry();
      fetchAlerts();
    };
    evtSource.onerror = () => {
      sseStatus.textContent = 'TELEMETRY STREAM: RECONNECTING';
    };
    evtSource.onopen = () => {
      sseStatus.textContent = 'TELEMETRY STREAM: CONNECTED';
    };
  } catch (e) {
    console.warn('SSE not supported or disabled:', e);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Initial Boot
fetchSummary();
fetchDevices();
fetchTelemetry();
fetchAlerts();
initSSE();
