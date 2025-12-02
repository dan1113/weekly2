// src/worker.js
// Weekly Diary – Cloudflare Worker (D1 + CSRF + Auth + Avatar + Diary/Schedule)

const COOKIE_NAME = 'auth_session';
const SESSION_TTL = 7 * 24 * 60 * 60; // seconds

// =============== CORS ===============
// 강력한 CORS: 프런트 도메인(weeklydiary.store)을 허용. 자격 증명 허용.
const FRONT_ORIGIN = 'https://weeklydiary.store';
function buildCorsHeaders(origin) {
  const allow = origin === FRONT_ORIGIN ? origin : FRONT_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-Id, x-user-id, X-CSRF-Token, CSRF-Token',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
}
function withCors(resp, request, env) {
  const origin = request.headers.get('Origin');
  const h = buildCorsHeaders(origin);
  const r = new Response(resp.body, resp);
  Object.entries(h).forEach(([k, v]) => r.headers.set(k, v));
  // Security headers
  r.headers.set('X-Content-Type-Options', 'nosniff');
  r.headers.set('X-Frame-Options', 'DENY');
  r.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  r.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  r.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  r.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  // API responses should not be cached
  if ((new URL(request.url)).pathname.startsWith('/api/')) {
    r.headers.set('Cache-Control', 'no-store');
  }
  return r;
}

