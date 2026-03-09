const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const express = require("express");
const crypto  = require("crypto");
const https   = require("https");
const http    = require("http");

// ══════════════════════════════════════════════
//  CONFIG
// ══════════════════════════════════════════════
const CONFIG = {
    TOKEN:              process.env.BOT_TOKEN,
    GET_KEY_CHANNEL_ID: process.env.GET_KEY_CHANNEL_ID,
    GUILD_ID:           process.env.GUILD_ID,
    KEY_SECRET:         process.env.KEY_SECRET  || "void_default_secret",
    API_SECRET:         process.env.API_SECRET  || "",
    API_PORT:           process.env.PORT         || 3000,

    // Your Render URL — used to build verification links
    // Set this as an env variable: BASE_URL = https://void-r3co.onrender.com
    BASE_URL:           process.env.BASE_URL     || "https://void-r3co.onrender.com",

    KEY_PREFIX:         "VOID",
    KEY_SEGMENTS:       3,
    KEY_SEG_LEN:        4,

    // ── Checkpoint system ────────────────────
    MAX_CHECKPOINTS:    3,           // max verifications (3 = 72h max)
    HOURS_PER_CHECKPOINT: 24,        // each checkpoint adds this many hours

    // ── Verification token TTL ───────────────
    VERIFY_TOKEN_TTL:   10 * 60 * 1000, // verification link expires in 10 minutes

    // ── Anti-bot ─────────────────────────────
    MAX_FAIL_ATTEMPTS:  5,
    FAIL_WINDOW_MS:     10 * 60 * 1000,
    BLOCK_DURATION_MS:  60 * 60 * 1000,
};

// ══════════════════════════════════════════════
//  STARTUP CHECKS
// ══════════════════════════════════════════════
console.log("[VoidKey] Starting...");
console.log("[VoidKey] BOT_TOKEN set:", !!CONFIG.TOKEN);
console.log("[VoidKey] GUILD_ID set:", !!CONFIG.GUILD_ID);
console.log("[VoidKey] GET_KEY_CHANNEL_ID set:", !!CONFIG.GET_KEY_CHANNEL_ID);
console.log("[VoidKey] BASE_URL:", CONFIG.BASE_URL);

if (!CONFIG.TOKEN)              { console.error("[VoidKey] ERROR: BOT_TOKEN missing!"); process.exit(1); }
if (!CONFIG.GUILD_ID)           { console.error("[VoidKey] ERROR: GUILD_ID missing!");  process.exit(1); }
if (!CONFIG.GET_KEY_CHANNEL_ID) { console.error("[VoidKey] ERROR: GET_KEY_CHANNEL_ID missing!"); process.exit(1); }

// ══════════════════════════════════════════════
//  STORAGE
//
//  keys = Map<string, {
//    userId:        string,
//    createdAt:     number,
//    checkpoints:   number,   how many checkpoints completed
//    expiresAt:     number,   0 = not activated yet
//    blocked:       boolean,
//  }>
//
//  verifyTokens = Map<token, {
//    userId:    string,
//    createdAt: number,
//    used:      boolean,
//  }>
//
//  failLog = Map<ip, { count, firstFail, blockedUntil }>
// ══════════════════════════════════════════════
const keys         = new Map();
const verifyTokens = new Map();
const failLog      = new Map();

