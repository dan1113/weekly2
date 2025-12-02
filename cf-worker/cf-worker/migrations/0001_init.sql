-- clean create (초기라 데이터 없다고 가정)
DROP TABLE IF EXISTS files;

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  bucket TEXT NOT NULL,
  key TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  etag TEXT,
  created_at INTEGER NOT NULL,
  uploaded_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id);
CREATE INDEX IF NOT EXISTS idx_files_key  ON files(key);
