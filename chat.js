/**
 * chat.js — Visitor-side floating widget logic
 * Handles: widget state transitions, Socket.IO connection, message send/receive,
 *          typing indicators, session close + log trigger.
 */

(function () {
  'use strict';

  // ── Socket ────────────────────────────────────────────────────────────────
  const socket = io();

  // ── State ─────────────────────────────────────────────────────────────────
  let widgetState = 'collapsed';   // 'collapsed' | 'expanded' | 'maximized'
  let hasJoined   = false;
  let peerReady   = false;         // true once librarian is connected
  let typingTimer = null;
  let isTyping    = false;

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const widget        = document.getElementById('chat-widget');
  const toggleBtn     = document.getElementById('widget-toggle');
  const minimizeBtn   = document.getElementById('btn-minimize');
  const maximizeBtn   = document.getElementById('btn-maximize');
  const restoreBtn    = document.getElementById('btn-restore');
  const closeBtn      = document.getElementById('btn-close');
  const messagesEl    = document.getElementById('chat-messages');
  const messageInput  = document.getElementById('message-input');
  const sendBtn       = document.getElementById('btn-send');
  const statusBar     = document.getElementById('chat-status');

  // ── Widget state machine ──────────────────────────────────────────────────
  function setState(newState) {
    widget.classList.remove('collapsed', 'expanded', 'maximized');
    widget.classList.add(newState);
    widgetState = newState;

    // Join the session on first open
    if ((newState === 'expanded' || newState === 'maximized') && !hasJoined) {
      socket.emit('visitor:join');
      hasJoined = true;
    }
  }

  // ── Control buttons ───────────────────────────────────────────────────────
  toggleBtn.addEventListener('click', () => setState('expanded'));

  minimizeBtn.addEventListener('click', () => setState('collapsed'));

  maximizeBtn.addEventListener('click', () => setState('maximized'));

  restoreBtn.addEventListener('click', () => setState('expanded'));

  closeBtn.addEventListener('click', () => {
    socket.emit('session:close');
    hasJoined  = false;
    peerReady  = false;
    setState('collapsed');
    clearMessages();
    setStatus('');
    disableInput();
  });

  // ── Links on main page that open the widget ───────────────────────────────
  function bindOpenLink(id) {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        setState('expanded');
      });
    }
  }
  bindOpenLink('open-chat-link');
  bindOpenLink('open-chat-btn');

  // Also bind class-based links (inline-chat-link, footer-chat-link)
  document.querySelectorAll('.inline-chat-link, .footer-chat-link').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      setState('expanded');
    });
  });

  // ── Sending messages ──────────────────────────────────────────────────────
  function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !peerReady) return;
    socket.emit('message', { text });
    appendMessage({ role: 'me', text, time: nowTime(), typeLabel: 'Question' });
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

  // ── Typing indicators ─────────────────────────────────────────────────────
  messageInput.addEventListener('input', () => {
    if (!peerReady) return;
    if (!isTyping) {
      isTyping = true;
      socket.emit('typing:start');
    }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(stopTyping, 1500);
  });

  function stopTyping() {
    if (isTyping) {
      isTyping = false;
      socket.emit('typing:stop');
    }
    clearTimeout(typingTimer);
  }

  // ── Socket events ─────────────────────────────────────────────────────────
  socket.on('session:joined', () => {
    setStatus('Connected. Waiting for librarian...');
  });

  socket.on('session:busy', ({ message }) => {
    setStatus(message);
    appendSystemMessage(message);
    disableInput();
  });

  socket.on('peer:waiting', ({ message }) => {
    setStatus(message);
  });

  socket.on('peer:connected', ({ message }) => {
    peerReady = true;
    setStatus('Librarian is online');
    enableInput();
    appendSystemMessage(message);
  });

  socket.on('peer:disconnected', ({ message }) => {
    peerReady = false;
    setStatus(message);
    appendSystemMessage(message);
    disableInput();
  });

  socket.on('message', ({ role, text, time }) => {
    // Incoming messages are always from the librarian (visitor receives librarian's msgs)
    appendMessage({ role: 'other', text, time, typeLabel: 'Answer', roleLabel: 'librarian' });
  });

  socket.on('typing:start', () => {
    setStatus('Librarian is typing...');
  });

  socket.on('typing:stop', () => {
    setStatus('Librarian is online');
  });

  socket.on('auth:failed', ({ message }) => {
    setStatus(message);
  });

  // ── Browser close / navigation ────────────────────────────────────────────
  window.addEventListener('beforeunload', () => {
    if (hasJoined) socket.emit('session:close');
  });

  // ── DOM helpers ───────────────────────────────────────────────────────────
  function nowTime() {
    return new Date().toTimeString().slice(0, 8);
  }

  function setStatus(text) {
    statusBar.textContent = text;
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

  function appendMessage({ role, text, time, typeLabel, roleLabel }) {
    const div = document.createElement('div');
    const isMe = role === 'me';
    div.className = `message ${isMe ? 'message-me' : 'message-other'}`;

    const displayRole  = isMe ? 'me' : (roleLabel || role);
    const displayType  = typeLabel || (isMe ? 'Question' : 'Answer');
    const displayTime  = time || nowTime();

    div.innerHTML = `
      <div class="message-header">
        <span class="message-role">${escapeHtml(displayRole)}</span>
        <span class="message-type">${escapeHtml(displayType)}</span>
      </div>
      <div class="message-bubble">${escapeHtml(text)}</div>
      <div class="message-time">${escapeHtml(displayTime)}</div>
    `;

    messagesEl.appendChild(div);
    scrollToBottom();
  }

  function appendSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'message-system';
    div.textContent = text;
    messagesEl.appendChild(div);
    scrollToBottom();
  }

  function clearMessages() {
    messagesEl.innerHTML = '';
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(String(str)));
    return d.innerHTML;
  }
})();
