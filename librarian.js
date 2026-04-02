/**
 * librarian.js — Librarian dashboard logic
 * Flow:
 *   1. User submits passcode → POST /librarian/auth
 *   2. On success, receive one-time token
 *   3. Connect via Socket.IO, emit librarian:join with token
 *   4. Chat interface becomes active
 */

(function () {
  'use strict';

  // ── DOM refs — Auth ───────────────────────────────────────────────────────
  const authPanel     = document.getElementById('auth-panel');
  const chatPanel     = document.getElementById('chat-panel');
  const authForm      = document.getElementById('auth-form');
  const passcodeInput = document.getElementById('passcode-input');
  const authSubmit    = document.getElementById('auth-submit');
  const authError     = document.getElementById('auth-error');

  // ── DOM refs — Chat ───────────────────────────────────────────────────────
  const libStatusBar  = document.getElementById('lib-status-bar');
  const libStatusText = document.getElementById('lib-status-text');
  const statusDot     = document.querySelector('.status-dot');
  const messagesEl    = document.getElementById('lib-chat-messages');
  const messageInput  = document.getElementById('lib-message-input');
  const sendBtn       = document.getElementById('lib-btn-send');

  // ── State ─────────────────────────────────────────────────────────────────
  let socket      = null;
  let peerReady   = false;
  let isTyping    = false;
  let typingTimer = null;

  // ── Step 1: Passcode form submission ─────────────────────────────────────
  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const passcode = passcodeInput.value.trim();
    if (!passcode) return;

    hideError();
    authSubmit.disabled    = true;
    authSubmit.textContent = 'Verifying...';

    try {
      const res  = await fetch('/librarian/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode }),
      });
      const data = await res.json();

      if (!data.success) {
        showError(data.message || 'Authentication failed.');
        authSubmit.disabled    = false;
        authSubmit.textContent = 'Enter Dashboard';
        passcodeInput.value    = '';
        passcodeInput.focus();
        return;
      }

      // Step 2: Auth succeeded — connect via Socket.IO with the token
      connectAsLibrarian(data.token);

    } catch (err) {
      showError('Network error. Please check your connection and try again.');
      authSubmit.disabled    = false;
      authSubmit.textContent = 'Enter Dashboard';
    }
  });

  // ── Step 2: Socket.IO connection ──────────────────────────────────────────
  function connectAsLibrarian(token) {
    socket = io();

    socket.on('connect', () => {
      socket.emit('librarian:join', { token });
    });

    socket.on('session:joined', () => {
      // Switch from auth panel to chat panel
      authPanel.classList.add('hidden');
      chatPanel.classList.remove('hidden');
      setStatus('Waiting for visitor to connect...');
    });

    socket.on('auth:failed', ({ message }) => {
      // Token was rejected (expired or already used)
      showError(message);
      authSubmit.disabled    = false;
      authSubmit.textContent = 'Enter Dashboard';
      authPanel.classList.remove('hidden');
      chatPanel.classList.add('hidden');
      socket.disconnect();
      socket = null;
    });

    socket.on('session:busy', ({ message }) => {
      showError(message);
      authSubmit.disabled    = false;
      authSubmit.textContent = 'Enter Dashboard';
      socket.disconnect();
      socket = null;
    });

    // ── Peer events ─────────────────────────────────────────────────────────
    socket.on('peer:waiting', ({ message }) => {
      setStatus(message);
      setDot('waiting');
    });

    socket.on('peer:connected', ({ message }) => {
      peerReady = true;
      setStatus('Visitor connected — ready to chat');
      setDot('connected');
      enableInput();
      appendSystemMessage(message);
    });

    socket.on('peer:disconnected', ({ message }) => {
      peerReady = false;
      setStatus(message);
      setDot('waiting');
      disableInput();
      appendSystemMessage(message);
    });

    // ── Incoming messages (from visitor) ─────────────────────────────────────
    socket.on('message', ({ role, text, time }) => {
      appendMessage({ role: 'other', text, time, typeLabel: 'Question', roleLabel: 'visitor' });
    });

    // ── Typing indicators ────────────────────────────────────────────────────
    socket.on('typing:start', () => {
      setStatus('Visitor is typing...');
    });

    socket.on('typing:stop', () => {
      setStatus(peerReady ? 'Visitor connected — ready to chat' : 'Waiting for visitor...');
    });

    socket.on('disconnect', () => {
      setStatus('Disconnected from server.');
      disableInput();
      appendSystemMessage('Connection to server lost.');
    });
  }

  // ── Send message ──────────────────────────────────────────────────────────
  function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !peerReady || !socket) return;
    socket.emit('message', { text });
    appendMessage({ role: 'me', text, time: nowTime(), typeLabel: 'Answer' });
    messageInput.value = '';
    stopTyping();
  }

  sendBtn.addEventListener('click', sendMessage);

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // ── Typing indicators (outgoing) ──────────────────────────────────────────
  messageInput.addEventListener('input', () => {
    if (!peerReady || !socket) return;
    if (!isTyping) {
      isTyping = true;
      socket.emit('typing:start');
    }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(stopTyping, 1500);
  });

  function stopTyping() {
    if (isTyping && socket) {
      isTyping = false;
      socket.emit('typing:stop');
    }
    clearTimeout(typingTimer);
  }

  // ── Page unload ───────────────────────────────────────────────────────────
  window.addEventListener('beforeunload', () => {
    if (socket) socket.emit('session:close');
  });

  // ── DOM helpers ───────────────────────────────────────────────────────────
  function nowTime() {
    return new Date().toTimeString().slice(0, 8);
  }

  function setStatus(text) {
    libStatusBar.textContent = text;
    if (libStatusText) libStatusText.textContent = text;
  }

  function setDot(state) {
    if (!statusDot) return;
    statusDot.classList.toggle('connected', state === 'connected');
  }

  function enableInput() {
    messageInput.disabled = false;
    sendBtn.disabled      = false;
    messageInput.focus();
  }

  function disableInput() {
    messageInput.disabled = true;
    sendBtn.disabled      = true;
  }

  function showError(msg) {
    authError.textContent = msg;
    authError.classList.remove('hidden');
  }

  function hideError() {
    authError.textContent = '';
    authError.classList.add('hidden');
  }

  function appendMessage({ role, text, time, typeLabel, roleLabel }) {
    const div  = document.createElement('div');
    const isMe = role === 'me';
    div.className = `message ${isMe ? 'message-me' : 'message-other'}`;

    const displayRole = isMe ? 'me' : (roleLabel || role);
    const displayType = typeLabel || (isMe ? 'Answer' : 'Question');
    const displayTime = time || nowTime();

    div.innerHTML = `
      <div class="message-header">
        <span class="message-role">${escapeHtml(displayRole)}</span>
        <span class="message-type">${escapeHtml(displayType)}</span>
      </div>
      <div class="message-bubble">${escapeHtml(text)}</div>
      <div class="message-time">${escapeHtml(displayTime)}</div>
    `;

    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function appendSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'message-system';
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(String(str)));
    return d.innerHTML;
  }
})();
