const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');

process.env.SQLITE_DB_PATH = ':memory:';

const { getDatabase, closeDatabase } = require('../src/database');
const { handleApiRequest } = require('../src/routes/apiRoutes');

describe('SensorCloud Management & Telemetry API Integration', () => {
  before(() => {
    getDatabase();
  });

  after(() => {
    closeDatabase();
  });

  test('should list pre-seeded devices', () => {
    const res = handleApiRequest('/devices', 'GET', new URLSearchParams(), null);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data));
    assert.ok(res.data.length >= 4);
    assert.ok(res.data.some(d => d.id === 'ESP32-ENV-01'));
  });

  test('should register a new device in fleet', () => {
    const res = handleApiRequest('/devices', 'POST', new URLSearchParams(), {
      name: 'Secondary Water Pump Vibration',
      deviceType: 'VIBRATION',
      model: 'ESP32-S3',
      location: 'Pump House Bay 3'
    });

    assert.strictEqual(res.status, 201);
    assert.ok(res.data.id.startsWith('ESP32-VIB-'));
    assert.strictEqual(res.data.status, 'ACTIVE');
  });

  test('should ingest valid telemetry data point', () => {
    const res = handleApiRequest('/telemetry', 'POST', new URLSearchParams(), {
      deviceId: 'ESP32-ENV-01',
      metric: 'temperature_c',
      value: 23.4,
      unit: '°C'
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.data.deviceId, 'ESP32-ENV-01');
    assert.strictEqual(res.data.value, 23.4);
    assert.strictEqual(res.data.isAnomaly, false);
  });

  test('should return 404 when ingesting for unknown device', () => {
    const res = handleApiRequest('/telemetry', 'POST', new URLSearchParams(), {
      deviceId: 'UNKNOWN-NODE-999',
      metric: 'temp',
      value: 10
    });

    assert.strictEqual(res.status, 404);
  });

  test('should query historical telemetry logs with filters', () => {
    const res = handleApiRequest('/telemetry/history', 'GET', new URLSearchParams('limit=10&deviceId=ESP32-ENV-01'), null);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data));
  });

  test('should compute fleet analytics summary and health score', () => {
    const res = handleApiRequest('/analytics/summary', 'GET', new URLSearchParams(), null);
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.totalDevices >= 4);
    assert.ok(res.data.fleetHealthScore >= 0 && res.data.fleetHealthScore <= 100);
  });
});
