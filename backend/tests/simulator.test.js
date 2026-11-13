const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');

process.env.SQLITE_DB_PATH = ':memory:';

const { getDatabase, closeDatabase } = require('../src/database');
const { generateSimulatorTick } = require('../src/simulator/virtualEsp32');

describe('Virtual ESP32 Fleet Telemetry Simulator', () => {
  before(() => {
    getDatabase();
  });

  after(() => {
    closeDatabase();
  });

  test('should generate simulated telemetry batch for all active devices', () => {
    const points = generateSimulatorTick(false);
    assert.ok(Array.isArray(points));
    // 4 devices * 2-3 readings each >= 8 points
    assert.ok(points.length >= 8);

    const envPoint = points.find(p => p.metric === 'temperature_c');
    assert.ok(envPoint);
    assert.strictEqual(envPoint.unit, '°C');
    assert.strictEqual(envPoint.deviceId, 'ESP32-ENV-01');
    assert.strictEqual(envPoint.isAnomaly, false);
  });

  test('should trigger anomaly breach when forceAnomaly flag is passed', () => {
    const points = generateSimulatorTick(true);
    const overheatPoint = points.find(p => p.metric === 'temperature_c' && p.value === 42.5);

    assert.ok(overheatPoint);
    assert.strictEqual(overheatPoint.isAnomaly, true);
    assert.ok(overheatPoint.triggeredAlerts.length >= 1);
  });
});