// =============== Utils ===============
async function sha256Hex(msg) {
  const bytes = new TextEncoder().encode(msg);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateCsrfToken() {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return [...buf].map(b => b.toString(16).padStart(2, '0')).join('');
}
function setCsrfCookie(token, response, env) {
  const domain = env.COOKIE_DOMAIN ? `; Domain=${env.COOKIE_DOMAIN}` : '';
  const cookie = `csrf_token=${token}; Max-Age=${SESSION_TTL}; Path=/; HttpOnly; Secure; SameSite=Strict${domain}`;
  response.headers.append('Set-Cookie', cookie);
}
function validateCsrfToken(request) {
  const header = request.headers.get('X-CSRF-Token') || request.headers.get('CSRF-Token');
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  if (!m) return false;
  return header === m[1];
}
function ymd(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const MAX_FILES_PER_DAY = 5;
const MAX_BASE64_LENGTH = 7 * 1024 * 1024; // roughly 5MB raw
function isValidDateStr(str = '') {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(str));
}
function base64Bytes(b64 = '') {
  const body = (b64 || '').split(',').pop() || '';
  const padding = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
  return Math.floor(body.length * 3 / 4) - padding;
}

// =============== D1 helpers & schema ===============
async function runWithRetries(operation, env, retries = 3, delay = 300) {
  const DB = env.DB;
  if (!DB) throw new Error('D1_NOT_BOUND: DB binding missing');
  for (let i = 0; i < retries; i++) {
    try { return await operation(DB); }
    catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, delay * Math.pow(2, i)));
    }
  }
}
async function ensureSchema(env) {
  const DB = env.DB;
  if (!DB) throw new Error('D1_NOT_BOUND: DB binding missing');

  const ddls = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nickname TEXT,
      created_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER,
      last_seen INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS diary_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER,
      updated_at INTEGER,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_diary_user_id ON diary_entries (user_id)`,
    `CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      start_at TEXT NOT NULL,
      location TEXT,
      created_at INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS idx_sched_user_start ON schedules (user_id, start_at)`
  ];

  try {
    for (const sql of ddls) await DB.prepare(sql).run();
    // add-on columns (idempotent)
    await DB.prepare(`ALTER TABLE users ADD COLUMN avatar_url TEXT`).run().catch(() => {});
    await DB.prepare(`ALTER TABLE users ADD COLUMN bio TEXT`).run().catch(() => {});
    // base64 diary storage
    await DB.prepare(`CREATE TABLE IF NOT EXISTS diary_daily_entries (
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      text TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id, date)
    )`).run();
    await DB.prepare(`CREATE TABLE IF NOT EXISTS diary_photos (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      filename TEXT,
      base64_data TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`).run();
    await DB.prepare(`CREATE INDEX IF NOT EXISTS idx_diary_photos_user_date ON diary_photos(user_id, date, order_index)`).run();
    await DB.prepare(`ALTER TABLE diary_photos ADD COLUMN base64_data TEXT`).run().catch(() => {});
    await DB.prepare(`ALTER TABLE diary_photos ADD COLUMN mime_type TEXT`).run().catch(() => {});
    await DB.prepare(`ALTER TABLE diary_photos ADD COLUMN filename TEXT`).run().catch(() => {});
    await DB.prepare(`ALTER TABLE diary_photos ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0`).run().catch(() => {});
  } catch (e) {
    console.error('SCHEMA_SETUP_CRITICAL_FAIL:', e?.message || e);
    throw new Error(`CRITICAL D1 ERROR during schema setup: ${e.message || e}`);
  }
}

// =============== Auth ===============
async function handleSignup(request, env) {
  const corsH = buildCorsHeaders(request.headers.get('Origin'));
  if (!validateCsrfToken(request)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), { status: 403, headers: corsH });
  }

  const { username, password, nickname } = await request.json();
  if (!username || !password) {
    return new Response(JSON.stringify({ error: 'Username and password are required' }), { status: 400, headers: corsH });
  }

  try { await ensureSchema(env); }
  catch (e) {
    return new Response(JSON.stringify({ error: 'Internal Server Error (Database Schema Setup Failed)', details: e.message }), { status: 500, headers: corsH });
  }

  try {
    const now = Date.now();
    const userId = await sha256Hex(username + now + Math.random());
    const pwHash = await sha256Hex(password);

    await runWithRetries(db =>
      db.prepare('INSERT INTO users (id, username, password_hash, nickname, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(userId, username, pwHash, nickname || null, now).run(), env);

    const token = await sha256Hex(userId + now + Math.random());
    await runWithRetries(db =>
      db.prepare('INSERT INTO sessions (id, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)')
        .bind(token, userId, now, now).run(), env);

    const resp = new Response(JSON.stringify({ message: 'Signup successful', userId }), { status: 201, headers: corsH });
    const domain = env.COOKIE_DOMAIN ? `; Domain=${env.COOKIE_DOMAIN}` : '';
    resp.headers.append('Set-Cookie', `${COOKIE_NAME}=${token}; Max-Age=${SESSION_TTL}; Path=/; HttpOnly; Secure; SameSite=None${domain}`);
    return resp;
  } catch (e) {
    if (String(e?.message).includes('UNIQUE constraint failed')) {
      return new Response(JSON.stringify({ error: 'Username already taken' }), { status: 409, headers: corsH });
    }
    console.error('Signup Error:', e);
    return new Response(JSON.stringify({ error: 'Internal Server Error (Signup Failed)', details: e.message }), { status: 500, headers: corsH });
  }
}

async function handleLogin(request, env) {
  const corsH = buildCorsHeaders(request.headers.get('Origin'));
  if (!validateCsrfToken(request)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), { status: 403, headers: corsH });
  }

  const { username, password } = await request.json();
  if (!username || !password) {
    return new Response(JSON.stringify({ error: 'Username and password are required' }), { status: 400, headers: corsH });
  }

  try { await ensureSchema(env); }
  catch (e) {
    return new Response(JSON.stringify({ error: 'Internal Server Error (Database Schema Setup Failed)', details: e.message }), { status: 500, headers: corsH });
  }

  try {
    const found = await runWithRetries(db =>
      db.prepare('SELECT id, password_hash FROM users WHERE username = ?').bind(username).all(), env);
    const user = found.results?.[0];
    if (!user) return new Response(JSON.stringify({ error: 'Invalid username or password' }), { status: 401, headers: corsH });

    const ok = (await sha256Hex(password)) === user.password_hash;
    if (!ok) return new Response(JSON.stringify({ error: 'Invalid username or password' }), { status: 401, headers: corsH });

    const now = Date.now();
    const token = await sha256Hex(user.id + now + Math.random());
    await runWithRetries(db =>
      db.prepare('INSERT INTO sessions (id, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)')
        .bind(token, user.id, now, now).run(), env);

    const resp = new Response(JSON.stringify({ message: 'Login successful', userId: user.id }), { status: 200, headers: corsH });
    const domain = env.COOKIE_DOMAIN ? `; Domain=${env.COOKIE_DOMAIN}` : '';
    resp.headers.append('Set-Cookie', `${COOKIE_NAME}=${token}; Max-Age=${SESSION_TTL}; Path=/; HttpOnly; Secure; SameSite=None${domain}`);
    return resp;
  } catch (e) {
    console.error('Login Error:', e);
    return new Response(JSON.stringify({ error: 'Internal Server Error (Login Failed)', details: e.message }), { status: 500, headers: corsH });
  }
}

async function handleLogout(request, env) {
  const corsH = buildCorsHeaders(request.headers.get('Origin'));
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  const token = m ? m[1] : null;

  if (token) {
    try { await runWithRetries(db => db.prepare('DELETE FROM sessions WHERE id = ?').bind(token).run(), env); }
    catch (e) { console.error('Logout deletion error:', e); }
  }

  const resp = new Response(JSON.stringify({ message: 'Logout successful' }), { status: 200, headers: corsH });
  const domain = env.COOKIE_DOMAIN ? `; Domain=${env.COOKIE_DOMAIN}` : '';
  resp.headers.set('Set-Cookie', `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=None${domain}`);
  return resp;
}

async function authenticate(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  const token = m ? m[1] : null;
  if (!token) return null;

  try {
    const threshold = Date.now() - SESSION_TTL * 1000;
    const hit = await runWithRetries(db =>
      db.prepare('SELECT user_id FROM sessions WHERE id = ? AND created_at > ?').bind(token, threshold).all(), env);
    const row = hit.results?.[0];
    if (!row) return null;

    await runWithRetries(db =>
      db.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?').bind(Date.now(), token).run(), env);

    return row.user_id;
  } catch (e) {
    console.error('Auth Error:', e);
    return null;
  }
}

async function handleSession(request, env) {
  const corsH = buildCorsHeaders(request.headers.get('Origin'), env);
  try {
    const userId = await authenticate(request, env);
    if (!userId) {
      return new Response(JSON.stringify({ loggedIn: false }), { status: 200, headers: corsH });
    }
    const q = await env.DB.prepare('SELECT username, nickname, avatar_url FROM users WHERE id = ?').bind(userId).all();
    const u = q.results?.[0] || {};
    return new Response(JSON.stringify({
      loggedIn: true,
      userId,
      username: u.username || null,
      nickname: u.nickname || null,
      avatar_url: u.avatar_url || null,
    }), { status: 200, headers: corsH });
  } catch (e) {
    console.error('SESSION ERROR:', e);
    return new Response(JSON.stringify({ loggedIn: false }), { status: 200, headers: corsH });
  }
}

// =============== Profile Avatar (base64 store) ===============
async function handleProfileAvatar(request, env, userId) {
  const corsH = buildCorsHeaders(request.headers.get('Origin'));
  await ensureSchema(env);

  let finalUrl = null;
  const ctype = request.headers.get('Content-Type') || '';

  if (ctype.includes('application/json')) {
    const { url, key } = await request.json().catch(() => ({}));
    if (url) finalUrl = url;
    if (!finalUrl && key) finalUrl = key;
  } else if (ctype.includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') {
      return new Response(JSON.stringify({ error: 'file not provided' }), { status: 400, headers: corsH });
    }
    const ab = await file.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(ab)));
    finalUrl = `data:${file.type || 'image/jpeg'};base64,${b64}`;
  }

  if (!finalUrl) {
    return new Response(JSON.stringify({ error: 'no image url/key given' }), { status: 400, headers: corsH });
  }

  await runWithRetries(db =>
    db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').bind(finalUrl, userId).run(), env);

  return new Response(JSON.stringify({ ok: true, avatar_url: finalUrl }), { status: 200, headers: corsH });
}

// =============== Diary (basic CRUD) ===============
async function handleGetDiaryEntries(request, env, userId) {
  const corsH = buildCorsHeaders(request.headers.get('Origin'), env);
  try {
    await ensureSchema(env);
    const res = await runWithRetries(db =>
      db.prepare('SELECT id, title, created_at, updated_at FROM diary_entries WHERE user_id = ? ORDER BY created_at DESC')
        .bind(userId).all(), env);
    return new Response(JSON.stringify(res.results || []), { status: 200, headers: corsH });
  } catch (e) {
    console.error('Get Diaries Error:', e);
    return new Response(JSON.stringify({ error: 'Internal Server Error (Get Diaries Failed)', details: e.message }), { status: 500, headers: corsH });
  }
}
async function handleCreateDiaryEntry(request, env, userId) {
  const corsH = buildCorsHeaders(request.headers.get('Origin'), env);
  if (!validateCsrfToken(request)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), { status: 403, headers: corsH });
  }
  const body = await request.json().catch(() => ({}));

  // Accept both shapes:
  // A) {title, content}
  // B) {date, text, photos:[{key}]}
  let title = body.title;
  let content = body.content;
  if (!title && body.date) title = `[${body.date}]`;
  if (!content && body.text) content = body.text;

  if (!title || !content) {
    return new Response(JSON.stringify({ error: 'Title and content are required' }), { status: 400, headers: corsH });
  }

  try {
    await ensureSchema(env);
    const id = crypto.randomUUID();
    const now = Date.now();
    await runWithRetries(db =>
      db.prepare('INSERT INTO diary_entries (id, user_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, userId, title, content, now, now).run(), env);

    // NOTE: photos ignored for now (no photo table)

    return new Response(JSON.stringify({ message: 'Entry created successfully', id }), { status: 201, headers: corsH });
  } catch (e) {
    console.error('Create Diary Error:', e);
    return new Response(JSON.stringify({ error: 'Internal Server Error (Create Diary Failed)', details: e.message }), { status: 500, headers: corsH });
  }
}
async function handleGetDiaryEntry(request, env, userId, entryId) {
  const corsH = buildCorsHeaders(request.headers.get('Origin'), env);
  try {
    await ensureSchema(env);
    const q = await runWithRetries(db =>
      db.prepare('SELECT id, title, content, created_at, updated_at FROM diary_entries WHERE id = ? AND user_id = ?')
        .bind(entryId, userId).all(), env);
    const entry = q.results?.[0];
    if (!entry) {
      return new Response(JSON.stringify({ error: 'Diary entry not found or unauthorized' }), { status: 404, headers: corsH });
    }
    return new Response(JSON.stringify(entry), { status: 200, headers: corsH });
  } catch (e) {
    console.error('Get Diary Error:', e);
    return new Response(JSON.stringify({ error: 'Internal Server Error (Get Diary Failed)', details: e.message }), { status: 500, headers: corsH });
  }
}
async function handleUpdateDiaryEntry(request, env, userId, entryId) {
  const corsH = buildCorsHeaders(request.headers.get('Origin'), env);
  if (!validateCsrfToken(request)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), { status: 403, headers: corsH });
  }
  const { title, content } = await request.json();
  if (!title || !content) {
    return new Response(JSON.stringify({ error: 'Title and content are required' }), { status: 400, headers: corsH });
  }

  try {
    await ensureSchema(env);
    const now = Date.now();
    const r = await runWithRetries(db =>
      db.prepare('UPDATE diary_entries SET title = ?, content = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .bind(title, content, now, entryId, userId).run(), env);
    if (!r.meta || r.meta.changes === 0) {
      return new Response(JSON.stringify({ error: 'Diary entry not found or unauthorized' }), { status: 404, headers: corsH });
    }
    return new Response(JSON.stringify({ message: 'Entry updated successfully', id: entryId }), { status: 200, headers: corsH });
  } catch (e) {
    console.error('Update Diary Error:', e);
    return new Response(JSON.stringify({ error: 'Internal Server Error (Update Diary Failed)', details: e.message }), { status: 500, headers: corsH });
  }
}
async function handleDeleteDiaryEntry(request, env, userId, entryId) {
  const corsH = buildCorsHeaders(request.headers.get('Origin'), env);
  if (!validateCsrfToken(request)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), { status: 403, headers: corsH });
  }

  try {
    await ensureSchema(env);
    const r = await runWithRetries(db =>
      db.prepare('DELETE FROM diary_entries WHERE id = ? AND user_id = ?').bind(entryId, userId).run(), env);
    if (!r.meta || r.meta.changes === 0) {
      return new Response(JSON.stringify({ error: 'Diary entry not found or unauthorized' }), { status: 404, headers: corsH });
    }
    return new Response(JSON.stringify({ message: 'Entry deleted successfully', id: entryId }), { status: 200, headers: corsH });
  } catch (e) {
    console.error('Delete Diary Error:', e);
    return new Response(JSON.stringify({ error: 'Internal Server Error (Delete Diary Failed)', details: e.message }), { status: 500, headers: corsH });
  }
}

// =============== Schedules (minimal) ===============
async function handleCreateSchedule(request, env, userId) {
  const corsH = buildCorsHeaders(request.headers.get('Origin'), env);
  if (!validateCsrfToken(request)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), { status: 403, headers: corsH });
  }
  const { title, start_at, location } = await request.json();
  if (!title || !start_at) {
    return new Response(JSON.stringify({ error: 'title/start_at required' }), { status: 400, headers: corsH });
  }
  await ensureSchema(env);
  const id = crypto.randomUUID();
  const now = Date.now();
  await runWithRetries(db =>
    db.prepare('INSERT INTO schedules (id, user_id, title, start_at, location, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, userId, title, start_at, location || null, now).run(), env);
  return new Response(JSON.stringify({ ok: true, id }), { status: 201, headers: corsH });
}
async function handleGetSchedulesByDay(request, env, userId, dateStr) {
  const corsH = buildCorsHeaders(request.headers.get('Origin'), env);
  await ensureSchema(env);
  const items = await runWithRetries(db =>
    db.prepare(`SELECT id, title, start_at, location FROM schedules 
                WHERE user_id = ? AND substr(start_at,1,10) = ? 
                ORDER BY start_at ASC`).bind(userId, dateStr).all(), env);
  return new Response(JSON.stringify({ items: items.results || [] }), { status: 200, headers: corsH });
}

// =============== Diary (Base64) ===============
async function upsertDiaryText(env, userId, dateStr, text) {
  const nowIso = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO diary_daily_entries (user_id, date, text, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?4)
    ON CONFLICT(user_id, date) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at
  `).bind(userId, dateStr, text, nowIso).run();
}

