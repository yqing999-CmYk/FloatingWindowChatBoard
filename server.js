require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const PASSCODE = process.env.LIBRARIAN_PASSCODE;

if (!PASSCODE) {
  console.error('ERROR: LIBRARIAN_PASSCODE is not set in .env');
  process.exit(1);
}

// Ensure logs directory exists
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);

// ─── Server state (1 librarian : 1 visitor) ───────────────────────────────────
let librarianSocket = null;
let visitorSocket   = null;
let sessionMessages = []; // { time, role, text }
let sessionStart    = null;

// One-time auth tokens: token -> true (deleted after use or 60s expiry)
const pendingTokens = new Set();

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/librarian', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'librarian.html'));
});

// Passcode authentication — returns a short-lived one-time token on success
app.post('/librarian/auth', (req, res) => {
  const { passcode } = req.body;

  if (!passcode || passcode !== PASSCODE) {
    return res.json({ success: false, message: 'Incorrect passcode.' });
  }
  if (librarianSocket !== null) {
    return res.json({ success: false, message: 'A librarian session is already active. Try again later.' });
  }

  const token = crypto.randomBytes(16).toString('hex');
  pendingTokens.add(token);
  setTimeout(() => pendingTokens.delete(token), 60_000); // 60 s expiry

  return res.json({ success: true, token });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function nowTime() {
  return new Date().toTimeString().slice(0, 8); // HH:MM:SS
}

function isoNow() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function appendToLog() {
  if (sessionMessages.length === 0) return;
  const logFile = path.join(logsDir, 'chat-log.txt');
  const divider = '='.repeat(80);
  const lines = [
    divider,
    `Session: ${sessionStart}`,
    divider,
    ...sessionMessages.map(m => `[${m.time}] ${m.role}: ${m.text}`),
    divider,
    '',
  ];
  fs.appendFileSync(logFile, lines.join('\n') + '\n');
  console.log(`[log] Session appended to chat-log.txt (${sessionMessages.length} messages)`);
}

// Called when visitor disconnects — keep librarian connected for next visitor
function endVisitorSession() {
  appendToLog();
  sessionMessages = [];
  sessionStart    = null;
  visitorSocket   = null;
}

// Called when librarian disconnects — end everything
function endFullSession() {
  appendToLog();
  sessionMessages = [];
  sessionStart    = null;
  librarianSocket = null;
  visitorSocket   = null;
}

// ─── Socket.IO ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  // ── Visitor joins ────────────────────────────────────────────────────────────
  socket.on('visitor:join', () => {
    if (visitorSocket !== null) {
      socket.emit('session:busy', {
        message: 'The librarian is currently helping another visitor. Please try again later.',
      });
      return;
    }

    visitorSocket = socket;
    if (!sessionStart) sessionStart = isoNow();

    socket.emit('session:joined', { role: 'visitor' });

    if (librarianSocket) {
      librarianSocket.emit('peer:connected', { message: 'A visitor has connected.' });
      socket.emit('peer:connected', { message: 'The librarian is available. Go ahead and ask your question.' });
    } else {
      socket.emit('peer:waiting', { message: 'Waiting for the librarian to connect...' });
    }
  });

  // ── Librarian joins (after passcode auth supplies a token) ───────────────────
  socket.on('librarian:join', (data) => {
    const token = data && typeof data === 'object' ? data.token : undefined;
    if (!token || !pendingTokens.has(token)) {
      socket.emit('auth:failed', { message: 'Invalid or expired token. Please log in again.' });
      return;
    }
    if (librarianSocket !== null) {
      socket.emit('session:busy', { message: 'A librarian session is already active.' });
      return;
    }

    pendingTokens.delete(token);
    librarianSocket = socket;
    if (!sessionStart) sessionStart = isoNow();

    socket.emit('session:joined', { role: 'librarian' });

    if (visitorSocket) {
      visitorSocket.emit('peer:connected', { message: 'The librarian has joined. You may now ask your question.' });
      socket.emit('peer:connected', { message: 'A visitor is waiting.' });
    } else {
      socket.emit('peer:waiting', { message: 'No visitor connected yet. Waiting...' });
    }
  });

  // ── Message relay ────────────────────────────────────────────────────────────
  socket.on('message', (data) => {
    if (!data || typeof data !== 'object') return;
    let text = data.text;
    if (!text || typeof text !== 'string') return;
    text = text.trim();
    if (!text) return;

    const isLibrarian = socket === librarianSocket;
    const isVisitor   = socket === visitorSocket;
    if (!isLibrarian && !isVisitor) return;

    const role = isLibrarian ? 'librarian' : 'visitor';
    const time = nowTime();
    sessionMessages.push({ time, role, text });

    const payload = { time, role, text };
    if (isLibrarian && visitorSocket)   visitorSocket.emit('message', payload);
    if (isVisitor   && librarianSocket) librarianSocket.emit('message', payload);
  });

  // ── Typing indicators ────────────────────────────────────────────────────────
  socket.on('typing:start', () => {
    if (socket === librarianSocket && visitorSocket)   visitorSocket.emit('typing:start',   { role: 'librarian' });
    if (socket === visitorSocket   && librarianSocket) librarianSocket.emit('typing:start', { role: 'visitor' });
  });

  socket.on('typing:stop', () => {
    if (socket === librarianSocket && visitorSocket)   visitorSocket.emit('typing:stop');
    if (socket === visitorSocket   && librarianSocket) librarianSocket.emit('typing:stop');
  });

  // ── Explicit close (visitor closes the widget) ───────────────────────────────
  socket.on('session:close', () => {
    if (socket === visitorSocket) {
      if (librarianSocket) {
        librarianSocket.emit('peer:disconnected', { message: 'The visitor has closed the chat. Ready for next session.' });
      }
      endVisitorSession();
    } else if (socket === librarianSocket) {
      if (visitorSocket) {
        visitorSocket.emit('peer:disconnected', { message: 'The librarian has ended the session.' });
      }
      endFullSession();
    }
  });

  // ── Socket disconnect (browser closed / network drop) ────────────────────────
  socket.on('disconnect', () => {
    if (socket === visitorSocket) {
      // visitorSocket reference still matches here — notify librarian
      if (librarianSocket) {
        librarianSocket.emit('peer:disconnected', { message: 'The visitor has disconnected. Ready for next session.' });
      }
      endVisitorSession();
    } else if (socket === librarianSocket) {
      if (visitorSocket) {
        visitorSocket.emit('peer:disconnected', { message: 'The librarian has disconnected.' });
      }
      endFullSession();
    }
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Librarian page : http://localhost:${PORT}/librarian`);
});
