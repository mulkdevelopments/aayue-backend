-- Persist agent job runs for monitoring and history.
CREATE TABLE IF NOT EXISTS agent_jobs (
  id UUID PRIMARY KEY,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  total INT NOT NULL DEFAULT 0,
  processed INT NOT NULL DEFAULT 0,
  success INT NOT NULL DEFAULT 0,
  failed INT NOT NULL DEFAULT 0,
  started_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  stop_reason TEXT,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_agent_jobs_agent_id ON agent_jobs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_started_at ON agent_jobs(started_at DESC);

COMMENT ON TABLE agent_jobs IS 'Agent run history: auto_mapping and future agents.';