// ══════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════
function msToHuman(ms) {
    if (ms <= 0) return "expired";
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function generateKey() {
    const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const segments = [];
    for (let s = 0; s < CONFIG.KEY_SEGMENTS; s++) {
        let seg = "";
        for (let c = 0; c < CONFIG.KEY_SEG_LEN; c++) {
            seg += charset[Math.floor(Math.random() * charset.length)];
        }
        segments.push(seg);
    }
    const raw      = CONFIG.KEY_PREFIX + "-" + segments.join("-");
    const checksum = crypto
        .createHmac("sha256", CONFIG.KEY_SECRET)
        .update(raw).digest("hex")
        .slice(0, CONFIG.KEY_SEG_LEN).toUpperCase();
    return raw + "-" + checksum;
}

function verifyKeyHmac(key) {
    const parts = key.split("-");
    if (parts.length < CONFIG.KEY_SEGMENTS + 2) return false;
    const checksum = parts[parts.length - 1];
    const raw      = parts.slice(0, parts.length - 1).join("-");
    const expected = crypto
        .createHmac("sha256", CONFIG.KEY_SECRET)
        .update(raw).digest("hex")
        .slice(0, CONFIG.KEY_SEG_LEN).toUpperCase();
    return checksum === expected;
}

function generateVerifyToken(userId) {
    const token = crypto.randomBytes(24).toString("hex");
    verifyTokens.set(token, {
        userId,
        createdAt: Date.now(),
        used: false,
    });
    return token;
}

function recordFail(ip) {
    const now = Date.now();
    const rec = failLog.get(ip) || { count: 0, firstFail: now, blockedUntil: 0 };
    if (now - rec.firstFail > CONFIG.FAIL_WINDOW_MS) {
        rec.count = 0; rec.firstFail = now;
    }
    rec.count++;
    if (rec.count >= CONFIG.MAX_FAIL_ATTEMPTS) {
        rec.blockedUntil = now + CONFIG.BLOCK_DURATION_MS;
        console.warn(`[VoidKey] IP blocked: ${ip}`);
    }
    failLog.set(ip, rec);
}

function isBlocked(ip) {
    const rec = failLog.get(ip);
    if (!rec) return false;
    return rec.blockedUntil && Date.now() < rec.blockedUntil;
}

// Find a user's active key
function getUserKey(userId) {
    for (const [k, data] of keys.entries()) {
        if (data.userId === userId && !data.blocked) return { key: k, data };
    }
    return null;
}

// ══════════════════════════════════════════════
//  VERIFICATION PAGE HTML
// ══════════════════════════════════════════════
function verifyPageHtml(token, state, message, checkpoints, maxCheckpoints) {
    const steps = [];
    for (let i = 1; i <= maxCheckpoints; i++) {
        const done = i <= checkpoints;
        steps.push(`
            <div class="step ${done ? 'done' : i === checkpoints + 1 ? 'active' : 'locked'}">
                <div class="step-icon">${done ? '✓' : i}</div>
                <div class="step-label">Checkpoint ${i}<br><span>${i * 24}h access</span></div>
            </div>
        `);
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>VOID — Verification</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #04030a;
    color: #a89dc0;
    font-family: 'Segoe UI', sans-serif;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .card {
    background: #12101e;
    border: 1px solid #342850;
    border-radius: 18px;
    padding: 40px 36px;
    max-width: 440px;
    width: 90%;
    text-align: center;
    box-shadow: 0 0 60px #5a32a320;
  }
  .logo { font-size: 42px; margin-bottom: 8px; }
  h1 { color: #c4b5fd; font-size: 22px; letter-spacing: 6px; margin-bottom: 6px; }
  .sub { color: #5a4870; font-size: 12px; margin-bottom: 32px; letter-spacing: 2px; }
  .steps {
    display: flex;
    justify-content: center;
    gap: 16px;
    margin-bottom: 32px;
  }
  .step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    flex: 1;
  }
  .step-icon {
    width: 42px; height: 42px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 16px; font-weight: bold;
    border: 1px solid #342850;
    background: #1a1428;
    color: #5a4870;
  }
  .step.done .step-icon { background: #2d1a5e; border-color: #7c3aed; color: #c4b5fd; }
  .step.active .step-icon { background: #3b1f6e; border-color: #a855f7; color: #e9d5ff; box-shadow: 0 0 12px #7c3aed50; }
  .step-label { font-size: 10px; color: #5a4870; text-align: center; line-height: 1.4; }
  .step-label span { color: #7c3aed; }
  .step.done .step-label, .step.active .step-label { color: #a89dc0; }
  .message {
    padding: 14px 20px;
    border-radius: 10px;
    font-size: 13px;
    margin-bottom: 24px;
    border: 1px solid;
  }
  .message.success { background: #0f2a1a; border-color: #166534; color: #4ade80; }
  .message.error   { background: #2a0f14; border-color: #7f1d1d; color: #f87171; }
  .message.info    { background: #1a1232; border-color: #3b0764; color: #c4b5fd; }
  .btn {
    display: inline-block;
    background: #5b21b6;
    color: #e9d5ff;
    border: none;
    border-radius: 10px;
    padding: 13px 32px;
    font-size: 13px;
    font-weight: bold;
    letter-spacing: 2px;
    cursor: pointer;
    text-decoration: none;
    transition: background .2s;
    width: 100%;
  }
  .btn:hover { background: #7c3aed; }
  .btn:disabled { background: #2a1f40; color: #5a4870; cursor: not-allowed; }
  .footer { margin-top: 24px; font-size: 10px; color: #342850; letter-spacing: 1px; }
</style>
</head>
<body>
<div class="card">
  <div class="logo">◈</div>
  <h1>VOID</h1>
  <p class="sub">CHECKPOINT VERIFICATION</p>

  <div class="steps">${steps.join("")}</div>

  <div class="message ${state}">${message}</div>

  ${state === 'success'
    ? `<p style="color:#4ade80;font-size:13px;margin-bottom:16px">✓ +${CONFIG.HOURS_PER_CHECKPOINT}h added to your key!</p>
       <a href="javascript:window.close()" class="btn">CLOSE WINDOW</a>`
    : state === 'error'
    ? `<a href="javascript:window.close()" class="btn">CLOSE WINDOW</a>`
    : `<a href="${CONFIG.BASE_URL}/checkpoint?token=${token}" class="btn">COMPLETE CHECKPOINT</a>`
  }

  <p class="footer">VOID KEY SYSTEM · DO NOT SHARE YOUR LINK</p>
</div>
</body>
</html>`;
}

// ══════════════════════════════════════════════
//  DISCORD BOT
// ══════════════════════════════════════════════
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message],
});

client.once("ready", () => {
    console.log(`[VoidKey] ✓ Online as ${client.user.tag}`);
    client.user.setActivity("?getkey", { type: 3 });
});

client.on("error", (err) => {
    console.error("[VoidKey] Client error:", err.message);
});

// ── ?getkey ───────────────────────────────────
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (message.channelId !== CONFIG.GET_KEY_CHANNEL_ID) return;
    if (message.content.trim().toLowerCase() !== "?getkey") return;

    try { await message.delete(); } catch (e) {}

    const user   = message.author;
    const now    = Date.now();
    const found  = getUserKey(user.id);

    // If user has an existing key — send checkpoint link
    if (found) {
        const { key, data } = found;
        const cpDone   = data.checkpoints;
        const cpLeft   = CONFIG.MAX_CHECKPOINTS - cpDone;
        const timeLeft = data.expiresAt > now ? msToHuman(data.expiresAt - now) : "expired";

        if (cpLeft <= 0) {
            // Max checkpoints reached
            try {
                const embed = new EmbedBuilder()
                    .setColor(0x5c2da0)
                    .setTitle("◈  Max Checkpoints Reached")
                    .setDescription(`You've completed all **${CONFIG.MAX_CHECKPOINTS}** checkpoints.\nYour key gives you a total of **${CONFIG.MAX_CHECKPOINTS * CONFIG.HOURS_PER_CHECKPOINT}h** of access.`)
                    .addFields(
                        { name: "Key",       value: `\`\`\`${key}\`\`\`` },
                        { name: "⏳ Expires", value: `in **${timeLeft}**` }
                    )
                    .setFooter({ text: "No more checkpoints available for this key." })
                    .setTimestamp();
                await user.send({ embeds: [embed] });
            } catch { }
            return;
        }

        // Generate a checkpoint verification link
        const token = generateVerifyToken(user.id);
        const link  = `${CONFIG.BASE_URL}/checkpoint?token=${token}`;

        try {
            const embed = new EmbedBuilder()
                .setColor(0x5c2da0)
                .setTitle("◈  Complete a Checkpoint")
                .setDescription(`Complete the checkpoint to add **+${CONFIG.HOURS_PER_CHECKPOINT}h** to your key.`)
                .addFields(
                    { name: "Key",              value: `\`\`\`${key}\`\`\`` },
                    { name: "✅ Checkpoints Done", value: `**${cpDone}** / ${CONFIG.MAX_CHECKPOINTS}`, inline: true },
                    { name: "⏳ Time Left",       value: `**${timeLeft}**`, inline: true },
                    { name: "🔗 Your Link",        value: `[Click here to verify](${link})\n⚠️ Link expires in **10 minutes**. Do not share it.` }
                )
                .setColor(0x5c2da0)
                .setFooter({ text: "Each checkpoint adds 24h · Max 3 checkpoints" })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel(`Complete Checkpoint ${cpDone + 1}`)
                    .setStyle(ButtonStyle.Link)
                    .setURL(link)
                    .setEmoji("✅")
            );

            await user.send({ embeds: [embed], components: [row] });
        } catch (e) {
            const w = await message.channel.send(`<@${user.id}> ❌ Enable DMs from server members, then try again.`);
            setTimeout(() => w.delete().catch(() => {}), 8000);
        }
        return;
    }

    // No existing key — generate one + first checkpoint link
    const newKey = generateKey();
    const token  = generateVerifyToken(user.id);
    const link   = `${CONFIG.BASE_URL}/checkpoint?token=${token}`;

    keys.set(newKey, {
        userId:      user.id,
        createdAt:   now,
        checkpoints: 0,
        expiresAt:   0,  // not active until first checkpoint
        blocked:     false,
    });

    console.log(`[VoidKey] New key for ${user.tag}: ${newKey}`);

    try {
        const embed = new EmbedBuilder()
            .setColor(0x5c2da0)
            .setTitle("◈  Your License Key")
            .setDescription(`Your key has been generated!\n\nComplete the checkpoint below to **activate it** and get your first **${CONFIG.HOURS_PER_CHECKPOINT}h** of access.\n\nYou can complete up to **${CONFIG.MAX_CHECKPOINTS} checkpoints** for a max of **${CONFIG.MAX_CHECKPOINTS * CONFIG.HOURS_PER_CHECKPOINT}h**.`)
            .addFields(
                { name: "Key",          value: `\`\`\`${newKey}\`\`\`` },
                { name: "⚠️ Warning",    value: "**Never share this key.** It is tied to your account." },
                { name: "🔗 Your Link",  value: `[Click here to complete Checkpoint 1](${link})\n⚠️ Link expires in **10 minutes**. Do not share it.` }
            )
            .setFooter({ text: `${CONFIG.MAX_CHECKPOINTS} checkpoints available · ${CONFIG.HOURS_PER_CHECKPOINT}h each` })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel("Complete Checkpoint 1 — Get 24h")
                .setStyle(ButtonStyle.Link)
                .setURL(link)
                .setEmoji("🔑")
        );

        await user.send({ embeds: [embed], components: [row] });

        const ack = await message.channel.send(`✓  <@${user.id}> Key sent via DM!`);
        setTimeout(() => ack.delete().catch(() => {}), 5000);

    } catch (e) {
        console.error("[VoidKey] Could not DM:", e.message);
        const err = await message.channel.send(`<@${user.id}> ❌ I couldn't DM you. Enable DMs and try again.`);
        setTimeout(() => err.delete().catch(() => {}), 8000);
        keys.delete(newKey);
    }
});

// ── Admin DM commands ─────────────────────────
client.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;
    if (msg.channel.type !== 1) return;

    const guild = await client.guilds.fetch(CONFIG.GUILD_ID).catch(() => null);
    if (!guild || msg.author.id !== guild.ownerId) return;

    const args = msg.content.trim().split(/\s+/);
    const cmd  = args[0].toLowerCase();

    if (cmd === "!revoke" && args[1]) {
        const key  = args[1].toUpperCase();
        const data = keys.get(key);
        if (data) {
            data.blocked = true;
            keys.set(key, data);
            await msg.reply(`✓ Revoked: \`${key}\``);
        } else {
            await msg.reply(`❌ Not found: \`${key}\``);
        }
    }

    if (cmd === "!listkeys") {
        if (keys.size === 0) return msg.reply("No keys.");
        let out = "**Keys:**\n";
        for (const [k, d] of keys.entries()) {
            const expired = d.expiresAt > 0 && Date.now() > d.expiresAt;
            const active  = d.expiresAt > 0 && !expired;
            const status  = d.blocked ? "🚫 revoked"
                          : d.expiresAt === 0 ? "⏸ not activated"
                          : expired ? "💀 expired"
                          : `✓ ${d.checkpoints}/${CONFIG.MAX_CHECKPOINTS} cp`;
            out += `\`${k}\` → <@${d.userId}> [${status}]\n`;
        }
        await msg.reply(out.slice(0, 2000));
    }

    if (cmd === "!stats") {
        const total    = keys.size;
        const active   = [...keys.values()].filter(d => !d.blocked && d.expiresAt > Date.now()).length;
        const inactive = [...keys.values()].filter(d => d.expiresAt === 0).length;
        const expired  = [...keys.values()].filter(d => d.expiresAt > 0 && Date.now() > d.expiresAt).length;
        await msg.reply(`**Stats**\nTotal: ${total} | Active: ${active} | Not activated: ${inactive} | Expired: ${expired}`);
    }

    if (cmd === "!unblock" && args[1]) {
        failLog.delete(args[1]);
        await msg.reply(`✓ Unblocked IP: \`${args[1]}\``);
    }
});

// ══════════════════════════════════════════════
//  EXPRESS API
// ══════════════════════════════════════════════
const app = express();
app.use(express.json());

// Optional API secret
app.use((req, res, next) => {
    if (CONFIG.API_SECRET) {
        if (req.headers["x-api-key"] !== CONFIG.API_SECRET)
            return res.status(401).json({ valid: false, message: "Unauthorized" });
    }
    next();
});

// ── GET /checkpoint?token=XXX ─────────────────
// User visits this link to complete a checkpoint
app.get("/checkpoint", (req, res) => {
    const token = req.query.token || "";

    if (!token) {
        return res.send(verifyPageHtml("", "error", "Invalid or missing verification token.", 0, CONFIG.MAX_CHECKPOINTS));
    }

    const tv = verifyTokens.get(token);

    if (!tv) {
        return res.send(verifyPageHtml(token, "error", "This link is invalid or has already been used.", 0, CONFIG.MAX_CHECKPOINTS));
    }

    if (tv.used) {
        return res.send(verifyPageHtml(token, "error", "This verification link has already been used.", 0, CONFIG.MAX_CHECKPOINTS));
    }

    if (Date.now() - tv.createdAt > CONFIG.VERIFY_TOKEN_TTL) {
        verifyTokens.delete(token);
        return res.send(verifyPageHtml(token, "error", "This link has expired. Type ?getkey again for a new one.", 0, CONFIG.MAX_CHECKPOINTS));
    }

    // Find user's key
    const found = getUserKey(tv.userId);
    if (!found) {
        return res.send(verifyPageHtml(token, "error", "No key found for your account. Type ?getkey first.", 0, CONFIG.MAX_CHECKPOINTS));
    }

    const { key, data } = found;

    if (data.checkpoints >= CONFIG.MAX_CHECKPOINTS) {
        return res.send(verifyPageHtml(token, "error", `You've already completed all ${CONFIG.MAX_CHECKPOINTS} checkpoints.`, data.checkpoints, CONFIG.MAX_CHECKPOINTS));
    }

    // ✓ Complete the checkpoint
    tv.used = true;
    verifyTokens.set(token, tv);

    data.checkpoints++;
    data.expiresAt = Date.now() + (CONFIG.HOURS_PER_CHECKPOINT * 3600000);
    keys.set(key, data);

    const totalHours = data.checkpoints * CONFIG.HOURS_PER_CHECKPOINT;
    console.log(`[VoidKey] ✓ Checkpoint ${data.checkpoints}/${CONFIG.MAX_CHECKPOINTS} for user ${tv.userId} — key expires in ${totalHours}h`);

    return res.send(verifyPageHtml(
        token,
        "success",
        `Checkpoint ${data.checkpoints} complete! Your key is now valid for <strong>${msToHuman(data.expiresAt - Date.now())}</strong>.`,
        data.checkpoints,
        CONFIG.MAX_CHECKPOINTS
    ));
});

// ── GET /validate?key=VOID-XXXX ──────────────
app.get("/validate", (req, res) => {
    const ip  = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
    const key = (req.query.key || "").toUpperCase().trim();

    if (isBlocked(ip)) {
        return res.json({ valid: false, message: "Too many failed attempts. Try again later." });
    }

    if (!key) {
        recordFail(ip);
        return res.json({ valid: false, message: "No key provided" });
    }

    if (!verifyKeyHmac(key)) {
        recordFail(ip);
        return res.json({ valid: false, message: "Invalid key format" });
    }

    const data = keys.get(key);
    if (!data) {
        recordFail(ip);
        return res.json({ valid: false, message: "Key not found" });
    }

    if (data.blocked) {
        return res.json({ valid: false, message: "Key has been revoked" });
    }

    if (data.expiresAt === 0) {
        return res.json({ valid: false, message: "Key not activated — complete a checkpoint first via ?getkey" });
    }

    if (Date.now() > data.expiresAt) {
        return res.json({ valid: false, message: "Key has expired — type ?getkey to get a new checkpoint link" });
    }

    const timeLeft   = msToHuman(data.expiresAt - Date.now());
    const cpLeft     = CONFIG.MAX_CHECKPOINTS - data.checkpoints;

    console.log(`[VoidKey] ✓ Validated: ${key} (${timeLeft} left, ${data.checkpoints}/${CONFIG.MAX_CHECKPOINTS} cp)`);

    return res.json({
        valid:       true,
        message:     "Access granted",
        userId:      data.userId,
        checkpoints: data.checkpoints,
        maxCheckpoints: CONFIG.MAX_CHECKPOINTS,
        checkpointsLeft: cpLeft,
        expiresIn:   timeLeft,
        expiresAt:   data.expiresAt,
    });
});

// Health check
app.get("/", (req, res) => {
    const active = [...keys.values()].filter(d => !d.blocked && d.expiresAt > Date.now()).length;
    res.json({ status: "ok", totalKeys: keys.size, activeKeys: active });
});

// ══════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════
app.listen(CONFIG.API_PORT, () => {
    console.log(`[VoidKey] API listening on port ${CONFIG.API_PORT}`);
});

process.on("unhandledRejection", (err) => {
    console.error("[VoidKey] Unhandled rejection:", err?.message || err);
});

// ══════════════════════════════════════════════
//  KEEP-ALIVE  — pings itself every 10 minutes
//  Prevents Render free tier from sleeping
// ══════════════════════════════════════════════
function keepAlive() {
    const url = CONFIG.BASE_URL;
    if (!url || url.includes("localhost")) return;

    setInterval(() => {
        const lib = url.startsWith("https") ? https : http;
        const req = lib.get(url, (res) => {
            console.log(`[VoidKey] Keep-alive ping → ${res.statusCode}`);
        });
        req.on("error", (err) => {
            console.warn("[VoidKey] Keep-alive error:", err.message);
        });
        req.end();
    }, 10 * 60 * 1000); // every 10 minutes

    console.log("[VoidKey] Keep-alive started — pinging every 10 minutes");
}

keepAlive();

client.login(CONFIG.TOKEN).catch((err) => {
    console.error("[VoidKey] LOGIN FAILED:", err.message);
    process.exit(1);
});
