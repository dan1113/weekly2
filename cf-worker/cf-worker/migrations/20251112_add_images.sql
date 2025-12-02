-- images table for calendar photos
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  calendar_date TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER NULL,
  height INTEGER NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_images_user_date ON images(user_id, calendar_date);
CREATE INDEX IF NOT EXISTS idx_images_date ON images(calendar_date);