async function handleUploadBase64Diary(request, env, userId) {
  const corsH = buildCorsHeaders(request.headers.get('Origin'), env);
  await ensureSchema(env);
  const body = await request.json().catch(() => null);
  if (!body) return new Response(JSON.stringify({ error: 'BAD_JSON' }), { status: 400, headers: corsH });
  const { date, files = [], text = '' } = body;
  if (!isValidDateStr(date)) {
    return new Response(JSON.stringify({ error: 'BAD_DATE', message: 'YYYY-MM-DD required' }), { status: 400, headers: corsH });
  }
  if (!Array.isArray(files)) {
    return new Response(JSON.stringify({ error: 'FILES_REQUIRED' }), { status: 400, headers: corsH });
  }
  if (files.length > MAX_FILES_PER_DAY) {
    return new Response(JSON.stringify({ error: 'MAX_FILES_EXCEEDED', message: `최대 ${MAX_FILES_PER_DAY}장 업로드 가능` }), { status: 400, headers: corsH });
  }
  for (const f of files) {
    if (!f?.base64 || !f?.mime) {
      return new Response(JSON.stringify({ error: 'FILE_INVALID', message: 'base64/mime required' }), { status: 400, headers: corsH });
    }
    const approxBytes = base64Bytes(f.base64);
    if (f.base64.length > MAX_BASE64_LENGTH || approxBytes > 5 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'FILE_TOO_LARGE', message: '5MB 초과 파일 존재' }), { status: 400, headers: corsH });
    }
  }

  await env.DB.prepare(`DELETE FROM diary_photos WHERE user_id = ? AND date = ?`).bind(userId, date).run();

  const now = new Date().toISOString();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    await env.DB.prepare(`
      INSERT INTO diary_photos (id, user_id, date, filename, base64_data, mime_type, order_index, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    `).bind(
      crypto.randomUUID(),
      userId,
      date,
      f.filename || null,
      f.base64,
      f.mime,
      Number(f.order ?? i) || 0,
      now
    ).run();
  }

  if (text && String(text).trim()) {
    await upsertDiaryText(env, userId, date, String(text));
  }

  return new Response(JSON.stringify({ ok: true, count: files.length }), { status: 200, headers: corsH });
}

