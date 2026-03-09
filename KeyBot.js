const {
    Client, GatewayIntentBits, Partials,
    EmbedBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    Events
} = require("discord.js");
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
    KEY_SECRET:         process.env.KEY_SECRET || "void_default_secret",
    API_SECRET:         process.env.API_SECRET || "",
    API_PORT:           process.env.PORT        || 3000,
    BASE_URL:           process.env.BASE_URL    || "https://void-r3co.onrender.com",

    KEY_PREFIX:    "VOID",
    KEY_SEGMENTS:  3,
    KEY_SEG_LEN:   4,

    HOURS_PER_STEP: 24,           // each step = 24h
    MAX_STEPS:      3,            // max steps selectable

    VERIFY_TOKEN_TTL:  15 * 60 * 1000,  // verification link valid for 15 min
    MAX_FAIL_ATTEMPTS: 5,
    FAIL_WINDOW_MS:    10 * 60 * 1000,
    BLOCK_DURATION_MS: 60 * 60 * 1000,
};

// ══════════════════════════════════════════════
//  STARTUP
// ══════════════════════════════════════════════
console.log("[VoidKey] Starting...");
console.log("[VoidKey] BOT_TOKEN set:", !!CONFIG.TOKEN);
console.log("[VoidKey] GUILD_ID set:", !!CONFIG.GUILD_ID);
console.log("[VoidKey] GET_KEY_CHANNEL_ID set:", !!CONFIG.GET_KEY_CHANNEL_ID);

if (!CONFIG.TOKEN)              { console.error("[VoidKey] ERROR: BOT_TOKEN missing!");          process.exit(1); }
if (!CONFIG.GUILD_ID)           { console.error("[VoidKey] ERROR: GUILD_ID missing!");           process.exit(1); }
if (!CONFIG.GET_KEY_CHANNEL_ID) { console.error("[VoidKey] ERROR: GET_KEY_CHANNEL_ID missing!"); process.exit(1); }

// ══════════════════════════════════════════════
//  STORAGE
//
//  pendingUsers = Map<userId, {
//    totalSteps:   number,   how many steps they chose
//    currentStep:  number,   which step they're on (1-based)
//    createdAt:    number,
//  }>
//
//  keys = Map<keyString, {
//    userId:     string,
//    createdAt:  number,
//    totalSteps: number,
//    stepsCompleted: number,
//    expiresAt:  number,   0 = not activated yet
//    blocked:    boolean,
//  }>
//
//  verifyTokens = Map<token, {
//    userId:    string,
//    step:      number,    which step this token is for
//    createdAt: number,
//    used:      boolean,
//  }>
//
//  failLog = Map<ip, { count, firstFail, blockedUntil }>
// ══════════════════════════════════════════════
const pendingUsers  = new Map();
const keys          = new Map();
const verifyTokens  = new Map();
const failLog       = new Map();

