// server.js (최종본 All-in-One, dedup & fixes)
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import csrf from "csurf";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* -------------------- Config -------------------- */
const PORT = process.env.PORT || 10000;
const NODE_ENV = process.env.NODE_ENV || "development";
const isProd = NODE_ENV === "production";

// 쿠키 옵션
const COOKIE_NAME = "sid";
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  secure: isProd,
  path: "/",
  signed: true,
};

// CSRF (더블서브밋용 쿠키 이름)
const CSRF_COOKIE_NAME = "xsrf-token";

/* -------------------- App -------------------- */
const app = express();

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:", "blob:"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser(process.env.COOKIE_SECRET || "dev_secret_change_me"));

/* -------------------- DB -------------------- */
const db = await open({
  filename: path.join(__dirname, "auth.db"),
  driver: sqlite3.Database,
});

await db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nickname TEXT,
  avatar_url TEXT,
  bio TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nickname_unique
ON users(nickname) WHERE nickname IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  ip TEXT,
  ua TEXT,
  created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS friends (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL,
  addressee_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(requester_id, addressee_id),
  FOREIGN KEY(requester_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(addressee_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_friends_addressee ON friends(addressee_id);
CREATE INDEX IF NOT EXISTS idx_friends_requester ON friends(requester_id);

CREATE TABLE IF NOT EXISTS diary_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  text TEXT,
  thumbnail_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_diary_user_date ON diary_entries(user_id, date);

CREATE TABLE IF NOT EXISTS diary_photos (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  image_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(entry_id) REFERENCES diary_entries(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_photos_entry ON diary_photos(entry_id, order_index);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT,
  location TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sched_user_start ON schedules(user_id, start_at);
`);

// 구버전 호환용: avatar_url, bio 보장
async function ensureUserColumns() {
  const cols = await db.all(`PRAGMA table_info(users)`);
  const names = new Set(cols.map(c => c.name));
  if (!names.has("avatar_url")) await db.exec(`ALTER TABLE users ADD COLUMN avatar_url TEXT;`);
  if (!names.has("bio")) await db.exec(`ALTER TABLE users ADD COLUMN bio TEXT;`);
}
await ensureUserColumns();

/* -------------------- Upload (multer) -------------------- */
const uploadDir = path.join(__dirname, "public", "uploads");
await fs.promises.mkdir(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const name = crypto.randomBytes(16).toString("hex") + ext;
    cb(null, name);
  },
});
const imageFilter = (_req, file, cb) => {
  const ok = /^image\/(png|jpe?g|gif|webp|avif)$/.test(file.mimetype);
  cb(ok ? null : new Error("이미지 형식만 허용"));
};
const uploadAvatar = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: imageFilter,
});
const uploadDiaryMany = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: imageFilter,
});

/* -------------------- Rate Limits -------------------- */
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/auth/", authLimiter);

/* -------------------- CSRF -------------------- */
const csrfProtection = csrf({
  cookie: {
    key: CSRF_COOKIE_NAME,
    httpOnly: false,
    sameSite: "lax",
    secure: isProd,
  },
});
app.get("/api/csrf", csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

/* -------------------- Helpers -------------------- */
const nowISO = () => new Date().toISOString();

async function createSession(userId, req, res) {
  const sid = "s_" + nanoid(24);
  await db.run(
    `INSERT INTO sessions (id, user_id, ip, ua, created_at, last_seen)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [sid, userId, req.ip, req.headers["user-agent"] || "", nowISO(), nowISO()]
  );
  res.cookie(COOKIE_NAME, sid, COOKIE_OPTS);
  return sid;
}
async function getSession(req) {
  const sid = req.signedCookies[COOKIE_NAME];
  if (!sid) return null;
  const row = await db.get(
    `SELECT s.id as sid, u.id as userId, u.username, u.nickname
     FROM sessions s JOIN users u ON s.user_id = u.id
     WHERE s.id = ?`,
    [sid]
  );
  return row || null;
}
async function destroySession(req, res) {
  const sid = req.signedCookies[COOKIE_NAME];
  if (sid) await db.run(`DELETE FROM sessions WHERE id = ?`, [sid]);
  res.clearCookie(COOKIE_NAME, COOKIE_OPTS);
}
async function authRequired(req, res, next) {
  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ error: "로그인이 필요합니다." });
  await db.run(`UPDATE sessions SET last_seen = ? WHERE id = ?`, [nowISO(), sess.sid]);
  req.user = { id: sess.userId, username: sess.username, nickname: sess.nickname };
  next();
}

/* -------------------- Auth APIs -------------------- */
app.post("/api/auth/signup", csrfProtection, async (req, res) => {
  try {
    let { username, password } = req.body;
    username = String(username || "").trim();
    password = String(password || "");

    if (!/^[a-zA-Z0-9_.]{4,32}$/.test(username)) {
      return res.status(400).json({ error: "아이디는 영문/숫자/._ 4~32자" });
    }
    if (password.length < 6 || password.length > 128) {
      return res.status(400).json({ error: "비밀번호는 6~128자" });
    }

    const exists = await db.get(`SELECT 1 FROM users WHERE username = ?`, [username]);
    if (exists) return res.status(409).json({ error: "이미 사용 중인 아이디" });

    const password_hash = await bcrypt.hash(password, 12);
    const id = "u_" + nanoid(16);
    await db.run(
      `INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)`,
      [id, username, password_hash, nowISO()]
    );

    await createSession(id, req, res);
    res.json({ ok: true, userId: id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "서버 오류" });
  }
});

app.post("/api/auth/login", csrfProtection, async (req, res) => {
  try {
    let { username, password } = req.body;
    username = String(username || "").trim();
    password = String(password || "");
    const user = await db.get(`SELECT * FROM users WHERE username = ?`, [username]);
    if (!user) return res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    await createSession(user.id, req, res);
    res.json({ ok: true, userId: user.id, nickname: user.nickname || null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "서버 오류" });
  }
});

app.post("/api/auth/logout", csrfProtection, async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
});

