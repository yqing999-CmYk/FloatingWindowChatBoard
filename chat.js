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
  const widgetHeader  = document.querySelector('.widget-header');
  const resizeGrip    = document.getElementById('resize-grip');
  const minimizeBtn   = document.getElementById('btn-minimize');
  const maximizeBtn   = document.getElementById('btn-maximize');
  const restoreBtn    = document.getElementById('btn-restore');
  const closeBtn      = document.getElementById('btn-close');
  const messagesEl    = document.getElementById('chat-messages');
  const messageInput  = document.getElementById('message-input');
  const sendBtn       = document.getElementById('btn-send');
  const statusBar     = document.getElementById('chat-status');

  // ── Position / size helpers ───────────────────────────────────────────────
  // Saved inline styles while the widget is maximized (CSS class takes over)
  let savedStyles = null;
  // Whether the user has ever moved/resized the widget from its CSS default
  let isPositioned = false;

  // Clear all inline position/size styles → CSS class takes over
  function clearInlineStyles() {
    ['top','left','bottom','right','width','height'].forEach(p => widget.style.removeProperty(p));
  }

  // Convert CSS bottom/right positioning to explicit top/left so drag/resize work
  function pinToTopLeft() {
    const r = widget.getBoundingClientRect();
    widget.style.bottom = 'auto';
    widget.style.right  = 'auto';
    widget.style.top    = r.top  + 'px';
    widget.style.left   = r.left + 'px';
    widget.style.width  = r.width  + 'px';
    widget.style.height = r.height + 'px';
  }

  // ── Widget state machine ──────────────────────────────────────────────────
  function setState(newState) {
    const prev = widgetState;
    widget.classList.remove('collapsed', 'expanded', 'maximized');
    widget.classList.add(newState);
    widgetState = newState;

    if (newState === 'maximized') {
      // Save and clear inline styles — CSS class fully controls the maximized layout
      savedStyles = {
        top: widget.style.top, left: widget.style.left,
        bottom: widget.style.bottom, right: widget.style.right,
        width: widget.style.width, height: widget.style.height,
      };
      clearInlineStyles();
    } else if (prev === 'maximized') {
      // Restore position/size the widget had before maximizing
      if (savedStyles) {
        Object.entries(savedStyles).forEach(([p, v]) => { widget.style[p] = v; });
      }
    } else if (newState === 'collapsed') {
      // Reset to CSS default (bottom-right) so next expand starts clean
      clearInlineStyles();
      isPositioned = false;
    }

    // Join the session on first open
    if ((newState === 'expanded' || newState === 'maximized') && !hasJoined) {
      socket.emit('visitor:join');
      hasJoined = true;
    }
  }

  // ── Drag (move by header) ─────────────────────────────────────────────────
  widgetHeader.addEventListener('mousedown', (e) => {
    if (widgetState !== 'expanded') return;
    if (e.target.closest('.widget-controls')) return; // let control buttons work normally
    e.preventDefault();

    if (!isPositioned) { pinToTopLeft(); isPositioned = true; }

    const startX   = e.clientX;
    const startY   = e.clientY;
    const startLeft = parseFloat(widget.style.left);
    const startTop  = parseFloat(widget.style.top);

    widgetHeader.classList.add('dragging');
    document.body.style.userSelect = 'none';

    function onMove(e) {
      const w = widget.offsetWidth;
      // Keep at least 60 px of the widget visible on each edge
      const newLeft = Math.max(-(w - 60), Math.min(window.innerWidth  - 60, startLeft + e.clientX - startX));
      const newTop  = Math.max(0,          Math.min(window.innerHeight - 60, startTop  + e.clientY - startY));
      widget.style.left = newLeft + 'px';
      widget.style.top  = newTop  + 'px';
    }

    function onUp() {
      widgetHeader.classList.remove('dragging');
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });

  // ── Resize (drag the grip at bottom-right) ────────────────────────────────
  resizeGrip.addEventListener('mousedown', (e) => {
    if (widgetState !== 'expanded') return;
    e.preventDefault();

    if (!isPositioned) { pinToTopLeft(); isPositioned = true; }

    const startX = e.clientX;
    const startY = e.clientY;
    const startW = widget.offsetWidth;
    const startH = widget.offsetHeight;
    const MIN_W  = 280;
    const MIN_H  = 360;

    document.body.style.userSelect = 'none';

    function onMove(e) {
      const left = parseFloat(widget.style.left) || 0;
      const top  = parseFloat(widget.style.top)  || 0;
      const maxW = window.innerWidth  - left;
      const maxH = window.innerHeight - top;
      widget.style.width  = Math.max(MIN_W, Math.min(maxW, startW + e.clientX - startX)) + 'px';
      widget.style.height = Math.max(MIN_H, Math.min(maxH, startH + e.clientY - startY)) + 'px';
    }

    function onUp() {
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });

  // ── Control buttons ───────────────────────────────────────────────────────
  toggleBtn.addEventListener('click', () => setState('expanded'));

  // Hover the toggle button for 1 s /second→ auto-expand
  let hoverTimer = null;
  toggleBtn.addEventListener('mouseenter', () => {
    hoverTimer = setTimeout(() => {
      if (widgetState === 'collapsed') setState('expanded');
    }, 1000);
  });
  toggleBtn.addEventListener('mouseleave', () => {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  });

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

  socket.on('message', ({ text, time }) => {
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
