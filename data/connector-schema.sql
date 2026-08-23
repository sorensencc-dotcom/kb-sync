CREATE TABLE IF NOT EXISTS local_approvals (
  approval_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  action_hash TEXT NOT NULL,
  capability TEXT NOT NULL,
  scope TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);