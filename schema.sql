PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- 사용자 테이블
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nickname TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- 세션 테이블
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  ip TEXT,
  ua TEXT,
  created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_userid ON sessions(user_id);

-- 친구 관계 테이블 (차후 확장용)
CREATE TABLE IF NOT EXISTS friends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  friend_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- pending / accepted / blocked
  requested_at TEXT NOT NULL,
  accepted_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(friend_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_friends_userid ON friends(user_id);
CREATE INDEX IF NOT EXISTS idx_friends_friendid ON friends(friend_id);
CREATE TABLE IF NOT EXISTS diary_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_diary_userid ON diary_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_diary_date ON diary_entries(date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_diary_user_date ON diary_entries(user_id, date);

-- 다이어리 사진 테이블
CREATE TABLE IF NOT EXISTS diary_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  diary_id TEXT NOT NULL,
  photo_path TEXT NOT NULL,
  photo_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(diary_id) REFERENCES diary_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_photos_diaryid ON diary_photos(diary_id);