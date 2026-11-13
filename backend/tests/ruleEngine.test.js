const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');

process.env.SQLITE_DB_PATH = ':memory:';

const { getDatabase, closeDatabase } = require('../src/database');
const { evaluateMetricRules } = require('../src/services/ruleEngine');

describe('RuleEngine Anomaly & Threshold Evaluation', () => {
  before(() => {
    getDatabase();
  });

  after(() => {
    closeDatabase();
  });

  test('should not trigger alert when temperature is below critical threshold', () => {
    // Threshold is 38.0 C
    const alerts = evaluateMetricRules('ESP32-ENV-01', 'ENVIRONMENTAL', 'temperature_c', 24.5);
    assert.strictEqual(alerts.length, 0);
  });

  test('should trigger CRITICAL alert when temperature exceeds 38.0 C', () => {
    const alerts = evaluateMetricRules('ESP32-ENV-01', 'ENVIRONMENTAL', 'temperature_c', 41.2);
    assert.strictEqual(alerts.length, 1);
    assert.strictEqual(alerts[0].severity, 'CRITICAL');
    assert.strictEqual(alerts[0].ruleName, 'High Temperature Overheat Threshold');
    assert.strictEqual(alerts[0].value, 41.2);
  });

  test('should trigger alert for generic ANY device type rules (e.g. low battery)', () => {
    // Threshold is LESS_THAN 20.0
    const alerts = evaluateMetricRules('ESP32-ANY-99', 'CUSTOM_SENSOR', 'battery_pct', 14.0);
    assert.strictEqual(alerts.length, 1);
    assert.strictEqual(alerts[0].severity, 'WARNING');
    assert.strictEqual(alerts[0].ruleName, 'Device Low Battery Warning');
  });
});
