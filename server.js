const express = require('express');
const multer = require('multer');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3456;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// --- æ¿é´ç®¡ç ---
const rooms = new Map(); // roomCode -> { files: [], clients: Set<ws> }

function getOrCreateRoom(code) {
  if (!rooms.has(code)) {
    const roomDir = path.join(UPLOAD_DIR, code);
    fs.mkdirSync(roomDir, { recursive: true });
    rooms.set(code, { files: [], clients: new Set(), dir: roomDir });
  }
  return rooms.get(code);
}

function broadcastToRoom(code, message, exclude) {
  const room = rooms.get(code);
  if (!room) return;
  const data = JSON.stringify(message);
  for (const client of room.clients) {
    if (client !== exclude && client.readyState === 1) {
      client.send(data);
    }
  }
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
    // ä¿çåå§æä»¶åï¼å²çªæ¶å éæºåç¼
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);
    const safeName = `${base}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    cb(null, safeName);
  },
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// --- éææä»¶ ---
app.use(express.static(path.join(__dirname, 'public')));

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

  // éç¥æ¿é´åææå®¢æ·ç«¯
  broadcastToRoom(code, { type: 'file_added', file: fileInfo });

  res.json({ ok: true, file: fileInfo });
});

app.get('/api/room/:code/files', (req, res) => {
  const room = rooms.get(req.params.code);
  res.json({ files: room ? room.files : [] });
});

app.get('/api/room/:code/download/:fileId', (req, res) => {
  const room = rooms.get(req.params.code);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const file = room.files.find((f) => f.id === req.params.fileId);
  if (!file) return res.status(404).json({ error: 'File not found' });

  const filePath = path.join(room.dir, file.storedName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing' });

  res.download(filePath, file.name);
});

// --- WebSocket ---
wss.on('connection', (ws) => {
  let currentRoom = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'join') {
        const code = String(msg.code).trim();
        if (!code) return;
        // ç¦»å¼æ§æ¿é´
        if (currentRoom && rooms.has(currentRoom)) {
          rooms.get(currentRoom).clients.delete(ws);
        }
        currentRoom = code;
        const room = getOrCreateRoom(code);
        room.clients.add(ws);
        ws.send(JSON.stringify({ type: 'joined', code, files: room.files }));
      }
    } catch {}
  });

  ws.on('close', () => {
    if (currentRoom && rooms.has(currentRoom)) {
      rooms.get(currentRoom).clients.delete(ws);
    }
  };
});

server.listen(PORT, () => {
  console.log(`Kindle Transfer running at http://localhost:${PORT}`);
});
