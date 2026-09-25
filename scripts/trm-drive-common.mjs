import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const KB_SYNC_ROOT = path.resolve(__dirname, '..');

export const DEFAULT_CONFIG = {
  drive_buffer_root: "G:/My Drive/TRM-Research",
  cowork_inbox_root: path.join(process.env.USERPROFILE || 'C:/Users/soren', 'OneDrive', 'Documents', 'Cowork', 'inbox'),
  cowork_archive_root: path.join(process.env.USERPROFILE || 'C:/Users/soren', 'OneDrive', 'Documents', 'Cowork', 'archive'),
  onedrive_inbox_root: path.join(process.env.USERPROFILE || 'C:/Users/soren', 'OneDrive', 'Copilot', 'inbox'),
  onedrive_archive_root: path.join(process.env.USERPROFILE || 'C:/Users/soren', 'OneDrive', 'Copilot', 'archive'),
  ingest_debounce_seconds: 15,
  lease_seconds: 14400,
  ready_equivalents: {
    precedence: ["sidecar", "frontmatter", "filename", "gdoc_title"],
    marker_tokens: ["ready", "completed", "done"]
  },
  drive_export: {
    mode: "local_first",
    oauth_client_json: "",
    on_missing_auth: "quarantine_gdoc_auth_expired"
  },
  taxonomy: {
    agent_origin: ["copilot", "grok", "human"],
    agent_version: ["m365-copilot", "copilot-web", "copilot-mobile", "grok-mobile", "grok-web", "grok-deepsearch", "manual-paste", "field-notes"],
    source_type: ["web", "m365", "mixed", "manual"],
    topics: ["cic", "spec", "rewrite", "trm", "kb", "default"]
  }
};

export function loadDriveConfig(customPath = null) {
  const configPath = customPath || path.join(KB_SYNC_ROOT, 'configs', 'global.yaml');
  try {
    if (fs.existsSync(configPath)) {
      const parsed = yaml.load(fs.readFileSync(configPath, 'utf8'));
      if (parsed && parsed.trm) {
        return { ...DEFAULT_CONFIG, ...parsed.trm };
      }
    }
  } catch {}
  return DEFAULT_CONFIG;
}