// ══════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════
function msToHuman(ms) {
    if (ms <= 0) return "expired";
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function generateKey() {
    const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const segments = [];
    for (let s = 0; s < CONFIG.KEY_SEGMENTS; s++) {
        let seg = "";
        for (let c = 0; c < CONFIG.KEY_SEG_LEN; c++)
            seg += charset[Math.floor(Math.random() * charset.length)];
        segments.push(seg);
    }
    const raw = CONFIG.KEY_PREFIX + "-" + segments.join("-");
    const chk = crypto.createHmac("sha256", CONFIG.KEY_SECRET)
        .update(raw).digest("hex").slice(0, CONFIG.KEY_SEG_LEN).toUpperCase();
    return raw + "-" + chk;
}

function verifyKeyHmac(key) {
    const parts = key.split("-");
    if (parts.length < CONFIG.KEY_SEGMENTS + 2) return false;
    const chk = parts[parts.length - 1];
    const raw = parts.slice(0, parts.length - 1).join("-");
    const exp = crypto.createHmac("sha256", CONFIG.KEY_SECRET)
        .update(raw).digest("hex").slice(0, CONFIG.KEY_SEG_LEN).toUpperCase();
    return chk === exp;
}

function generateVerifyToken(userId, step) {
    const token = crypto.randomBytes(28).toString("hex");
    verifyTokens.set(token, { userId, step, createdAt: Date.now(), used: false });
    return token;
}

function getUserKey(userId) {
    for (const [k, d] of keys.entries()) {
        if (d.userId === userId && !d.blocked) return { key: k, data: d };
    }
    return null;
}

function recordFail(ip) {
    const now = Date.now();
    const rec = failLog.get(ip) || { count: 0, firstFail: now, blockedUntil: 0 };
    if (now - rec.firstFail > CONFIG.FAIL_WINDOW_MS) { rec.count = 0; rec.firstFail = now; }
    rec.count++;
    if (rec.count >= CONFIG.MAX_FAIL_ATTEMPTS) {
        rec.blockedUntil = now + CONFIG.BLOCK_DURATION_MS;
        console.warn(`[VoidKey] IP blocked: ${ip}`);
    }
    failLog.set(ip, rec);
}

function isBlocked(ip) {
    const rec = failLog.get(ip);
    return rec?.blockedUntil && Date.now() < rec.blockedUntil;
}

// Send the next checkpoint link to user via DM
async function sendCheckpointLink(user, step, totalSteps) {
    const token = generateVerifyToken(user.id, step);
    const link  = `${CONFIG.BASE_URL}/checkpoint?token=${token}`;
    const totalHours = totalSteps * CONFIG.HOURS_PER_STEP;

    const embed = new EmbedBuilder()
        .setColor(0x5c2da0)
        .setTitle(`◈  Checkpoint ${step} of ${totalSteps}`)
        .setDescription(
            `Complete this checkpoint to progress.\n\n` +
            `After all **${totalSteps}** checkpoints you'll receive your key\n` +
            `valid for **${totalHours} hours**.`
        )
        .addFields(
            { name: "📍 Progress",    value: buildProgressBar(step - 1, totalSteps), inline: false },
            { name: "⏱ Link Expires", value: "in **15 minutes**",                    inline: true  },
            { name: "⏳ Reward",       value: `**${totalHours}h** access`,             inline: true  },
            { name: "⚠️ Warning",      value: "**Do not share this link.** It is unique to you." }
        )
        .setFooter({ text: `Step ${step}/${totalSteps} · Complete all steps to get your key` })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel(`Complete Checkpoint ${step}`)
            .setStyle(ButtonStyle.Link)
            .setURL(link)
            .setEmoji("✅")
    );

    await user.send({ embeds: [embed], components: [row] });
}

// Send final key to user after all checkpoints done
async function sendFinalKey(user, key, totalSteps) {
    const totalHours = totalSteps * CONFIG.HOURS_PER_STEP;

    const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("◈  All Checkpoints Complete!")
        .setDescription(
            `You've completed all **${totalSteps}** checkpoints! 🎉\n` +
            `Here is your license key, valid for **${totalHours} hours**.`
        )
        .addFields(
            { name: "🔑 Your Key",    value: `\`\`\`${key}\`\`\`` },
            { name: "⏳ Valid For",   value: `**${totalHours} hours**`,         inline: true },
            { name: "✅ Checkpoints", value: `**${totalSteps}/${totalSteps}**`, inline: true },
            { name: "⚠️ Warning",     value: "**Never share this key.** It is tied to your account." }
        )
        .setFooter({ text: "VOID Key System · Do not share" })
        .setTimestamp();

    await user.send({ embeds: [embed] });
}

function buildProgressBar(done, total) {
    let bar = "";
    for (let i = 0; i < total; i++) {
        bar += i < done ? "🟣 " : "⚪ ";
    }
    return bar.trim() + `  (${done}/${total})`;
}

// ══════════════════════════════════════════════
//  DISCORD CLIENT
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

