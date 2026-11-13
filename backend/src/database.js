const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DB_PATH = process.env.SQLITE_DB_PATH || path.join(__dirname, '..', 'sensorcloud.db');

if (DB_PATH !== ':memory:') {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

let db = null;

function getDatabase() {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    if (DB_PATH !== ':memory:') {
      db.exec('PRAGMA journal_mode = WAL;');
      db.exec('PRAGMA synchronous = NORMAL;');
    }
    initSchema(db);
  }
  return db;
}

function initSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      device_type TEXT NOT NULL,
      model TEXT NOT NULL,
      location TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      battery_pct REAL NOT NULL DEFAULT 100.0,
      firmware_version TEXT NOT NULL DEFAULT 'v2.1.0-iot',
      created_at TEXT NOT NULL,
      last_seen_at TEXT
    );

    CREATE TABLE IF NOT EXISTS telemetry (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      metric TEXT NOT NULL,
      value REAL NOT NULL,
      unit TEXT NOT NULL,
      is_anomaly INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alert_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      device_type TEXT NOT NULL,
      metric TEXT NOT NULL,
      condition TEXT NOT NULL,
      threshold_value REAL NOT NULL,
      severity TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alert_events (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      metric TEXT NOT NULL,
      value REAL NOT NULL,
      threshold_value REAL NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_telemetry_created ON telemetry (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_telemetry_device ON telemetry (device_id);
    CREATE INDEX IF NOT EXISTS idx_alerts_created ON alert_events (created_at DESC);
  `);

  // Seed default devices if empty
  const deviceCount = database.prepare('SELECT count(*) as cnt FROM devices').get().cnt;
  if (deviceCount === 0) {
    const now = new Date().toISOString();
    const insertDevice = database.prepare(`
      INSERT INTO devices (id, name, device_type, model, location, status, battery_pct, firmware_version, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertDevice.run('ESP32-ENV-01', 'Server Room HVAC Environmental Node', 'ENVIRONMENTAL', 'ESP32-WROOM-32D', 'Data Center Pod B', 'ACTIVE', 98.5, 'v2.4.1', now, now);
    insertDevice.run('ESP32-VIB-02', 'Turbine Bearing Vibration Telemetry', 'VIBRATION', 'ESP32-S3-N16R8', 'Main Pump Turbine 2', 'ACTIVE', 92.0, 'v2.4.1', now, now);
    insertDevice.run('ESP32-AIR-03', 'Facility Cleanroom Air Quality Sensor', 'AIR_QUALITY', 'ESP32-C3-MINI', 'Cleanroom Sector 1', 'ACTIVE', 87.5, 'v2.3.0', now, now);
    insertDevice.run('ESP32-PWR-04', 'Solar Inverter Energy Telematics', 'POWER', 'ESP32-WROVER-E', 'Rooftop Solar Array 4', 'ACTIVE', 100.0, 'v2.4.1', now, now);
  }

  // Seed default alert rules if empty
  const ruleCount = database.prepare('SELECT count(*) as cnt FROM alert_rules').get().cnt;
  if (ruleCount === 0) {
    const now = new Date().toISOString();
    const insertRule = database.prepare(`
      INSERT INTO alert_rules (id, name, device_type, metric, condition, threshold_value, severity, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertRule.run('rule-temp-crit', 'High Temperature Overheat Threshold', 'ENVIRONMENTAL', 'temperature_c', 'GREATER_THAN', 38.0, 'CRITICAL', 1, now);
    insertRule.run('rule-vib-crit', 'Severe Turbine Vibration Breach', 'VIBRATION', 'vibration_rms', 'GREATER_THAN', 4.5, 'CRITICAL', 1, now);
    insertRule.run('rule-co2-warn', 'Elevated CO2 Indoor Threshold', 'AIR_QUALITY', 'co2_ppm', 'GREATER_THAN', 1000.0, 'WARNING', 1, now);
    insertRule.run('rule-batt-low', 'Device Low Battery Warning', 'ANY', 'battery_pct', 'LESS_THAN', 20.0, 'WARNING', 1, now);
  }
}

function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  getDatabase,
  closeDatabase,
  initSchema
};
