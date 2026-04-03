# Floating Window Chat Board

A real-time library chat application. Visitors browse the main library landing page and can open a floating chat widget to ask questions. A librarian logs in via a separate passcode-protected page and answers in real time. All sessions are automatically appended to a persistent text log.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [How It Works](#how-it-works)
5. [Environment Setup](#environment-setup)
6. [Testing Locally](#testing-locally)
7. [Running in Production (VPS / Linux)](#running-in-production-vps--linux)
8. [Docker Deployment](#docker-deployment)

---

## Introduction

**Floating Window Chat Board** is a lightweight, real-time Q&A widget designed for a library website.

Key characteristics:

- **1 librarian : 1 visitor** model — only one chat session is active at a time; a second visitor is told to wait until the current session ends.
- **No database** — messages are relayed in memory and appended to a plain-text log file on the server when the session closes.
- **No frontend framework** — the entire visitor-facing UI is vanilla HTML, CSS, and JavaScript. No build step required.
- **Passcode authentication** — the librarian authenticates with a plain passcode stored in `.env`. A short-lived one-time token is issued for the Socket.IO connection so the passcode never travels over the socket.

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js | 18 LTS or later |
| HTTP server | Express | 4.x |
| Real-time transport | Socket.IO | 4.x |
| Environment config | dotenv | 16.x |
| Frontend | Vanilla HTML5 / CSS3 / JavaScript | — |
| Logging | Node.js built-in `fs` | — |
| Process manager (production) | PM2 | latest |
| Reverse proxy (production) | Nginx | latest |
| Container (optional) | Docker + Docker Compose | latest |

---

## Project Structure

```
FloatingWindowChatBoard/
│
├── public/                     # Static files served by Express
│   ├── index.html              # Visitor-facing main library page + floating widget
│   ├── librarian.html          # Librarian login (passcode) + chat dashboard
│   ├── css/
│   │   └── style.css           # All styles: main page, widget states, librarian page
│   └── js/
│       ├── chat.js             # Visitor widget: state machine, drag, resize, Socket.IO
│       └── librarian.js        # Librarian: passcode auth, chat, typing indicators
│
├── logs/
│   ├── .gitkeep                # Keeps the directory in git (chat-log.txt is gitignored)
│   └── chat-log.txt            # Appended automatically on each session close (auto-created)
│
├── Plan/
│   └── plan.txt                # Project planning notes and tech stack decisions
│
├── server.js                   # Express + Socket.IO server, auth endpoint, session state
├── package.json
├── package-lock.json
├── .env                        # Local secrets — NOT committed to git
├── .gitignore
└── README.md
```

---

## How It Works

### Visitor flow

1. Visitor opens `http://localhost:3000`.
2. A floating **"Ask Librarian"** button appears at the bottom-right corner.
3. Clicking it (or hovering for 1 second) expands the chat panel.
4. The panel can be **dragged** anywhere on screen (grab the green header bar) and **resized** (drag the grip at the bottom-right corner).
5. The panel can also be **maximized** (centered overlay) or **minimized** back to the pill button.
6. Visitor types a question and sends it with **Enter** or the **Send** button.
7. Closing the widget with **×** ends the session and triggers the server to append the conversation to `logs/chat-log.txt`.

### Librarian flow

1. Librarian opens `http://localhost:3000/librarian`.
2. A passcode form is shown. The passcode is submitted via `POST /librarian/auth`.
3. Server checks the passcode against `LIBRARIAN_PASSCODE` in `.env`.
4. On success, a **one-time token** (valid for 60 seconds) is returned.
5. The browser connects via Socket.IO and sends the token in a `librarian:join` event.
6. Server validates the token, marks the librarian slot as occupied, and shows the chat dashboard.
7. The librarian sees visitor messages labeled **visitor / Question** and sends replies labeled **me / Answer**.

### Session enforcement (1:1 model)

The server tracks two references: `librarianSocket` and `visitorSocket`.

- A second librarian login attempt is rejected at the `/librarian/auth` endpoint.
- A second visitor opening the widget receives a "session busy" notice.
- When the **visitor** disconnects, the log is written and the visitor slot is freed. The librarian remains connected and is ready for the next visitor.
- When the **librarian** disconnects, both slots are freed and the log is written.

### Chat log format (`logs/chat-log.txt`)

```
================================================================================
Session: 2026-04-02 14:30:00
================================================================================
[14:30:05] visitor: How do I renew my books?
[14:30:15] librarian: You can renew online at our portal or call the desk.
================================================================================
```

New sessions are **appended** — the file is never overwritten.

### Typing indicators

Both sides emit `typing:start` / `typing:stop` events (debounced at 1.5 s). The other party sees a status bar message: *"Visitor is typing..."* or *"Librarian is typing..."*.

---

## Environment Setup

### Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **npm** (bundled with Node.js)
- **Git** (optional, for cloning)

### Steps

```bash
# 1. Clone or copy the project
git clone <repo-url> FloatingWindowChatBoard
cd FloatingWindowChatBoard

# 2. Install dependencies
npm install

# 3. Create the .env file
cp .env.example .env          # or create manually (see below)
```

The `.env` file must contain:

```env
LIBRARIAN_PASSCODE=your_secret_passcode_here
PORT=3000
```

> Change `your_secret_passcode_here` to any passcode you choose. The server will refuse to start if `LIBRARIAN_PASSCODE` is not set.

---

## Testing Locally

```bash
# Start the server
npm start
```

Open **two browser windows** side by side:

| Window | URL | Role |
|---|---|---|
| Window 1 | `http://localhost:3000` | Visitor |
| Window 2 | `http://localhost:3000/librarian` | Librarian |

**Test checklist:**

- [ ] Visitor page loads with the floating pill button at bottom-right
- [ ] Hovering the pill for 1 second auto-expands the widget
- [ ] Clicking the pill expands the widget immediately
- [ ] Widget header can be dragged to reposition the window
- [ ] Resize grip (bottom-right corner dots) resizes the window; minimum 280 × 360 px
- [ ] Maximize button (□) centers the widget as a full-screen overlay
- [ ] Restore button (❐) returns the widget to its pre-maximize size and position
- [ ] Minimize (−) collapses back to the pill button
- [ ] Librarian page shows the passcode form
- [ ] Wrong passcode shows an error message
- [ ] Correct passcode (`library2026` by default) opens the dashboard
- [ ] Both sides show **"Typing..."** status while the other is composing
- [ ] Messages display with correct labels: `me / Question` or `visitor / Question` and `me / Answer` or `librarian / Answer`
- [ ] All messages align to the left side
- [ ] Closing the visitor widget (×) appends the session to `logs/chat-log.txt`
- [ ] A second librarian login attempt is rejected with "session already active"
- [ ] A second visitor is told the librarian is busy

Stop the server with `Ctrl+C`.

---

## Running in Production (VPS / Linux)

### 1. Provision the VPS

A minimal Ubuntu 22.04 LTS VPS with 1 vCPU / 512 MB RAM is sufficient.

```bash
# On the VPS — install Node.js 20 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node -v   # should print v20.x.x
npm -v
```

### 2. Deploy the application

```bash
# Copy files to the VPS (exclude node_modules and secrets)
rsync -avz --exclude='node_modules' --exclude='.env' --exclude='logs/*.txt' \
  ./ user@your-vps-ip:/opt/chatboard/

# On the VPS — install dependencies and create .env
cd /opt/chatboard
npm install --omit=dev
nano .env                       # paste LIBRARIAN_PASSCODE and PORT
```

### 3. Run with PM2 (process manager)

PM2 keeps the app running after crashes and across reboots.

```bash
# Install PM2 globally
sudo npm install -g pm2

# Start the app
pm2 start server.js --name chatboard

# Save the process list so it survives reboots
pm2 save
pm2 startup                    # follow the printed command to enable autostart

# Useful PM2 commands
pm2 status                     # check if the app is running
pm2 logs chatboard             # tail live logs
pm2 restart chatboard          # restart after a code update
pm2 stop chatboard             # stop
```

### 4. Configure Nginx as a reverse proxy

Nginx handles HTTPS termination and forwards traffic to Node.js on port 3000.

```bash
sudo apt-get install -y nginx
sudo nano /etc/nginx/sites-available/chatboard
```

Paste the following (replace `your-domain.com` with your actual domain or VPS IP):

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Redirect HTTP to HTTPS (enable after obtaining a certificate)
    # return 301 https://$host$request_uri;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # Required for Socket.IO (WebSocket upgrade)
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";

        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        proxy_read_timeout 86400;   # keep WebSocket connections alive
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/chatboard /etc/nginx/sites-enabled/
sudo nginx -t                  # test config
sudo systemctl reload nginx
```

### 5. Enable HTTPS with Let's Encrypt (recommended)

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
# certbot patches the Nginx config and sets up auto-renewal
```

After this, the Nginx config's `listen 443 ssl` block is managed by certbot. The `proxy_pass` block and WebSocket headers remain as-is.

### 6. Updating the application

```bash
# On the VPS
cd /opt/chatboard
git pull                        # if using git
# or rsync from local machine

npm install --omit=dev
pm2 restart chatboard
```

---
---

## Notes

- The default passcode is `library2026`. **Change it before any public deployment** by editing `.env`.
- The app currently supports **one active chat session at a time** by design. Concurrent multi-session support would require a session map and per-session message storage.
- `logs/chat-log.txt` grows indefinitely. Archive or rotate it periodically in production (e.g. with `logrotate` on Linux).