// ── ?getkey command ───────────────────────────
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (message.channelId !== CONFIG.GET_KEY_CHANNEL_ID) return;
    if (message.content.trim().toLowerCase() !== "?getkey") return;

    try { await message.delete(); } catch (e) {}

    const user  = message.author;
    const found = getUserKey(user.id);

    // If user already has an active key
    if (found && found.data.expiresAt > Date.now()) {
        const timeLeft = msToHuman(found.data.expiresAt - Date.now());
        try {
            const embed = new EmbedBuilder()
                .setColor(0x5c2da0)
                .setTitle("◈  You Already Have an Active Key")
                .setDescription("Your current key is still valid.")
                .addFields(
                    { name: "🔑 Key",      value: `\`\`\`${found.key}\`\`\`` },
                    { name: "⏳ Expires",  value: `in **${timeLeft}**` }
                )
                .setFooter({ text: "Do not share your key." })
                .setTimestamp();
            await user.send({ embeds: [embed] });
        } catch { }
        const w = await message.channel.send(`<@${user.id}> ✓ Key sent via DM!`);
        setTimeout(() => w.delete().catch(() => {}), 5000);
        return;
    }

    // If user is mid-verification already
    if (pendingUsers.has(user.id)) {
        try {
            const pending = pendingUsers.get(user.id);
            await sendCheckpointLink(user, pending.currentStep, pending.totalSteps);
            const w = await message.channel.send(`<@${user.id}> ✓ Checkpoint link sent via DM!`);
            setTimeout(() => w.delete().catch(() => {}), 5000);
        } catch {
            const w = await message.channel.send(`<@${user.id}> ❌ Enable DMs from server members.`);
            setTimeout(() => w.delete().catch(() => {}), 8000);
        }
        return;
    }

    // Send step selection dropdown via DM
    try {
        const embed = new EmbedBuilder()
            .setColor(0x5c2da0)
            .setTitle("◈  Choose Your Verification Steps")
            .setDescription(
                "Select how many checkpoints you want to complete.\n\n" +
                "More steps = longer key access.\n" +
                "You must complete **all** steps before receiving your key."
            )
            .addFields(
                { name: "1 Step",  value: `Complete **1** checkpoint → **24h** access`,  inline: false },
                { name: "2 Steps", value: `Complete **2** checkpoints → **48h** access`, inline: false },
                { name: "3 Steps", value: `Complete **3** checkpoints → **72h** access`, inline: false },
            )
            .setFooter({ text: "VOID Key System · Select below" })
            .setTimestamp();

        const menu = new StringSelectMenuBuilder()
            .setCustomId(`steps_${user.id}`)
            .setPlaceholder("Choose number of steps...")
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel("1 Step — 24 Hours")
                    .setDescription("Complete 1 checkpoint to get a 24h key")
                    .setValue("1")
                    .setEmoji("1️⃣"),
                new StringSelectMenuOptionBuilder()
                    .setLabel("2 Steps — 48 Hours")
                    .setDescription("Complete 2 checkpoints to get a 48h key")
                    .setValue("2")
                    .setEmoji("2️⃣"),
                new StringSelectMenuOptionBuilder()
                    .setLabel("3 Steps — 72 Hours")
                    .setDescription("Complete 3 checkpoints to get a 72h key")
                    .setValue("3")
                    .setEmoji("3️⃣"),
            );

        const row = new ActionRowBuilder().addComponents(menu);
        await user.send({ embeds: [embed], components: [row] });

        const ack = await message.channel.send(`✓  <@${user.id}> Check your DMs!`);
        setTimeout(() => ack.delete().catch(() => {}), 5000);

    } catch (e) {
        console.error("[VoidKey] Could not DM:", e.message);
        const err = await message.channel.send(`<@${user.id}> ❌ Enable DMs from server members and try again.`);
        setTimeout(() => err.delete().catch(() => {}), 8000);
    }
});