async function handleGetDiaryDayFull(request, env, userId, dateStr) {
  const corsH = buildCorsHeaders(request.headers.get('Origin'), env);
  if (!isValidDateStr(dateStr)) {
    return new Response(JSON.stringify({ error: 'BAD_DATE' }), { status: 400, headers: corsH });
  }
  await ensureSchema(env);
  const entry = await env.DB.prepare(`SELECT user_id, date, text, updated_at FROM diary_daily_entries WHERE user_id = ? AND date = ?`)
    .bind(userId, dateStr)
    .first()
    .catch(() => null);
  const photos = await env.DB.prepare(`
    SELECT id, filename, base64_data, mime_type, order_index
    FROM diary_photos
    WHERE user_id = ? AND date = ?
    ORDER BY order_index ASC
  `).bind(userId, dateStr).all();
  return new Response(JSON.stringify({ entry: entry || null, photos: photos.results || [] }), { status: 200, headers: corsH });
}

async function handleDeleteDiaryDay(request, env, userId, dateStr) {
  const corsH = buildCorsHeaders(request.headers.get('Origin'), env);
  if (!isValidDateStr(dateStr)) {
    return new Response(JSON.stringify({ error: 'BAD_DATE' }), { status: 400, headers: corsH });
  }
  await ensureSchema(env);
  await env.DB.prepare(`DELETE FROM diary_photos WHERE user_id = ? AND date = ?`).bind(userId, dateStr).run();
  await env.DB.prepare(`DELETE FROM diary_daily_entries WHERE user_id = ? AND date = ?`).bind(userId, dateStr).run();
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsH });
}