app.get("/api/auth/session", async (req, res) => {
  const sess = await getSession(req);
  if (!sess) return res.json({ loggedIn: false });
  res.json({
    loggedIn: true,
    userId: sess.userId,
    username: sess.username,
    nickname: sess.nickname || null,
  });
});

/* -------------------- Users / Profile -------------------- */
// 닉네임 중복 체크(선택)
app.post("/api/users/check-nickname", csrfProtection, authRequired, async (req, res) => {
  try {
    const nickname = String(req.body?.nickname || "").trim();
    if (!nickname) return res.json({ exists: false });
    const row = await db.get(
      `SELECT 1 FROM users WHERE nickname = ? AND id <> ?`,
      [nickname, req.user.id]
    );
    res.json({ exists: !!row });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "서버 오류" });
  }
});

// 닉네임/소개 업데이트 (닉네임 UNIQUE)
app.patch("/api/users/me", csrfProtection, authRequired, async (req, res) => {
  try {
    let { nickname, bio } = req.body;
    nickname = String(nickname || "").replace(/\s+/g, " ").trim();
    if (nickname.length < 1 || nickname.length > 24) {
      return res.status(400).json({ error: "닉네임은 1~24자" });
    }
    const taken = await db.get(
      `SELECT 1 FROM users WHERE nickname = ? AND id <> ?`,
      [nickname, req.user.id]
    );
    if (taken) return res.status(409).json({ error: "이미 사용 중인 닉네임입니다." });

    const bioSafe = String(bio || "").slice(0, 160);
    await db.run(`UPDATE users SET nickname = ?, bio = ? WHERE id = ?`, [nickname, bioSafe, req.user.id]);
    res.json({ ok: true, nickname, bio: bioSafe });
  } catch (e) {
    if (String(e?.message || "").includes("UNIQUE") || String(e?.code || "") === "SQLITE_CONSTRAINT") {
      return res.status(409).json({ error: "이미 사용 중인 닉네임입니다." });
    }
    console.error(e);
    res.status(500).json({ error: "서버 오류" });
  }
});

// (호환용) bio만 별도 업데이트
app.patch("/api/users/me/bio", csrfProtection, authRequired, async (req, res) => {
  try {
    const bioSafe = String(req.body?.bio || "").slice(0, 160);
    await db.run(`UPDATE users SET bio = ? WHERE id = ?`, [bioSafe, req.user.id]);
    res.json({ ok: true, bio: bioSafe });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "서버 오류" });
  }
});

