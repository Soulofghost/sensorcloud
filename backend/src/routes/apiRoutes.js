const crypto = require('node:crypto');
const { getDatabase } = require('../database');
const { evaluateMetricRules } = require('../services/ruleEngine');
const { generateSimulatorTick } = require('../simulator/virtualEsp32');

function handleApiRequest(reqPath, method, query, body) {
  const db = getDatabase();

  // 1. Devices CRUD
  if (reqPath === '/devices' && method === 'GET') {
    const rows = db.prepare('SELECT * FROM devices ORDER BY id ASC').all();
    return {
      status: 200,
      data: rows.map(r => ({
        id: r.id,
        name: r.name,
        deviceType: r.device_type,
        model: r.model,
        location: r.location,
        status: r.status,
        batteryPct: r.battery_pct,
        firmwareVersion: r.firmware_version,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at
      }))
    };
  }

  if (reqPath === '/devices' && method === 'POST') {
    if (!body || !body.name || !body.deviceType) {
      return { status: 400, data: { error: 'Device name and deviceType are required' } };
    }

    const id = body.id || `ESP32-${body.deviceType.slice(0, 3).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO devices (id, name, device_type, model, location, status, battery_pct, firmware_version, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      body.name.trim(),
      body.deviceType.toUpperCase(),
      body.model || 'ESP32-WROOM-32D',
      body.location || 'Unassigned Sector',
      'ACTIVE',
      body.batteryPct || 100.0,
      body.firmwareVersion || 'v2.1.0-iot',
      now,
      now
    );

    return {
      status: 201,
      data: {
        id,
        name: body.name.trim(),
        deviceType: body.deviceType.toUpperCase(),
        status: 'ACTIVE',
        createdAt: now
      }
    };
  }

  // 2. Telemetry Ingest
  if (reqPath === '/telemetry' && method === 'POST') {
    if (!body || !body.deviceId || !body.metric || body.value === undefined) {
      return { status: 400, data: { error: 'deviceId, metric, and value are required' } };
    }

    const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(body.deviceId);
    if (!device) {
      return { status: 404, data: { error: 'Device not provisioned in fleet' } };
    }

    const telId = 'tel-' + crypto.randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    const val = Number(body.value);
    const unit = body.unit || '';

    // Evaluate alert rules
    const triggeredAlerts = evaluateMetricRules(device.id, device.device_type, body.metric, val);
    const isAnomaly = triggeredAlerts.length > 0 ? 1 : 0;

    db.prepare(`
      INSERT INTO telemetry (id, device_id, metric, value, unit, is_anomaly, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(telId, device.id, body.metric, val, unit, isAnomaly, now);

    db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(now, device.id);

    return {
      status: 201,
      data: {
        id: telId,
        deviceId: device.id,
        metric: body.metric,
        value: val,
        unit,
        isAnomaly: Boolean(isAnomaly),
        triggeredAlerts,
        createdAt: now
      }
    };
  }

  if (reqPath === '/telemetry/history' && method === 'GET') {
    const limit = Math.min(Number(query.get('limit')) || 50, 200);
    const deviceId = query.get('deviceId');
    const anomalyOnly = query.get('anomalyOnly') === 'true';

    let sql = 'SELECT t.*, d.name as device_name FROM telemetry t JOIN devices d ON t.device_id = d.id WHERE 1=1';
    const params = [];

    if (deviceId) {
      sql += ' AND t.device_id = ?';
      params.push(deviceId);
    }
    if (anomalyOnly) {
      sql += ' AND t.is_anomaly = 1';
    }

    sql += ' ORDER BY t.created_at DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(sql).all(...params);
    return {
      status: 200,
      data: rows.map(r => ({
        id: r.id,
        deviceId: r.device_id,
        deviceName: r.device_name,
        metric: r.metric,
        value: r.value,
        unit: r.unit,
        isAnomaly: Boolean(r.is_anomaly),
        createdAt: r.created_at
      }))
    };
  }

  // 3. Alert Rules CRUD
  if (reqPath === '/rules' && method === 'GET') {
    const rows = db.prepare('SELECT * FROM alert_rules ORDER BY created_at DESC').all();
    return {
      status: 200,
      data: rows.map(r => ({
        id: r.id,
        name: r.name,
        deviceType: r.device_type,
        metric: r.metric,
        condition: r.condition,
        thresholdValue: r.threshold_value,
        severity: r.severity,
        isActive: Boolean(r.is_active),
        createdAt: r.created_at
      }))
    };
  }

  if (reqPath === '/rules' && method === 'POST') {
    if (!body || !body.name || !body.metric || body.thresholdValue === undefined) {
      return { status: 400, data: { error: 'name, metric, and thresholdValue are required' } };
    }

    const ruleId = 'rule-' + crypto.randomUUID().slice(0, 8);
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO alert_rules (id, name, device_type, metric, condition, threshold_value, severity, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ruleId,
      body.name.trim(),
      body.deviceType || 'ANY',
      body.metric.trim(),
      body.condition || 'GREATER_THAN',
      Number(body.thresholdValue),
      body.severity || 'WARNING',
      1,
      now
    );

    return {
      status: 201,
      data: {
        id: ruleId,
        name: body.name.trim(),
        metric: body.metric.trim(),
        thresholdValue: Number(body.thresholdValue),
        createdAt: now
      }
    };
  }

  // 4. Alert Events
  if (reqPath === '/alerts' && method === 'GET') {
    const limit = Math.min(Number(query.get('limit')) || 25, 100);
    const rows = db.prepare(`
      SELECT a.*, r.severity 
      FROM alert_events a
      JOIN alert_rules r ON a.rule_id = r.id
      ORDER BY a.created_at DESC
      LIMIT ?
    `).all(limit);

    return {
      status: 200,
      data: rows.map(r => ({
        id: r.id,
        ruleId: r.rule_id,
        deviceId: r.device_id,
        metric: r.metric,
        value: r.value,
        thresholdValue: r.threshold_value,
        severity: r.severity,
        message: r.message,
        createdAt: r.created_at
      }))
    };
  }

  // 5. Fleet Analytics Summary
  if (reqPath === '/analytics/summary' && method === 'GET') {
    const totalDevices = db.prepare('SELECT count(*) as cnt FROM devices').get().cnt;
    const activeDevices = db.prepare("SELECT count(*) as cnt FROM devices WHERE status = 'ACTIVE'").get().cnt;
    const totalTelemetry = db.prepare('SELECT count(*) as cnt FROM telemetry').get().cnt;
    const totalAlerts = db.prepare('SELECT count(*) as cnt FROM alert_events').get().cnt;
    const anomalyCount = db.prepare('SELECT count(*) as cnt FROM telemetry WHERE is_anomaly = 1').get().cnt;

    const fleetHealth = totalTelemetry > 0 
      ? Math.max(0, Number((100.0 - (anomalyCount / totalTelemetry) * 100).toFixed(1)))
      : 100.0;

    return {
      status: 200,
      data: {
        totalDevices,
        activeDevices,
        totalTelemetry,
        totalAlerts,
        anomalyCount,
        fleetHealthScore: fleetHealth
      }
    };
  }

  // 6. Simulator Trigger
  if (reqPath === '/simulator/tick' && method === 'POST') {
    const forceAnomaly = Boolean(body?.forceAnomaly);
    const generated = generateSimulatorTick(forceAnomaly);
    return {
      status: 200,
      data: {
        message: `Simulator sweep generated ${generated.length} telemetry data points`,
        pointsCount: generated.length,
        points: generated
      }
    };
  }

  return { status: 404, data: { error: 'SensorCloud API route not found' } };
}

module.exports = {
  handleApiRequest
};