// =============== Calendar Overview (minimal) ===============
async function handleCalendarOverview(request, env, userId, y, m) {
  const corsH = buildCorsHeaders(request.headers.get('Origin'), env);
  await ensureSchema(env);

  const year = Number(y), month = Number(m); // 1-based
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);

  const startPrefix = `${year}-${String(month).padStart(2,'0')}-`;
  const rows = await runWithRetries(db =>
    db.prepare(`SELECT substr(start_at,1,10) as date, COUNT(*) as cnt 
                FROM schedules WHERE user_id = ? AND start_at LIKE ? 
                GROUP BY substr(start_at,1,10)`)
      .bind(userId, `${startPrefix}%`).all(), env);
  const thumbRows = await env.DB.prepare(`
    SELECT date, base64_data
    FROM diary_photos
    WHERE user_id = ? AND date LIKE ?
    AND order_index = (
      SELECT MIN(order_index) FROM diary_photos p2 WHERE p2.user_id = diary_photos.user_id AND p2.date = diary_photos.date
    )
  `).bind(userId, `${startPrefix}%`).all();

  const map = new Map();
  (rows.results || []).forEach(r => { map.set(r.date, r.cnt); });
  const thumbMap = new Map();
  (thumbRows.results || []).forEach(r => thumbMap.set(r.date, r.base64_data));

  const days = [];
  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
    const date = ymd(d);
    days.push({
      date,
      scheduleCount: map.get(date) || 0,
      diaryThumb: thumbMap.get(date) || null,
    });
  }
  return new Response(JSON.stringify({ days }), { status: 200, headers: corsH });
}

