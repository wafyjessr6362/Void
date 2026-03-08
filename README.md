<div align="center">

<br/>

```
██╗   ██╗ ██████╗ ██╗██████╗ 
██║   ██║██╔═══██╗██║██╔══██╗
██║   ██║██║   ██║██║██║  ██║
╚██╗ ██╔╝██║   ██║██║██║  ██║
 ╚████╔╝ ╚██████╔╝██║██████╔╝
  ╚═══╝   ╚═════╝ ╚═╝╚═════╝ 
```

**A private key distribution system for Roblox scripts.**  
Discord bot · Validation API · Glassmorphism UI Library

<br/>

[![Node](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Discord.js](https://img.shields.io/badge/Discord.js-v14-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.js.org)
[![Roblox](https://img.shields.io/badge/Roblox-LocalScript-e2231a?style=for-the-badge&logo=roblox&logoColor=white)](https://roblox.com)
[![License](https://img.shields.io/badge/License-MIT-7c3aed?style=for-the-badge)](LICENSE)

</div>

---

## ✦ What is Void?

Void solves the biggest problem with Roblox script key systems — **keys being stolen from public channels**.

Most bots post keys in a channel where anyone can grab them. Void never does that. Every key is **generated uniquely per user** and delivered **only via private DM**. The original request message is deleted instantly so nobody else sees it.

---

## ✦ How It Works

```
User types ?getkey in Discord
        │
        ▼
Bot deletes their message immediately  ← nobody sees the request
        │
        ▼
Bot DMs the user a unique signed key
        │
        ▼
User pastes the key into the Roblox script
        │
        ▼
Script sends GET /validate?key=VOID-XXXX to your API
        │
        ▼
Server checks HMAC signature + one-time-use + expiry
        │
        ├─ valid   → { "valid": true }  → script loads ✓
        └─ invalid → { "valid": false } → access denied ✗
```

---

## ✦ Features

- 🔒 **Private DM delivery** — keys never appear in public channels
- 🔑 **HMAC-signed keys** — fake or hand-crafted keys are rejected instantly
- ♻️ **One-time use** — each key works once and is then invalidated
- ⏳ **Optional TTL** — keys can expire after a set time
- 🎨 **Dark UI library** — glassmorphism key prompt with loading screen, tabs, animations
- ⚙️ **Settings tab** — rebind toggle key, unload script
- 👑 **Admin commands** — revoke keys, list keys, stats via bot DM
- 🧩 **Simple integration** — one `VoidKey.new({})` call in your script

---

## ✦ Files

| File | Description |
|---|---|
| `KeyBot.js` | Discord bot + Express validation API (runs on your server) |
| `VoidKeyLib.lua` | Roblox UI library — drop into your executor script |
| `VoidKeyLib_Example.lua` | Ready-to-use example showing how to load the library |

---

## ✦ Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/YOURUSER/void.git
cd void
npm install
```

### 2. Configure `KeyBot.js`

Open `KeyBot.js` and fill in the `CONFIG` block at the top:

```js
TOKEN:              "your_discord_bot_token",
GET_KEY_CHANNEL_ID: "channel_id_where_users_type_?getkey",
GUILD_ID:           "your_discord_server_id",
KEY_SECRET:         "any_long_random_string_keep_this_private",
```

> ⚠️ Never commit your token to GitHub. Use environment variables (see below).

### 3. Run the bot

```bash
node KeyBot.js
```

Or keep it alive with PM2:

```bash
npm install -g pm2
pm2 start KeyBot.js
pm2 save
```

### 4. Use the library in your Roblox script

```lua
local VoidKey = loadstring(game:HttpGet(
    "https://raw.githubusercontent.com/YOURUSER/void/main/VoidKeyLib.lua"
))()

VoidKey.new({
    Title     = "MYSCRIPT",
    Subtitle  = "Authentication",
    Version   = "v1.0",
    Discord   = "discord.gg/yourserver",
    ApiUrl    = "https://your-api-url.com/validate",
    ToggleKey = Enum.KeyCode.RightAlt,

    OnSuccess = function()
        -- your script runs here after key is accepted
        loadstring(game:HttpGet("your_script_url"))()
    end,

    OnFail = function(key)
        warn("Bad key attempt:", key)
    end,
})
```

---

## ✦ Deploying the API

### Railway (Free — Recommended)

1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add environment variables in the **Variables** tab:

| Variable | Value |
|---|---|
| `BOT_TOKEN` | Your Discord bot token |
| `KEY_SECRET` | Your signing secret |
| `GET_KEY_CHANNEL_ID` | Channel ID |
| `GUILD_ID` | Server ID |

4. Go to **Settings → Networking → Generate Domain**
5. Your API URL: `https://yourproject.up.railway.app/validate`

---

## ✦ Environment Variables

If you use Railway, Render, or any host — set these instead of hardcoding in the file:

```bash
BOT_TOKEN=
KEY_SECRET=
GET_KEY_CHANNEL_ID=
GUILD_ID=
API_PORT=3000
API_SECRET=         # optional, adds X-Api-Key header auth
```

Then update `KeyBot.js` CONFIG to use `process.env.BOT_TOKEN` etc.

---

## ✦ Admin Commands

DM the bot as the **server owner** to manage keys:

| Command | Description |
|---|---|
| `!listkeys` | Show all keys, owners, and status |
| `!revoke VOID-XXXX-XXXX-XXXX-XXXX` | Invalidate a specific key |
| `!stats` | Total / used / unused key count |

---

## ✦ API Reference

### `GET /validate?key=VOID-XXXX-XXXX-XXXX-XXXX`

Validates a key. Called automatically by `VoidKeyLib.lua`.

**Response — valid:**
```json
{ "valid": true, "message": "Access granted", "userId": "123456789" }
```

**Response — invalid:**
```json
{ "valid": false, "message": "Key has already been used" }
```

### `GET /`

Health check.
```json
{ "status": "ok", "keys": 42 }
```

---

## ✦ Library Options

```lua
VoidKey.new({
    Title     = "string",           -- UI title
    Subtitle  = "string",           -- UI subtitle
    Version   = "string",           -- version badge
    Discord   = "string",           -- discord link shown in UI
    ApiUrl    = "string",           -- your /validate endpoint
    ToggleKey = Enum.KeyCode.X,     -- keybind to show/hide after auth
    OnSuccess = function() end,     -- called after successful validation
    OnFail    = function(key) end,  -- called on failed attempt
})
```

**Methods:**

```lua
local instance = VoidKey.new({...})

instance:Unload()          -- destroy the GUI and disconnect all events
instance:SetApiUrl(url)    -- change the API URL at runtime
```

---

## ✦ License

MIT — free to use, modify, and distribute.  
Credit appreciated but not required.

---

<div align="center">
<sub>built with 🖤 for the roblox scripting community</sub>
</div>
