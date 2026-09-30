import fs from 'node:fs';
import path from 'node:path';
import { acquireLock } from '../storage/transaction-manager.mjs';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function readBudget(budgetFilePath) {
  try {
    const data = JSON.parse(fs.readFileSync(budgetFilePath, 'utf8'));
    return data.date === today() ? data : { date: today(), callsToday: 0 };
  } catch {
    return { date: today(), callsToday: 0 };
  }
}

function writeBudgetLocked(budgetFilePath, data) {
  fs.mkdirSync(path.dirname(budgetFilePath), { recursive: true });
  const tmpPath = `${budgetFilePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, budgetFilePath);
}

export function canDispatchCloudCall(budgetFilePath, options = {}) {
  const maxDailyCalls = options.maxDailyCalls ?? 50;
  if (!fs.existsSync(budgetFilePath)) return true;
  const data = readBudget(budgetFilePath);
  if (data.cooldownUntil && Date.now() < data.cooldownUntil) return false;
  return (data.callsToday || 0) < maxDailyCalls;
}

export function recordCloudCallSuccess(budgetFilePath) {
  const lock = acquireLock(`${budgetFilePath}.lock`);
  try {
    const data = readBudget(budgetFilePath);
    data.callsToday = (data.callsToday || 0) + 1;
    writeBudgetLocked(budgetFilePath, data);
  } finally {
    lock.release();
  }
}

export function recordCloudCallRateLimit(budgetFilePath, cooldownMs = 900000) {
  const lock = acquireLock(`${budgetFilePath}.lock`);
  try {
    const data = readBudget(budgetFilePath);
    data.cooldownUntil = Date.now() + cooldownMs;
    writeBudgetLocked(budgetFilePath, data);
  } finally {
    lock.release();
  }
}
