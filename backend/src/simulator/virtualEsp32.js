const crypto = require('node:crypto');
const { getDatabase } = require('../database');
const { evaluateMetricRules } = require('../services/ruleEngine');

function generateSimulatorTick(forceAnomaly = false) {
  const db = getDatabase();
  const devices = db.prepare("SELECT * FROM devices WHERE status = 'ACTIVE'").all();
  const results = [];
  const now = new Date().toISOString();

  for (const dev of devices) {
    const readings = [];

    if (dev.device_type === 'ENVIRONMENTAL') {
      const temp = forceAnomaly ? 42.5 : Number((22.0 + (Math.random() * 4.0 - 2.0)).toFixed(1));
      const hum = Number((48.0 + (Math.random() * 6.0 - 3.0)).toFixed(1));
      const pres = Number((1013.2 + (Math.random() * 2.0 - 1.0)).toFixed(1));

      readings.push({ metric: 'temperature_c', value: temp, unit: '°C' });
      readings.push({ metric: 'humidity_pct', value: hum, unit: '%' });
      readings.push({ metric: 'pressure_hpa', value: pres, unit: 'hPa' });
    } else if (dev.device_type === 'VIBRATION') {
      const vib = forceAnomaly ? 5.8 : Number((1.2 + (Math.random() * 0.4 - 0.2)).toFixed(2));
      const temp = Number((54.0 + (Math.random() * 3.0 - 1.5)).toFixed(1));

      readings.push({ metric: 'vibration_rms', value: vib, unit: 'mm/s' });
      readings.push({ metric: 'bearing_temp_c', value: temp, unit: '°C' });
    } else if (dev.device_type === 'AIR_QUALITY') {
      const co2 = forceAnomaly ? 1250.0 : Number((520 + Math.floor(Math.random() * 100 - 50)));
      const pm25 = Number((8.5 + (Math.random() * 2.0 - 1.0)).toFixed(1));

      readings.push({ metric: 'co2_ppm', value: co2, unit: 'ppm' });
      readings.push({ metric: 'pm25_ug_m3', value: pm25, unit: 'µg/m³' });
    } else if (dev.device_type === 'POWER') {
      const pwr = Number((3400 + Math.floor(Math.random() * 200 - 100)));
      const volt = Number((235.0 + (Math.random() * 2.0 - 1.0)).toFixed(1));

      readings.push({ metric: 'power_watts', value: pwr, unit: 'W' });
      readings.push({ metric: 'grid_voltage_v', value: volt, unit: 'V' });
    }

    // Process and store each reading
    for (const r of readings) {
      const triggeredAlerts = evaluateMetricRules(dev.id, dev.device_type, r.metric, r.value);
      const isAnomaly = triggeredAlerts.length > 0 ? 1 : 0;
      const telId = 'tel-' + crypto.randomUUID().slice(0, 8);

      db.prepare(`
        INSERT INTO telemetry (id, device_id, metric, value, unit, is_anomaly, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(telId, dev.id, r.metric, r.value, r.unit, isAnomaly, now);

      results.push({
        id: telId,
        deviceId: dev.id,
        deviceName: dev.name,
        deviceType: dev.device_type,
        metric: r.metric,
        value: r.value,
        unit: r.unit,
        isAnomaly: Boolean(isAnomaly),
        triggeredAlerts,
        createdAt: now
      });
    }

    // Update device last_seen_at
    db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(now, dev.id);
  }

  return results;
}

module.exports = {
  generateSimulatorTick
};