// 아바타 업로드(단일) ? ★ 중복 없이 이거 한 개만!
app.post(
  "/api/users/me/avatar",
  csrfProtection,
  authRequired,
  uploadAvatar.single("avatar"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "파일 없음" });
      const webPath = `/uploads/${req.file.filename}`;
      await db.run(`UPDATE users SET avatar_url = ? WHERE id = ?`, [webPath, req.user.id]);
      res.json({ ok: true, avatar_url: webPath });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "업로드 실패" });
    }
  }
);

// 사용자 검색
app.get("/api/users/search", authRequired, async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json({ users: [] });
  const rows = await db.all(
    `SELECT id, username, nickname, avatar_url
     FROM users
     WHERE (nickname LIKE ? OR username LIKE ?)
     ORDER BY (nickname LIKE ?) DESC, nickname ASC
     LIMIT 20`,
    [`${q}%`, `${q}%`, `${q}%`]
  );
  res.json({ users: rows });
});

// 특정 사용자 프로필 + 나와의 친구 상태
app.get("/api/users/:id", authRequired, async (req, res) => {
  const userId = String(req.params.id);
  const row = await db.get(
    `SELECT id, username, nickname, avatar_url, bio, created_at
     FROM users WHERE id = ?`,
    [userId]
  );
  if (!row) return res.status(404).json({ error: "존재하지 않는 사용자" });

  const me = req.user.id;
  const fr = await db.get(
    `SELECT status, requester_id, addressee_id
       FROM friends
      WHERE (requester_id = ? AND addressee_id = ?)
         OR (requester_id = ? AND addressee_id = ?)`,
    [me, userId, userId, me]
  );
  res.json({ user: row, relation: fr || null });
});

