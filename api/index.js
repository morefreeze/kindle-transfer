const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();

const UPLOAD_DIR = path.join('/tmp', 'kindle-uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// --- æ¿é´ç®¡ç (åå­ + /tmp æä»¶) ---
const rooms = new Map(); // roomCode -> { files: [] }

function getOrCreateRoom(code) {
  if (!rooms.has(code)) {
    const roomDir = path.join(UPLOAD_DIR, code);
    fs.mkdirSync(roomDir, { recursive: true });
    // å°è¯ä» /tmp æ¢å¤å·²ææä»¶åæ°æ®
    const metaPath = path.join(roomDir, '_meta.json');
    let files = [];
    try {
      if (fs.existsSync(metaPath)) {
        files = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      }
    } catch {}
    rooms.set(code, { files, dir: roomDir });
  }
  return rooms.get(code);
}

function saveRoomMeta(code) {
  const room = rooms.get(code);
  if (!room) return;
  const metaPath = path.join(room.dir, '_meta.json');
  try {
    fs.writeFileSync(metaPath, JSON.stringify(room.files));
  } catch {}
}

// --- æä»¶ä¸ä¼  ---
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const code = req.params.code;
    const dir = path.join(UPLOAD_DIR, code);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);
    const safeName = `${base}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    cb(null, safeName);
  },
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// --- CORS (Vercel å¯è½éè¦) ---
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// --- API ---
app.post('/api/room/:code/upload', upload.single('file'), (req, res) => {
  const { code } = req.params;
  const room = getOrCreateRoom(code);
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file' });

  const fileInfo = {
    id: crypto.randomBytes(8).toString('hex'),
    name: Buffer.from(file.originalname, 'latin1').toString('utf8'),
    size: file.size,
    storedName: file.filename,
    ext: path.extname(file.originalname).replace('.', '').toUpperCase(),
    uploadedAt: new Date().toISOString(),
  };
  room.files.push(fileInfo);
  saveRoomMeta(code);

  res.json({ ok: true, file: fileInfo });
});

app.get('/api/room/:code/files', (req, res) => {
  const room = getOrCreateRoom(req.params.code);
  res.json({ files: room ? room.files : [] });
});

app.get('/api/room/:code/download/:fileId', (req, res) => {
  const room = getOrCreateRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const file = room.files.find((f) => f.id === req.params.fileId);
  if (!file) return res.status(404).json({ error: 'File not found' });

  const filePath = path.join(room.dir, file.storedName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing from storage' });

  res.download(filePath, file.name);
});

module.exports = app;
