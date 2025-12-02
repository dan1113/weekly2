
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('./db'); // 기존 DB 연결 모듈 import

// 파일 업로드 설정
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/diary/'); // public/uploads/diary 폴더에 저장
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('이미지 파일만 업로드 가능합니다.'));
    }
  }
});

// 인증 체크 미들웨어
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user_id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// 다이어리 저장
router.post('/save', requireAuth, upload.array('photos', 5), async (req, res) => {
  const userId = req.session.user_id;
  const { date, note } = req.body;
  
  try {
    const entryId = uuidv4();
    const now = new Date().toISOString();
    
    // 기존 엔트리 확인
    const existing = await db.get(
      'SELECT id FROM diary_entries WHERE user_id = ? AND date = ?',
      [userId, date]
    );
    
    if (existing) {
      // 업데이트
      await db.run(
        'UPDATE diary_entries SET note = ?, updated_at = ? WHERE id = ?',
        [note, now, existing.id]
      );
      
      // 기존 사진 삭제
      const oldPhotos = await db.all(
        'SELECT photo_path FROM diary_photos WHERE diary_id = ?',
        [existing.id]
      );
      
      // 파일 시스템에서 삭제
      const fs = require('fs');
      oldPhotos.forEach(photo => {
        const filePath = path.join(__dirname, '..', photo.photo_path);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      });
      
      await db.run('DELETE FROM diary_photos WHERE diary_id = ?', [existing.id]);
      
      // 새 사진 추가
      if (req.files && req.files.length > 0) {
        for (let i = 0; i < req.files.length; i++) {
          await db.run(
            'INSERT INTO diary_photos (diary_id, photo_path, photo_order, created_at) VALUES (?, ?, ?, ?)',
            [existing.id, `/uploads/diary/${req.files[i].filename}`, i, now]
          );
        }
      }
      
      // 업데이트된 엔트리 조회
      const entry = await getEntryWithPhotos(existing.id);
      res.json({ success: true, entry });
      
    } else {
      // 새로 생성
      await db.run(
        'INSERT INTO diary_entries (id, user_id, date, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [entryId, userId, date, note, now, now]
      );
      
      // 사진 추가
      if (req.files && req.files.length > 0) {
        for (let i = 0; i < req.files.length; i++) {
          await db.run(
            'INSERT INTO diary_photos (diary_id, photo_path, photo_order, created_at) VALUES (?, ?, ?, ?)',
            [entryId, `/uploads/diary/${req.files[i].filename}`, i, now]
          );
        }
      }
      
      // 생성된 엔트리 조회
      const entry = await getEntryWithPhotos(entryId);
      res.json({ success: true, entry });
    }
    
  } catch (error) {
    console.error('Save error:', error);
    res.status(500).json({ error: 'Failed to save diary' });
  }
});

// 다이어리 삭제
router.delete('/delete', requireAuth, async (req, res) => {
  const userId = req.session.user_id;
  const { date } = req.body;
  
  try {
    // 엔트리 찾기
    const entry = await db.get(
      'SELECT id FROM diary_entries WHERE user_id = ? AND date = ?',
      [userId, date]
    );
    
    if (entry) {
      // 사진 파일 삭제
      const photos = await db.all(
        'SELECT photo_path FROM diary_photos WHERE diary_id = ?',
        [entry.id]
      );
      
      const fs = require('fs');
      const path = require('path');
      photos.forEach(photo => {
        const filePath = path.join(__dirname, '..', 'public', photo.photo_path);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      });
      
      // DB에서 삭제 (CASCADE로 photos도 자동 삭제됨)
      await db.run(
        'DELETE FROM diary_entries WHERE id = ?',
        [entry.id]
      );
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete diary' });
  }
});

// 다이어리 목록 조회
router.get('/list', requireAuth, async (req, res) => {
  const userId = req.session.user_id;
  const { year, month } = req.query;
  
  try {
    let query = 'SELECT * FROM diary_entries WHERE user_id = ?';
    let params = [userId];
    
    if (year && month) {
      const datePrefix = `${year}-${String(month).padStart(2, '0')}`;
      query += ' AND date LIKE ?';
      params.push(`${datePrefix}%`);
    }
    
    const entries = await db.all(query, params);
    
    // 각 엔트리의 사진 조회
    const entriesWithPhotos = await Promise.all(
      entries.map(entry => getEntryWithPhotos(entry.id))
    );
    
    // 날짜를 키로 하는 객체로 변환
    const entriesObj = {};
    entriesWithPhotos.forEach(entry => {
      entriesObj[entry.date] = entry;
    });
    
    res.json({ entries: entriesObj });
  } catch (error) {
    console.error('List error:', error);
    res.status(500).json({ error: 'Failed to fetch diary list' });
  }
});

// 헬퍼 함수: 엔트리와 사진 함께 조회
async function getEntryWithPhotos(entryId) {
  const entry = await db.get('SELECT * FROM diary_entries WHERE id = ?', [entryId]);
  const photos = await db.all(
    'SELECT photo_path FROM diary_photos WHERE diary_id = ? ORDER BY photo_order',
    [entryId]
  );
  
  return {
    id: entry.id,
    date: entry.date,
    note: entry.note,
    photos: photos.map(p => p.photo_path),
    createdAt: entry.created_at,
    updatedAt: entry.updated_at
  };
}

module.exports = router;