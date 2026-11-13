const crypto = require('node:crypto');
const { getDatabase } = require('../database');

/**
 * Evaluate telemetry reading against active alert rules
 * @param {string} deviceId
 * @param {string} deviceType
 * @param {string} metric
 * @param {number} value
 * @returns {Array<object>} triggeredAlerts
 */
function evaluateMetricRules(deviceId, deviceType, metric, value) {
  const db = getDatabase();
  const rules = db.prepare(`
    SELECT * FROM alert_rules 
    WHERE (device_type = ? OR device_type = 'ANY') 
      AND metric = ? 
      AND is_active = 1
  `).all(deviceType, metric);

  const triggered = [];
  const now = new Date().toISOString();

  for (const rule of rules) {
    let isBreached = false;
    const thresh = rule.threshold_value;

    switch (rule.condition) {
      case 'GREATER_THAN':
        isBreached = value > thresh;
        break;
      case 'LESS_THAN':
        isBreached = value < thresh;
        break;
      case 'EQUALS':
        isBreached = Math.abs(value - thresh) < 0.0001;
        break;
      default:
        isBreached = false;
    }

    if (isBreached) {
      const alertId = 'alt-' + crypto.randomUUID().slice(0, 8);
      const message = `Rule [${rule.name}] breached on ${deviceId}: ${metric} evaluated to ${value} (threshold: ${rule.condition} ${thresh})`;

      // Persist alert event
      db.prepare(`
        INSERT INTO alert_events (id, rule_id, device_id, metric, value, threshold_value, message, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(alertId, rule.id, deviceId, metric, value, thresh, message, now);

      triggered.push({
        alertId,
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        metric,
        value,
        threshold: thresh,
        message,
        createdAt: now
      });
    }
  }

  return triggered;
}

module.exports = {
  evaluateMetricRules
};