/* -------------------- Friends APIs -------------------- */
app.post("/api/friends/request", csrfProtection, authRequired, async (req, res) => {
  const me = req.user.id;
  const { toUserId } = req.body || {};
  if (!toUserId || toUserId === me) return res.status(400).json({ error: "잘못된 대상" });

  const existsUser = await db.get(`SELECT 1 FROM users WHERE id = ?`, [toUserId]);
  if (!existsUser) return res.status(404).json({ error: "대상이 존재하지 않음" });

  const existing = await db.get(
    `SELECT * FROM friends WHERE
     (requester_id = ? AND addressee_id = ?)
     OR (requester_id = ? AND addressee_id = ?)`,
    [me, toUserId, toUserId, me]
  );
  const now = nowISO();

  if (!existing) {
    const id = "fr_" + nanoid(16);
    await db.run(
      `INSERT INTO friends (id, requester_id, addressee_id, status, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
      [id, me, toUserId, now, now]
    );
    return res.json({ ok: true, status: "pending" });
  }
  if (existing.status === "accepted") return res.status(409).json({ error: "이미 친구입니다." });
  if (existing.status === "pending") return res.status(409).json({ error: "이미 요청 대기 중" });

  await db.run(`UPDATE friends SET status='pending', updated_at=? WHERE id=?`, [now, existing.id]);
  res.json({ ok: true, status: "pending" });
});

app.post("/api/friends/respond", csrfProtection, authRequired, async (req, res) => {
  const me = req.user.id;
  const { fromUserId, action } = req.body || {};
  if (!fromUserId || !["accept", "reject"].includes(action)) {
    return res.status(400).json({ error: "파라미터 오류" });
  }
  const fr = await db.get(
    `SELECT * FROM friends WHERE requester_id = ? AND addressee_id = ?`,
    [fromUserId, me]
  );
  if (!fr || fr.status !== "pending") {
    return res.status(404).json({ error: "대기중 요청이 없음" });
  }
  const now = nowISO();
  const newStatus = action === "accept" ? "accepted" : "rejected";
  await db.run(`UPDATE friends SET status=?, updated_at=? WHERE id=?`, [newStatus, now, fr.id]);
  res.json({ ok: true, status: newStatus });
});

app.get("/api/friends/list", authRequired, async (req, res) => {
  const me = req.user.id;
  const rows = await db.all(
    `SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS friend_id
       FROM friends
      WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`,
    [me, me, me]
  );
  if (rows.length === 0) return res.json({ friends: [] });
  const ids = rows.map(r => r.friend_id);
  const placeholders = ids.map(() => "?").join(",");
  const users = await db.all(
    `SELECT id, username, nickname, avatar_url FROM users WHERE id IN (${placeholders})`,
    ids
  );
  res.json({ friends: users });
});

/* -------------------- Diary APIs -------------------- */
// 다이어리 업로드 (여러 장)
app.post("/api/diary", csrfProtection, authRequired, (req, res) => {
  uploadDiaryMany.array("images", 9)(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ error: err.message || "업로드 실패" });
      const { date, text } = req.body || {};
      const images = req.files || [];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return res.status(400).json({ error: "잘못된 날짜" });
      if (!images.length) return res.status(400).json({ error: "이미지 파일 필요" });

      const entryId = "de_" + nanoid(16);
      const now = nowISO();
      const thumb = `/uploads/${images[0].filename}`;

      await db.run(
        `INSERT INTO diary_entries (id, user_id, date, text, thumbnail_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [entryId, req.user.id, date, String(text || ""), thumb, now, now]
      );
      for (let i = 0; i < images.length; i++) {
        await db.run(
          `INSERT INTO diary_photos (id, entry_id, user_id, order_index, image_url, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          ["dp_" + nanoid(12), entryId, req.user.id, i, `/uploads/${images[i].filename}`, now]
        );
      }
      res.json({ ok: true, entryId, thumbnail_url: thumb, count: images.length });
    } catch (e2) {
      console.error(e2);
      res.status(500).json({ error: "업로드 실패" });
    }
  });
});

// 프로필 갤러리용
app.get("/api/diary/:userId/photos", authRequired, async (req, res) => {
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || "60", 10)));
  const rows = await db.all(
    `SELECT p.image_url, e.date, e.text, p.order_index
       FROM diary_photos p
       JOIN diary_entries e ON p.entry_id = e.id
      WHERE e.user_id = ?
      ORDER BY e.date DESC, p.order_index ASC
      LIMIT ?`,
    [req.params.userId, limit]
  );
  res.json({ items: rows });
});

// 특정 날짜의 내 다이어리
app.get("/api/diary/day/:date", authRequired, async (req, res) => {
  const date = String(req.params.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "잘못된 날짜" });
  const entry = await db.get(
    `SELECT id, text, thumbnail_url FROM diary_entries WHERE user_id = ? AND date = ?`,
    [req.user.id, date]
  );
  if (!entry) return res.json({ entry: null, photos: [] });
  const photos = await db.all(
    `SELECT id, order_index, image_url FROM diary_photos WHERE entry_id = ? ORDER BY order_index ASC`,
    [entry.id]
  );
  res.json({ entry, photos });
});

// 다이어리 삭제
app.delete("/api/diary/entry/:id", csrfProtection, authRequired, async (req, res) => {
  const id = String(req.params.id);
  const row = await db.get(`SELECT 1 FROM diary_entries WHERE id = ? AND user_id = ?`, [id, req.user.id]);
  if (!row) return res.status(404).json({ error: "엔트리가 없거나 권한 없음" });
  await db.run(`DELETE FROM diary_entries WHERE id = ?`, [id]);
  res.json({ ok: true });
});

// 사진 한 장 삭제
app.delete("/api/diary/photo/:id", csrfProtection, authRequired, async (req, res) => {
  const id = String(req.params.id);
  const row = await db.get(
    `SELECT p.id FROM diary_photos p JOIN diary_entries e ON p.entry_id = e.id
      WHERE p.id = ? AND e.user_id = ?`,
    [id, req.user.id]
  );
  if (!row) return res.status(404).json({ error: "사진이 없거나 권한 없음" });
  await db.run(`DELETE FROM diary_photos WHERE id = ?`, [id]);
  res.json({ ok: true });
});

/* -------------------- Schedules APIs -------------------- */
app.post("/api/schedules", csrfProtection, authRequired, async (req, res) => {
  try {
    const { title, start_at, end_at, location } = req.body || {};
    if (!title || !start_at) return res.status(400).json({ error: "title, start_at 필요" });
    const id = "sc_" + nanoid(16);
    const now = nowISO();
    await db.run(
      `INSERT INTO schedules (id, user_id, title, start_at, end_at, location, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.user.id, String(title).slice(0,120), start_at, end_at || null, String(location || "").slice(0,120), now, now]
    );
    res.json({ ok: true, id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "서버 오류" });
  }
});

app.get("/api/schedules/day/:date", authRequired, async (req, res) => {
  const date = String(req.params.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "잘못된 날짜" });
  const rows = await db.all(
    `SELECT id, title, start_at, end_at, location
       FROM schedules
      WHERE user_id = ? AND date(start_at) = date(?)
      ORDER BY start_at ASC`,
    [req.user.id, date]
  );
  res.json({ items: rows });
});

app.get("/api/schedules/range", authRequired, async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: "start,end 필요" });
  const rows = await db.all(
    `SELECT id, title, start_at, end_at, location
       FROM schedules
      WHERE user_id = ? AND date(start_at) BETWEEN date(?) AND date(?)
      ORDER BY start_at ASC`,
    [req.user.id, String(start), String(end)]
  );
  res.json({ items: rows });
});

