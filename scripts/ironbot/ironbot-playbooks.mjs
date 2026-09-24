import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '../..');
const CONFIG_PATH = path.join(__dirname, 'task-dag-definitions.json');

export function parseTaskDagConfig(configPath = CONFIG_PATH) {
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw);
}

export function getDownstreamTasks(taskName, config = parseTaskDagConfig()) {
  const result = [];
  const visited = new Set();
  const queue = [...(config.tasks[taskName]?.downstream || [])];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!visited.has(current)) {
      visited.add(current);
      result.push(current);
      const nextDownstream = config.tasks[current]?.downstream || [];
      for (const next of nextDownstream) {
        if (!visited.has(next)) queue.push(next);
      }
    }
  }
  return result;
}