// =============== Admin / Debug ===============
async function handleResetDb(request, env) {
  const corsH = buildCorsHeaders(request.headers.get('Origin'), env);
  try {
    const DB = env.DB;
    if (!DB) throw new Error('D1_NOT_BOUND: DB binding missing');
    await DB.prepare('DROP TABLE IF EXISTS schedules').run();
    await DB.prepare('DROP TABLE IF EXISTS diary_photos').run();
    await DB.prepare('DROP TABLE IF EXISTS diary_daily_entries').run();
    await DB.prepare('DROP TABLE IF EXISTS diary_entries').run();
    await DB.prepare('DROP TABLE IF EXISTS sessions').run();
    await DB.prepare('DROP TABLE IF EXISTS users').run();
    await ensureSchema(env);
    return new Response(JSON.stringify({ ok: true, message: 'DB reset & schema recreated' }), { status: 200, headers: corsH });
  } catch (e) {
    return new Response(JSON.stringify({
      error: 'Internal Server Error (Database Schema Setup Failed)',
      details: `CRITICAL D1 ERROR during schema setup: ${e.message}`,
    }), { status: 500, headers: corsH });
  }
}
async function handleD1Test(request, env) {
  const corsH = buildCorsHeaders(request.headers.get('Origin'), env);
  try {
    await ensureSchema(env);
    const result = await runWithRetries(db => db.prepare('SELECT 1 AS test_val').all(), env);
    return new Response(JSON.stringify({ ok: true, message: 'D1 OK', result, binding_name: 'DB' }), { status: 200, headers: corsH });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'D1 CONNECTION FAILED', details: e.message }), { status: 500, headers: corsH });
  }
}