app.patch("/api/schedules/:id", csrfProtection, authRequired, async (req, res) => {
  const id = String(req.params.id);
  const own = await db.get(`SELECT 1 FROM schedules WHERE id = ? AND user_id = ?`, [id, req.user.id]);
  if (!own) return res.status(404).json({ error: "일정이 없거나 권한 없음" });
  const { title, start_at, end_at, location } = req.body || {};
  await db.run(
    `UPDATE schedules SET
       title = COALESCE(?, title),
       start_at = COALESCE(?, start_at),
       end_at = COALESCE(?, end_at),
       location = COALESCE(?, location),
       updated_at = ?
     WHERE id = ?`,
    [
      title ? String(title).slice(0,120) : null,
      start_at || null,
      end_at || null,
      location ? String(location).slice(0,120) : null,
      nowISO(),
      id,
    ]
  );
  res.json({ ok: true });
});

app.delete("/api/schedules/:id", csrfProtection, authRequired, async (req, res) => {
  const id = String(req.params.id);
  const own = await db.get(`SELECT 1 FROM schedules WHERE id = ? AND user_id = ?`, [id, req.user.id]);
  if (!own) return res.status(404).json({ error: "일정이 없거나 권한 없음" });
  await db.run(`DELETE FROM schedules WHERE id = ?`, [id]);
  res.json({ ok: true });
});

/* -------------------- Calendar Monthly Overview -------------------- */
app.get("/api/calendar/overview", authRequired, async (req, res) => {
  let year = parseInt(String(req.query.year || ""), 10);
  let month = parseInt(String(req.query.month || ""), 10);
  const today = new Date();
  if (!year || !month) { year = today.getFullYear(); month = today.getMonth() + 1; }
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);
  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);

  const diaryRows = await db.all(
    `SELECT date as d, COUNT(*) as cnt, MAX(thumbnail_url) as thumb
       FROM diary_entries
      WHERE user_id = ? AND date BETWEEN ? AND ?
      GROUP BY date`,
    [req.user.id, startStr, endStr]
  );
  const schedRows = await db.all(
    `SELECT date(start_at) as d, COUNT(*) as cnt
       FROM schedules
      WHERE user_id = ? AND date(start_at) BETWEEN date(?) AND date(?)
      GROUP BY date(start_at)`,
    [req.user.id, startStr, endStr]
  );

  const map = new Map();
  for (let d = 1; d <= endDate.getDate(); d++) {
    const ds = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    map.set(ds, { date: ds, hasDiary: false, diaryThumb: null, diaryCount: 0, scheduleCount: 0 });
  }
  diaryRows.forEach(r => {
    if (map.has(r.d)) {
      const m = map.get(r.d);
      m.hasDiary = true;
      m.diaryThumb = r.thumb || null;
      m.diaryCount = Number(r.cnt) || 0;
    }
  });
  schedRows.forEach(r => {
    if (map.has(r.d)) {
      const m = map.get(r.d);
      m.scheduleCount = Number(r.cnt) || 0;
    }
  });
  res.json({ year, month, days: Array.from(map.values()) });
});

/* -------------------- Protected Page & Static -------------------- */
app.get("/calendar.html", async (req, res) => {
  const sess = await getSession(req);
  if (!sess) return res.redirect("/login.html");
  res.sendFile(path.join(__dirname, "public", "calendar.html"));
});

app.use(
  express.static(path.join(__dirname, "public"), {
    extensions: ["html"],
    etag: true,
    lastModified: true,
  })
);

app.get("/", (req, res) => {
  res.redirect("/login.html");
});

/* -------------------- Error Handling -------------------- */
app.use((err, req, res, next) => {
  if (err.code === "EBADCSRFTOKEN") {
    return res.status(403).json({ error: "CSRF token invalid" });
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "서버 오류" });
});

/* -------------------- Start -------------------- */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`? Server started on PORT ${PORT}`);
});