// ── Dropdown interaction handler ──────────────
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith("steps_")) return;

    const userId     = interaction.customId.replace("steps_", "");
    const user       = interaction.user;

    // Make sure it's the right user
    if (user.id !== userId) {
        await interaction.reply({ content: "❌ This menu isn't for you.", ephemeral: true });
        return;
    }

    const totalSteps = parseInt(interaction.values[0]);
    const totalHours = totalSteps * CONFIG.HOURS_PER_STEP;

    // Acknowledge the selection
    await interaction.update({
        embeds: [
            new EmbedBuilder()
                .setColor(0x5c2da0)
                .setTitle("◈  Steps Selected")
                .setDescription(
                    `You chose **${totalSteps} step${totalSteps > 1 ? "s" : ""}** → **${totalHours}h** access.\n\n` +
                    `Complete all checkpoints to receive your key.\n` +
                    `Your first checkpoint link is below. ↓`
                )
                .setFooter({ text: "Do not share your checkpoint links." })
                .setTimestamp()
        ],
        components: []
    });

    // Generate the key (not activated yet — stays locked until all steps done)
    const newKey = generateKey();
    keys.set(newKey, {
        userId:         user.id,
        createdAt:      Date.now(),
        totalSteps:     totalSteps,
        stepsCompleted: 0,
        expiresAt:      0,    // 0 = locked until all steps done
        blocked:        false,
    });

    // Save pending state
    pendingUsers.set(user.id, {
        totalSteps,
        currentStep: 1,
        createdAt: Date.now(),
    });

    console.log(`[VoidKey] ${user.tag} chose ${totalSteps} steps — key: ${newKey}`);

    // Send checkpoint 1 link
    try {
        await sendCheckpointLink(user, 1, totalSteps);
    } catch (e) {
        console.error("[VoidKey] Could not send checkpoint:", e.message);
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
        if (data) { data.blocked = true; keys.set(key, data); await msg.reply(`✓ Revoked: \`${key}\``); }
        else await msg.reply(`❌ Not found: \`${key}\``);
    }

    if (cmd === "!listkeys") {
        if (keys.size === 0) return msg.reply("No keys.");
        let out = "**Keys:**\n";
        for (const [k, d] of keys.entries()) {
            const status = d.blocked ? "🚫 revoked"
                : d.expiresAt === 0 ? `⏸ pending (${d.stepsCompleted}/${d.totalSteps} steps)`
                : Date.now() > d.expiresAt ? "💀 expired"
                : `✓ active — ${msToHuman(d.expiresAt - Date.now())} left`;
            out += `\`${k}\` → <@${d.userId}> [${status}]\n`;
        }
        await msg.reply(out.slice(0, 2000));
    }

    if (cmd === "!stats") {
        const total   = keys.size;
        const active  = [...keys.values()].filter(d => !d.blocked && d.expiresAt > Date.now()).length;
        const pending = [...keys.values()].filter(d => d.expiresAt === 0 && !d.blocked).length;
        const expired = [...keys.values()].filter(d => d.expiresAt > 0 && Date.now() > d.expiresAt).length;
        await msg.reply(`**Stats**\nTotal: ${total} | Active: ${active} | Pending: ${pending} | Expired: ${expired}`);
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

app.use((req, res, next) => {
    if (CONFIG.API_SECRET && req.headers["x-api-key"] !== CONFIG.API_SECRET)
        return res.status(401).json({ valid: false, message: "Unauthorized" });
    next();
});

// ── GET /checkpoint?token=XXX ─────────────────
app.get("/checkpoint", async (req, res) => {
    const token = req.query.token || "";

    if (!token)
        return res.send(checkpointPage("error", "Invalid link.", 0, 1, 1));

    const tv = verifyTokens.get(token);

    if (!tv)
        return res.send(checkpointPage("error", "This link is invalid or already used.", 0, 1, 1));

    if (tv.used)
        return res.send(checkpointPage("error", "This link has already been used.", tv.step - 1, tv.step, 3));

    if (Date.now() - tv.createdAt > CONFIG.VERIFY_TOKEN_TTL) {
        verifyTokens.delete(token);
        return res.send(checkpointPage("error", "This link expired. Type ?getkey again.", 0, tv.step, 3));
    }

    const found = getUserKey(tv.userId);
    if (!found)
        return res.send(checkpointPage("error", "No key found for your account.", 0, tv.step, 3));

    const { key, data } = found;
    const pending = pendingUsers.get(tv.userId);

    if (!pending)
        return res.send(checkpointPage("error", "Session expired. Type ?getkey again.", data.stepsCompleted, tv.step, data.totalSteps));

    // Make sure this token is for the right step
    if (tv.step !== pending.currentStep)
        return res.send(checkpointPage("error", `Wrong step. You need to complete step ${pending.currentStep}.`, data.stepsCompleted, tv.step, data.totalSteps));

    // ✓ Complete this step
    tv.used = true;
    verifyTokens.set(token, tv);

    data.stepsCompleted++;
    keys.set(key, data);

    console.log(`[VoidKey] Step ${data.stepsCompleted}/${data.totalSteps} complete for user ${tv.userId}`);

    // All steps done? Activate key and DM the user their key
    if (data.stepsCompleted >= data.totalSteps) {
        data.expiresAt = Date.now() + (data.totalSteps * CONFIG.HOURS_PER_STEP * 3600000);
        keys.set(key, data);
        pendingUsers.delete(tv.userId);

        // DM the user their key
        try {
            const user = await client.users.fetch(tv.userId);
            await sendFinalKey(user, key, data.totalSteps);
        } catch (e) {
            console.error("[VoidKey] Could not DM final key:", e.message);
        }

        return res.send(checkpointPage(
            "complete",
            `All ${data.totalSteps} checkpoints done! Your key has been sent to your Discord DMs.`,
            data.stepsCompleted,
            data.stepsCompleted,
            data.totalSteps
        ));
    }

    // More steps remaining — advance and DM next link
    pending.currentStep++;
    pendingUsers.set(tv.userId, pending);

    try {
        const user = await client.users.fetch(tv.userId);
        await sendCheckpointLink(user, pending.currentStep, data.totalSteps);
    } catch (e) {
        console.error("[VoidKey] Could not DM next checkpoint:", e.message);
    }

    return res.send(checkpointPage(
        "success",
        `Step ${data.stepsCompleted} complete! Check your Discord DMs for the next checkpoint.`,
        data.stepsCompleted,
        data.stepsCompleted,
        data.totalSteps
    ));
});

// ── GET /validate?key=XXX ─────────────────────
app.get("/validate", (req, res) => {
    const ip  = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
    const key = (req.query.key || "").toUpperCase().trim();

    if (isBlocked(ip)) return res.json({ valid: false, message: "Too many failed attempts. Try again later." });
    if (!key)          { recordFail(ip); return res.json({ valid: false, message: "No key provided" }); }
    if (!verifyKeyHmac(key)) { recordFail(ip); return res.json({ valid: false, message: "Invalid key format" }); }

    const data = keys.get(key);
    if (!data)        { recordFail(ip); return res.json({ valid: false, message: "Key not found" }); }
    if (data.blocked)  return res.json({ valid: false, message: "Key has been revoked" });
    if (data.expiresAt === 0) return res.json({ valid: false, message: "Key not activated — complete your checkpoints first" });
    if (Date.now() > data.expiresAt) return res.json({ valid: false, message: "Key has expired — type ?getkey for a new one" });

    const timeLeft = msToHuman(data.expiresAt - Date.now());
    console.log(`[VoidKey] ✓ Validated: ${key} (${timeLeft} left)`);

    return res.json({ valid: true, message: "Access granted", userId: data.userId, expiresIn: timeLeft, expiresAt: data.expiresAt });
});

app.get("/", (req, res) => {
    const active = [...keys.values()].filter(d => !d.blocked && d.expiresAt > Date.now()).length;
    res.json({ status: "ok", totalKeys: keys.size, activeKeys: active });
});

// ══════════════════════════════════════════════
//  CHECKPOINT PAGE HTML
// ══════════════════════════════════════════════
function checkpointPage(state, message, done, current, total) {
    const steps = Array.from({ length: total }, (_, i) => {
        const n    = i + 1;
        const cls  = n <= done ? "done" : n === current && state === "success" ? "done" : n === current ? "active" : "locked";
        const icon = n <= done || (n === current && state === "success") ? "✓" : n;
        return `<div class="step ${cls}"><div class="step-num">${icon}</div><div class="step-lbl">Step ${n}<br><span>${n * 24}h</span></div></div>`;
    }).join('<div class="connector"></div>');

    const colors = { success: "#22c55e", complete: "#a855f7", error: "#ef4444", info: "#c4b5fd" };
    const color  = colors[state] || colors.info;

    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VOID — Checkpoint</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#04030a;color:#a89dc0;font-family:'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{background:#0e0c1a;border:1px solid #2d1f4a;border-radius:20px;padding:44px 36px;max-width:460px;width:92%;text-align:center;box-shadow:0 0 80px #5a32a318}
.logo{font-size:48px;color:#7c3aed;margin-bottom:10px}
h1{color:#c4b5fd;font-size:20px;letter-spacing:8px;margin-bottom:4px}
.sub{color:#4a3668;font-size:11px;letter-spacing:3px;margin-bottom:36px}
.steps{display:flex;align-items:center;justify-content:center;gap:0;margin-bottom:36px}
.step{display:flex;flex-direction:column;align-items:center;gap:8px}
.connector{width:32px;height:2px;background:#1e1530;margin-bottom:24px}
.step-num{width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:bold;border:2px solid #1e1530;background:#120e20;color:#3a2858}
.step.done .step-num{background:#2d1a5e;border-color:#7c3aed;color:#c4b5fd;box-shadow:0 0 14px #7c3aed40}
.step.active .step-num{background:#3b1f6e;border-color:#a855f7;color:#e9d5ff;box-shadow:0 0 18px #a855f760}
.step-lbl{font-size:10px;color:#3a2858;text-align:center;line-height:1.5}
.step-lbl span{color:#6d28d9}
.step.done .step-lbl,.step.active .step-lbl{color:#8b7aaa}
.msg{padding:16px 20px;border-radius:12px;font-size:13px;margin-bottom:28px;border:1px solid;color:${color};background:${color}15;border-color:${color}40;line-height:1.6}
.btn{display:block;background:#5b21b6;color:#e9d5ff;border:none;border-radius:12px;padding:14px 32px;font-size:12px;font-weight:bold;letter-spacing:3px;cursor:pointer;text-decoration:none;transition:.2s;width:100%}
.btn:hover{background:#7c3aed}
.footer{margin-top:24px;font-size:10px;color:#2a1f40;letter-spacing:2px}
</style></head><body>
<div class="card">
  <div class="logo">◈</div>
  <h1>VOID</h1>
  <p class="sub">CHECKPOINT VERIFICATION</p>
  <div class="steps">${steps}</div>
  <div class="msg">${message}</div>
  <a href="javascript:window.close()" class="btn">CLOSE WINDOW</a>
  <p class="footer">VOID KEY SYSTEM · DO NOT SHARE YOUR LINKS</p>
</div></body></html>`;
}

// ══════════════════════════════════════════════
//  START + KEEP-ALIVE
// ══════════════════════════════════════════════
app.listen(CONFIG.API_PORT, () => {
    console.log(`[VoidKey] API listening on port ${CONFIG.API_PORT}`);
});

function keepAlive() {
    const url = CONFIG.BASE_URL;
    if (!url || url.includes("localhost")) return;
    setInterval(() => {
        const lib = url.startsWith("https") ? https : http;
        const req = lib.get(url, (res) => {
            console.log(`[VoidKey] Keep-alive → ${res.statusCode}`);
        });
        req.on("error", (e) => console.warn("[VoidKey] Keep-alive error:", e.message));
        req.end();
    }, 10 * 60 * 1000);
    console.log("[VoidKey] Keep-alive started");
}

keepAlive();

process.on("unhandledRejection", (err) => {
    console.error("[VoidKey] Unhandled rejection:", err?.message || err);
});

client.login(CONFIG.TOKEN).catch((err) => {
    console.error("[VoidKey] LOGIN FAILED:", err.message);
    process.exit(1);
});