// =============== Router ===============
async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // Preflight
  if (method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), request, env);

  // Health / favicon
  if (path === '/health') return withCors(new Response(JSON.stringify({ ok: true })), request, env);
  if (path === '/favicon.ico') return withCors(new Response(null, { status: 204 }), request, env);

  // Admin
  if (path === '/api/admin/d1-test') return withCors(await handleD1Test(request, env), request, env);
  if (path === '/api/admin/reset-db' && url.searchParams.get('confirm') === 'true')
    return withCors(await handleResetDb(request, env), request, env);

  // CSRF
  if (path === '/api/csrf' && method === 'GET') {
    const token = generateCsrfToken();
    const resp = new Response(JSON.stringify({ csrfToken: token }), { status: 200 });
    setCsrfCookie(token, resp, env);
    return withCors(resp, request, env);
  }

  // Enforce CSRF for state-changing methods
  if (path.startsWith('/api/') && (method === 'POST' || method === 'PUT' || method === 'DELETE')) {
    if (!validateCsrfToken(request)) {
      return withCors(new Response(JSON.stringify({ error: 'CSRF token validation failed' }), { status: 403 }), request, env);
    }
  }

  // ===== Diary: Base64 upload =====
  if (path === '/api/diary/upload-base64' && method === 'POST') {
    const userId = await authenticate(request, env);
    if (!userId) return withCors(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }), request, env);
    return withCors(await handleUploadBase64Diary(request, env, userId), request, env);
  }

  // Auth (public)
  if (path === '/api/auth/signup' && method === 'POST') return withCors(await handleSignup(request, env), request, env);
  if (path === '/api/auth/login'  && method === 'POST') return withCors(await handleLogin(request, env), request, env);
  if (path === '/api/auth/session' && method === 'GET') return withCors(await handleSession(request, env), request, env);

  // Must be logged in below
  const userId = await authenticate(request, env);

  // Profile avatar (supports both /api/profile/avatar and legacy /api/users/me/avatar)
  if ((path === '/api/profile/avatar' || path === '/api/users/me/avatar') && method === 'POST') {
    if (!userId) return withCors(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }), request, env);
    return withCors(await handleProfileAvatar(request, env, userId), request, env);
  }

  // Profile bio update (frontend expects /api/users/me/bio)
  if (path === '/api/users/me/bio' && method === 'POST') {
    if (!userId) return withCors(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }), request, env);
    const corsH = buildCorsHeaders(request.headers.get('Origin'));
    try {
      await ensureSchema(env);
      const { bio } = await request.json().catch(()=>({}));
      const text = (bio || '').toString();
      if (text.length > 160) return withCors(new Response(JSON.stringify({ error: 'BIO_TOO_LONG' }), { status: 400, headers: corsH }), request, env);
      await runWithRetries(db => db.prepare('UPDATE users SET bio = ? WHERE id = ?').bind(text, userId).run(), env);
      return withCors(new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsH }), request, env);
    } catch (e) {
      return withCors(new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500, headers: corsH }), request, env);
    }
  }

  // /api/me
  if (path === '/api/me' && method === 'GET') {
    const corsH = buildCorsHeaders(request.headers.get('Origin'), env);
    if (!userId) return withCors(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsH }), request, env);
    try {
      await ensureSchema(env);
      const row = await runWithRetries(db =>
        db.prepare(`SELECT id, username, nickname, avatar_url, bio FROM users WHERE id = ?`).bind(userId).all(), env);
      const user = row.results?.[0] || null;
      return withCors(new Response(JSON.stringify({ user }), { status: 200, headers: corsH }), request, env);
    } catch (e) {
      const corsH2 = buildCorsHeaders(request.headers.get('Origin'));
      return withCors(new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500, headers: corsH2 }), request, env);
    }
  }

  // Auth logout
  if (path === '/api/auth/logout' && method === 'POST')
    return withCors(await handleLogout(request, env), request, env);

  // Calendar overview
  if (path === '/api/calendar/overview' && method === 'GET') {
    if (!userId) return withCors(new Response(JSON.stringify({ days: [] }), { status: 200 }), request, env);
    const y = url.searchParams.get('year');
    const m = url.searchParams.get('month');
    if (!y || !m) return withCors(new Response(JSON.stringify({ days: [] }), { status: 200 }), request, env);
    return withCors(await handleCalendarOverview(request, env, userId, y, m), request, env);
  }

  // Day queries used by UI
  if (path.startsWith('/api/diary/day/') && method === 'GET') {
    if (!userId) return withCors(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }), request, env);
    const dateStr = path.split('/').pop();
    return withCors(await handleGetDiaryDayFull(request, env, userId, dateStr), request, env);
  }
  if (path.startsWith('/api/diary/day/') && method === 'DELETE') {
    if (!userId) return withCors(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }), request, env);
    const dateStr = path.split('/').pop();
    return withCors(await handleDeleteDiaryDay(request, env, userId, dateStr), request, env);
  }
  if (path.startsWith('/api/schedules/day/') && method === 'GET') {
    if (!userId) return withCors(new Response(JSON.stringify({ items: [] }), { status: 200 }), request, env);
    const dateStr = path.split('/').pop();
    return withCors(await handleGetSchedulesByDay(request, env, userId, dateStr), request, env);
  }

  // Schedules create
  if (path === '/api/schedules' && method === 'POST') {
    if (!userId) return withCors(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }), request, env);
    return withCors(await handleCreateSchedule(request, env, userId), request, env);
  }

  // Diary CRUD (list/create/get/update/delete)
  const seg = path.split('/').filter(Boolean); // ['api','diary', ...]
  if (seg[0] === 'api' && seg[1] === 'diary') {
    if (!userId) return withCors(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }), request, env);
    const entryId = seg[2];
    if (!entryId) {
      if (method === 'GET')  return withCors(await handleGetDiaryEntries(request, env, userId), request, env);
      if (method === 'POST') return withCors(await handleCreateDiaryEntry(request, env, userId), request, env);
    } else {
      if (method === 'GET')    return withCors(await handleGetDiaryEntry(request, env, userId, entryId), request, env);
      if (method === 'PUT')    return withCors(await handleUpdateDiaryEntry(request, env, userId, entryId), request, env);
      if (method === 'DELETE') return withCors(await handleDeleteDiaryEntry(request, env, userId, entryId), request, env);
    }
  }

  return withCors(new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 }), request, env);
}

export default {
  async fetch(request, env, ctx) {
    try {
      const resp = await handleRequest(request, env);
      return withCors(resp, request, env);
    } catch (e) {
      console.error('UNHANDLED WORKER ERROR:', e?.message, e?.stack);
      const origin = request.headers.get('Origin');
      const headers = buildCorsHeaders(origin);
      let msg = 'Internal Server Error';
      if (String(e?.message).includes('D1_NOT_BOUND')) {
        msg = 'CRITICAL CONFIGURATION ERROR: D1 Binding (DB) missing or misconfigured.';
      } else if (String(e?.message).includes('CRITICAL D1 ERROR during schema setup')) {
        msg = 'CRITICAL D1 ERROR: Failed to setup database schema.';
      }
      return new Response(JSON.stringify({ error: msg, details: e?.message }), { status: 500, headers });
    }
  }
};
