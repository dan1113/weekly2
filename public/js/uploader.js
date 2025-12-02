// public/js/uploader.js – R2 direct upload helper (presign batch)
import { API_BASE, AUTH_HEADERS } from './config.js';

export function selectFiles({ multiple = true, accept = 'image/*' } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files || []));
    input.click();
  });
}

export async function presignBatch(calendarDate, files) {
  const items = files.map(f => ({ mime: f.type, ext: extFromName(f.name), bytes: f.size }));
  const res = await fetch(`${API_BASE}/api/upload/presign-batch`, {
    method: 'POST', credentials: 'include',
    headers: AUTH_HEADERS({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ count: items.length, items, calendarDate })
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok || !data?.ok) throw new Error(data?.message || data?.error || 'presign failed');
  return data.items;
}

export async function uploadOne(file, presigned, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', presigned.uploadUrl, true);
    const headers = presigned.headers || {};
    Object.entries(headers).forEach(([k,v])=>xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && typeof onProgress === 'function') {
        const pct = Math.round((e.loaded / e.total) * 100);
        onProgress(pct);
      }
    };
    xhr.onerror = () => reject(new Error('network error'));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve({ key: presigned.key });
      else reject(new Error(`upload failed: ${xhr.status}`));
    };
    xhr.send(file);
  });
}

export async function uploadWithRetry(file, presigned, onProgress, maxRetry = 3) {
  let attempt = 0;
  while (attempt < maxRetry) {
    try { return await uploadOne(file, presigned, onProgress); }
    catch(e) {
      attempt++;
      if (attempt >= maxRetry) throw e;
      await new Promise(r => setTimeout(r, 400 * Math.pow(2, attempt-1)));
    }
  }
}

export async function complete(calendarDate, filesPayload) {
  const res = await fetch(`${API_BASE}/api/upload/complete`, {
    method: 'POST', credentials: 'include',
    headers: AUTH_HEADERS({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ calendarDate, files: filesPayload })
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok || !data?.ok) throw new Error(data?.message || data?.error || 'complete failed');
  return data.items || [];
}

export function extFromName(name=''){
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

export function mimeToExt(m){
  const map={ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/avif':'avif','image/gif':'gif' };
  return map[m];
}

// --- Compatibility shim: legacy single-file upload API ---
// Some existing code calls uploadFile(file[, calendarDate]). Route it through
// the new presign → direct PUT → complete pipeline and return the key/url.
export async function uploadFile(file, calendarDate) {
  if (!(file instanceof File)) throw new Error('파일이 없습니다.');
  const d = typeof calendarDate === 'string' ? calendarDate : (new Date()).toISOString().slice(0,10);
  const pres = await presignBatch(d, [file]);
  const p = pres[0];
  await uploadWithRetry(file, p, () => {});
  await complete(d, [{ key: p.key, bytes: file.size, width: null, height: null, mime: file.type, order: 0 }]);
  return { key: p.key, url: p.cdnUrl || `${API_BASE}/cdn/r2/${encodeURIComponent(p.key)}` };
}
