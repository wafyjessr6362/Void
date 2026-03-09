/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║            V O I D   K E Y   S Y S T E M                   ║
 * ║         Ultimate Discord Bot + Validation API               ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  FEATURES:                                                  ║
 * ║  • Dropdown step selector (1/2/3 steps = 24/48/72h)        ║
 * ║  • Sequential checkpoints — key hidden until all done       ║
 * ║  • HMAC-signed keys — fakes rejected instantly              ║
 * ║  • Rate limiting — anti-bot protection                      ║
 * ║  • Auto keep-alive — never sleeps on Render free tier       ║
 * ║  • Auto cleanup — expired keys/tokens removed hourly        ║
 * ║  • Admin DM commands — revoke, list, stats, reset           ║
 * ║  • Beautiful checkpoint webpage with progress bar           ║
 * ║  • Cooldown — prevents spam ?getkey                         ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 *  ENV VARIABLES (set in Render → Environment):
 *  BOT_TOKEN            Discord bot token
 *  GUILD_ID             Your Discord server ID
 *  GET_KEY_CHANNEL_ID   Channel where users type ?getkey
 *  KEY_SECRET           Any long random string (signs keys)
 *  BASE_URL             https://your-service.onrender.com
 *  API_SECRET           Optional header auth for /validate
 */

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

// ═══════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════
const CONFIG = {
    // From Render environment variables
    TOKEN:              process.env.BOT_TOKEN,
    GET_KEY_CHANNEL_ID: process.env.GET_KEY_CHANNEL_ID,
    GUILD_ID:           process.env.GUILD_ID,
    KEY_SECRET:         process.env.KEY_SECRET  || "change_this_secret",
    API_SECRET:         process.env.API_SECRET  || "",
    API_PORT:           process.env.PORT         || 3000,
    BASE_URL:           process.env.BASE_URL     || "https://void-r3co.onrender.com",

    // Key format: VOID-XXXX-XXXX-XXXX-CHCK
    KEY_PREFIX:    "VOID",
    KEY_SEGMENTS:  3,
    KEY_SEG_LEN:   4,

    // Verification
    HOURS_PER_STEP:    24,           // hours added per completed checkpoint
    MAX_STEPS:         3,            // max steps available

    // Timers
    VERIFY_TOKEN_TTL:  15 * 60 * 1000,   // checkpoint link valid 15 min
    GETKEY_COOLDOWN:   30 * 1000,         // cooldown between ?getkey uses
    CLEANUP_INTERVAL:  60 * 60 * 1000,    // clean expired data every hour
    KEEPALIVE_INTERVAL: 10 * 60 * 1000,   // ping self every 10 min

    // Anti-bot
    MAX_FAIL_ATTEMPTS:  5,
    FAIL_WINDOW_MS:     10 * 60 * 1000,
    BLOCK_DURATION_MS:  60 * 60 * 1000,
};

// ═══════════════════════════════════════════════════════
//  STARTUP VALIDATION
// ═══════════════════════════════════════════════════════
console.log("╔════════════════════════════════╗");
console.log("║     VOID KEY SYSTEM STARTING   ║");
console.log("╚════════════════════════════════╝");
console.log(`[VoidKey] BOT_TOKEN          : ${CONFIG.TOKEN          ? "✓ set" : "✗ MISSING"}`);
console.log(`[VoidKey] GUILD_ID           : ${CONFIG.GUILD_ID       ? "✓ set" : "✗ MISSING"}`);
console.log(`[VoidKey] GET_KEY_CHANNEL_ID : ${CONFIG.GET_KEY_CHANNEL_ID ? "✓ set" : "✗ MISSING"}`);
console.log(`[VoidKey] BASE_URL           : ${CONFIG.BASE_URL}`);

if (!CONFIG.TOKEN)              { console.error("[VoidKey] FATAL: BOT_TOKEN missing!");          process.exit(1); }
if (!CONFIG.GUILD_ID)           { console.error("[VoidKey] FATAL: GUILD_ID missing!");           process.exit(1); }
if (!CONFIG.GET_KEY_CHANNEL_ID) { console.error("[VoidKey] FATAL: GET_KEY_CHANNEL_ID missing!"); process.exit(1); }

// ═══════════════════════════════════════════════════════
//  STORAGE
// ═══════════════════════════════════════════════════════
// keys         → Map<keyString, KeyData>
// pendingUsers → Map<userId, PendingData>
// verifyTokens → Map<token, TokenData>
// cooldowns    → Map<userId, timestamp>
// failLog      → Map<ip, FailData>
const keys          = new Map();
const pendingUsers  = new Map();
const verifyTokens  = new Map();
const cooldowns     = new Map();
const failLog       = new Map();

// ═══════════════════════════════════════════════════════
//  KEY GENERATION & VALIDATION
// ═══════════════════════════════════════════════════════
function generateKey() {
    const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const segs = [];
    for (let s = 0; s < CONFIG.KEY_SEGMENTS; s++) {
        let seg = "";
        for (let c = 0; c < CONFIG.KEY_SEG_LEN; c++)
            seg += charset[Math.floor(Math.random() * charset.length)];
        segs.push(seg);
    }
    const raw = `${CONFIG.KEY_PREFIX}-${segs.join("-")}`;
    const chk = crypto.createHmac("sha256", CONFIG.KEY_SECRET)
        .update(raw).digest("hex")
        .slice(0, CONFIG.KEY_SEG_LEN).toUpperCase();
    return `${raw}-${chk}`;
}

function verifyKeyHmac(key) {
    const parts = key.split("-");
    if (parts.length < CONFIG.KEY_SEGMENTS + 2) return false;
    const chk = parts[parts.length - 1];
    const raw = parts.slice(0, parts.length - 1).join("-");
    const exp = crypto.createHmac("sha256", CONFIG.KEY_SECRET)
        .update(raw).digest("hex")
        .slice(0, CONFIG.KEY_SEG_LEN).toUpperCase();
    return chk === exp;
}

// ═══════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════
function msToHuman(ms) {
    if (ms <= 0) return "expired";
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function progressBar(done, total) {
    let bar = "";
    for (let i = 0; i < total; i++)
        bar += i < done ? "🟣 " : "⚫ ";
    return bar.trim() + `  (${done}/${total})`;
}

function getUserKey(userId) {
    for (const [k, d] of keys.entries())
        if (d.userId === userId && !d.blocked) return { key: k, data: d };
    return null;
}

function generateToken(userId, step) {
    const token = crypto.randomBytes(32).toString("hex");
    verifyTokens.set(token, { userId, step, createdAt: Date.now(), used: false });
    return token;
}

function isOnCooldown(userId) {
    const last = cooldowns.get(userId);
    if (!last) return false;
    return Date.now() - last < CONFIG.GETKEY_COOLDOWN;
}

function setCooldown(userId) {
    cooldowns.set(userId, Date.now());
}

function recordFail(ip) {
    const now = Date.now();
    const rec = failLog.get(ip) || { count: 0, firstFail: now, blockedUntil: 0 };
    if (now - rec.firstFail > CONFIG.FAIL_WINDOW_MS) { rec.count = 0; rec.firstFail = now; }
    rec.count++;
    if (rec.count >= CONFIG.MAX_FAIL_ATTEMPTS) {
        rec.blockedUntil = now + CONFIG.BLOCK_DURATION_MS;
        console.warn(`[VoidKey] ⚠ IP blocked: ${ip} (${rec.count} failures)`);
    }
    failLog.set(ip, rec);
}

function isBlocked(ip) {
    const rec = failLog.get(ip);
    return !!(rec?.blockedUntil && Date.now() < rec.blockedUntil);
}

// ═══════════════════════════════════════════════════════
//  DM BUILDERS
// ═══════════════════════════════════════════════════════
async function dmCheckpointLink(user, step, totalSteps) {
    const token      = generateToken(user.id, step);
    const link       = `${CONFIG.BASE_URL}/checkpoint?token=${token}`;
    const totalHours = totalSteps * CONFIG.HOURS_PER_STEP;

    const embed = new EmbedBuilder()
        .setColor(0x6d28d9)
        .setTitle(`◈  Checkpoint ${step} of ${totalSteps}`)
        .setDescription(
            `Click the button below to complete **Checkpoint ${step}**.\n\n` +
            `After all **${totalSteps}** checkpoints you'll receive a key valid for **${totalHours}h**.`
        )
        .addFields(
            { name: "📍 Progress",     value: progressBar(step - 1, totalSteps) },
            { name: "⏱ Link Valid For", value: "**15 minutes**",  inline: true },
            { name: "🎁 Total Reward",  value: `**${totalHours}h** access`, inline: true },
            { name: "⚠️ Warning",       value: "**Do not share this link.** It is unique to your account." }
        )
        .setFooter({ text: `VOID Key System · Checkpoint ${step}/${totalSteps}` })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel(`  Complete Checkpoint ${step}`)
            .setStyle(ButtonStyle.Link)
            .setURL(link)
            .setEmoji("✅")
    );

    await user.send({ embeds: [embed], components: [row] });
}

async function dmFinalKey(user, key, totalSteps) {
    const totalHours = totalSteps * CONFIG.HOURS_PER_STEP;

    const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("◈  All Checkpoints Complete! 🎉")
        .setDescription(
            `You've completed all **${totalSteps}** checkpoint${totalSteps > 1 ? "s" : ""}!\n` +
            `Your license key is now active for **${totalHours} hours**.`
        )
        .addFields(
            { name: "🔑 License Key",    value: `\`\`\`${key}\`\`\`` },
            { name: "📍 Checkpoints",    value: progressBar(totalSteps, totalSteps) },
            { name: "⏳ Valid For",       value: `**${totalHours} hours**`,              inline: true },
            { name: "🔒 Key Type",        value: `**${totalSteps}-Step Verified**`,      inline: true },
            { name: "⚠️ Important",      value: "**Never share this key.** It is permanently tied to your Discord account." }
        )
        .setFooter({ text: "VOID Key System · Keep this safe" })
        .setTimestamp();

    await user.send({ embeds: [embed] });
}

// ═══════════════════════════════════════════════════════
//  DISCORD CLIENT
// ═══════════════════════════════════════════════════════
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
    console.log(`[VoidKey] ✓ Serving ${client.guilds.cache.size} guild(s)`);
    client.user.setActivity("?getkey", { type: 3 });
});

client.on("error", (err) => console.error("[VoidKey] Client error:", err.message));

// ═══════════════════════════════════════════════════════
//  ?getkey  COMMAND
// ═══════════════════════════════════════════════════════
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (message.channelId !== CONFIG.GET_KEY_CHANNEL_ID) return;
    if (message.content.trim().toLowerCase() !== "?getkey") return;

    // Delete message immediately — private
    try { await message.delete(); } catch {}

    const user  = message.author;
    const found = getUserKey(user.id);

    // ── Active key exists ──────────────────────────────
    if (found && found.data.expiresAt > Date.now()) {
        try {
            const tl = msToHuman(found.data.expiresAt - Date.now());
            await user.send({
                embeds: [new EmbedBuilder()
                    .setColor(0x6d28d9)
                    .setTitle("◈  Active Key Found")
                    .setDescription("You already have an active key.")
                    .addFields(
                        { name: "🔑 Key",     value: `\`\`\`${found.key}\`\`\`` },
                        { name: "⏳ Expires", value: `in **${tl}**` }
                    )
                    .setFooter({ text: "Do not share your key." })
                    .setTimestamp()
                ]
            });
        } catch {}
        const w = await message.channel.send(`<@${user.id}> ✓ Check your DMs!`);
        setTimeout(() => w.delete().catch(() => {}), 5000);
        return;
    }

    // ── Cooldown check ─────────────────────────────────
    if (isOnCooldown(user.id)) {
        const w = await message.channel.send(`<@${user.id}> ⏱ Please wait a moment before using ?getkey again.`);
        setTimeout(() => w.delete().catch(() => {}), 5000);
        return;
    }
    setCooldown(user.id);

    // ── Mid-verification: resend current checkpoint ────
    if (pendingUsers.has(user.id)) {
        const pending = pendingUsers.get(user.id);
        try {
            await dmCheckpointLink(user, pending.currentStep, pending.totalSteps);
            const w = await message.channel.send(`<@${user.id}> ✓ Checkpoint link resent via DM!`);
            setTimeout(() => w.delete().catch(() => {}), 5000);
        } catch {
            const w = await message.channel.send(`<@${user.id}> ❌ Enable DMs from server members first.`);
            setTimeout(() => w.delete().catch(() => {}), 8000);
        }
        return;
    }

    // ── New user — send step selector dropdown ─────────
    try {
        const embed = new EmbedBuilder()
            .setColor(0x6d28d9)
            .setTitle("◈  VOID Key System")
            .setDescription(
                "Choose how many verification steps you want to complete.\n\n" +
                "**More steps = longer key access.**\n" +
                "Your key will only be revealed after completing **all** chosen steps."
            )
            .addFields(
                { name: "1️⃣  1 Step",  value: "Complete **1** checkpoint  →  **24h** access",  inline: false },
                { name: "2️⃣  2 Steps", value: "Complete **2** checkpoints →  **48h** access", inline: false },
                { name: "3️⃣  3 Steps", value: "Complete **3** checkpoints →  **72h** access", inline: false },
            )
            .setFooter({ text: "VOID Key System · Select your steps below" })
            .setTimestamp();

        const menu = new StringSelectMenuBuilder()
            .setCustomId(`stepselect_${user.id}`)
            .setPlaceholder("🔑  Choose your verification steps...")
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel("1 Step — 24 Hours")
                    .setDescription("1 checkpoint · 24h key")
                    .setValue("1").setEmoji("1️⃣"),
                new StringSelectMenuOptionBuilder()
                    .setLabel("2 Steps — 48 Hours")
                    .setDescription("2 checkpoints · 48h key")
                    .setValue("2").setEmoji("2️⃣"),
                new StringSelectMenuOptionBuilder()
                    .setLabel("3 Steps — 72 Hours")
                    .setDescription("3 checkpoints · 72h key (best value)")
                    .setValue("3").setEmoji("3️⃣"),
            );

        await user.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });

        const ack = await message.channel.send(`✓  <@${user.id}> Check your DMs!`);
        setTimeout(() => ack.delete().catch(() => {}), 5000);

    } catch (e) {
        console.error("[VoidKey] Could not DM user:", e.message);
        const err = await message.channel.send(`<@${user.id}> ❌ I couldn't DM you. Enable **DMs from server members** in your Privacy Settings, then try again.`);
        setTimeout(() => err.delete().catch(() => {}), 10000);
    }
});

// ═══════════════════════════════════════════════════════
//  DROPDOWN INTERACTION
// ═══════════════════════════════════════════════════════
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith("stepselect_")) return;

    const userId     = interaction.customId.replace("stepselect_", "");
    const user       = interaction.user;

    if (user.id !== userId) {
        return interaction.reply({ content: "❌ This menu is not for you.", ephemeral: true });
    }

    const totalSteps = parseInt(interaction.values[0]);
    const totalHours = totalSteps * CONFIG.HOURS_PER_STEP;

    // Acknowledge — disable the dropdown
    await interaction.update({
        embeds: [new EmbedBuilder()
            .setColor(0x6d28d9)
            .setTitle("◈  Steps Confirmed")
            .setDescription(
                `You chose **${totalSteps} step${totalSteps > 1 ? "s" : ""}** → **${totalHours}h** access.\n\n` +
                `Complete all ${totalSteps} checkpoint${totalSteps > 1 ? "s" : ""} and your key will be sent automatically.\n\n` +
                `Your first checkpoint link is on its way. ↓`
            )
            .setFooter({ text: "Do not share your checkpoint links." })
            .setTimestamp()
        ],
        components: []
    });

    // Create the key (locked — expiresAt = 0 until all steps done)
    const newKey = generateKey();
    keys.set(newKey, {
        userId:         user.id,
        createdAt:      Date.now(),
        totalSteps,
        stepsCompleted: 0,
        expiresAt:      0,
        blocked:        false,
    });

    pendingUsers.set(user.id, {
        totalSteps,
        currentStep: 1,
        keyString:   newKey,
        createdAt:   Date.now(),
    });

    console.log(`[VoidKey] New key for ${user.tag} (${totalSteps} steps): ${newKey}`);

    try {
        await dmCheckpointLink(user, 1, totalSteps);
    } catch (e) {
        console.error("[VoidKey] Could not send checkpoint:", e.message);
    }
});

// ═══════════════════════════════════════════════════════
//  ADMIN DM COMMANDS  (server owner only)
//  !revoke <key>   !listkeys   !stats   !reset <userId>   !unblock <ip>
// ═══════════════════════════════════════════════════════
client.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;
    if (msg.channel.type !== 1) return; // DMs only

    const guild = await client.guilds.fetch(CONFIG.GUILD_ID).catch(() => null);
    if (!guild || msg.author.id !== guild.ownerId) return;

    const args = msg.content.trim().split(/\s+/);
    const cmd  = args[0].toLowerCase();

    // ── !revoke <key> ──────────────────────────────────
    if (cmd === "!revoke" && args[1]) {
        const key  = args[1].toUpperCase();
        const data = keys.get(key);
        if (data) {
            data.blocked = true;
            keys.set(key, data);
            await msg.reply(`✓ Key revoked: \`${key}\``);
        } else {
            await msg.reply(`❌ Key not found: \`${key}\``);
        }
        return;
    }

    // ── !reset <userId> ────────────────────────────────
    if (cmd === "!reset" && args[1]) {
        const uid = args[1];
        let found = false;
        for (const [k, d] of keys.entries()) {
            if (d.userId === uid) { keys.delete(k); found = true; }
        }
        pendingUsers.delete(uid);
        cooldowns.delete(uid);
        await msg.reply(found ? `✓ Reset all data for <@${uid}>` : `❌ No data found for <@${uid}>`);
        return;
    }

    // ── !listkeys ──────────────────────────────────────
    if (cmd === "!listkeys") {
        if (keys.size === 0) return msg.reply("No keys in store.");
        let out = `**Keys (${keys.size} total):**\n`;
        for (const [k, d] of keys.entries()) {
            const status =
                d.blocked                               ? "🚫 revoked"
                : d.expiresAt === 0                    ? `⏸ pending (${d.stepsCompleted}/${d.totalSteps} steps)`
                : Date.now() > d.expiresAt             ? "💀 expired"
                : `✓ active — ${msToHuman(d.expiresAt - Date.now())} left`;
            out += `\`${k}\` <@${d.userId}> [${status}]\n`;
        }
        // Split into chunks if long
        const chunks = out.match(/[\s\S]{1,1900}/g) || [out];
        for (const chunk of chunks) await msg.reply(chunk);
        return;
    }

    // ── !stats ─────────────────────────────────────────
    if (cmd === "!stats") {
        const total   = keys.size;
        const active  = [...keys.values()].filter(d => !d.blocked && d.expiresAt > Date.now()).length;
        const pending = [...keys.values()].filter(d => d.expiresAt === 0 && !d.blocked).length;
        const expired = [...keys.values()].filter(d => d.expiresAt > 0 && Date.now() > d.expiresAt).length;
        const revoked = [...keys.values()].filter(d => d.blocked).length;
        await msg.reply(
            `**╔ VOID Key Stats ╗**\n` +
            `Total keys    : **${total}**\n` +
            `Active        : **${active}**\n` +
            `Pending       : **${pending}**\n` +
            `Expired       : **${expired}**\n` +
            `Revoked       : **${revoked}**\n` +
            `Pending users : **${pendingUsers.size}**`
        );
        return;
    }

    // ── !unblock <ip> ──────────────────────────────────
    if (cmd === "!unblock" && args[1]) {
        failLog.delete(args[1]);
        await msg.reply(`✓ Unblocked IP: \`${args[1]}\``);
        return;
    }

    // ── !help ──────────────────────────────────────────
    if (cmd === "!help") {
        await msg.reply(
            "**VOID Admin Commands:**\n" +
            "`!revoke <key>`    — permanently revoke a key\n" +
            "`!reset <userId>`  — delete all data for a user\n" +
            "`!listkeys`        — list all keys and status\n" +
            "`!stats`           — show key statistics\n" +
            "`!unblock <ip>`    — unblock a rate-limited IP\n"
        );
    }
});

// ═══════════════════════════════════════════════════════
//  EXPRESS API
// ═══════════════════════════════════════════════════════
const app = express();
app.use(express.json());

// Optional API secret header middleware
app.use((req, res, next) => {
    if (CONFIG.API_SECRET && req.headers["x-api-key"] !== CONFIG.API_SECRET)
        return res.status(401).json({ valid: false, message: "Unauthorized" });
    next();
});

// ── GET /checkpoint?token=XXX ─────────────────────────
app.get("/checkpoint", async (req, res) => {
    const token = req.query.token || "";

    if (!token)
        return res.send(page("error", "Invalid or missing token.", 0, 1, 1));

    const tv = verifyTokens.get(token);

    if (!tv)
        return res.send(page("error", "This link is invalid or does not exist.", 0, 1, 1));

    if (tv.used)
        return res.send(page("error", "This link has already been used.", tv.step - 1, tv.step, 3));

    if (Date.now() - tv.createdAt > CONFIG.VERIFY_TOKEN_TTL) {
        verifyTokens.delete(token);
        return res.send(page("error", "This link has expired. Type ?getkey in Discord to get a new one.", 0, tv.step, 3));
    }

    const found   = getUserKey(tv.userId);
    const pending = pendingUsers.get(tv.userId);

    if (!found)
        return res.send(page("error", "No key found for your account. Type ?getkey first.", 0, tv.step, 3));

    if (!pending)
        return res.send(page("error", "Session expired. Type ?getkey again in Discord.", 0, tv.step, found.data.totalSteps));

    if (tv.step !== pending.currentStep)
        return res.send(page("error", `Wrong step. You need to complete Step ${pending.currentStep} first.`, found.data.stepsCompleted, tv.step, found.data.totalSteps));

    // ✓ Valid — complete this step
    const { key, data } = found;
    tv.used = true;
    verifyTokens.set(token, tv);
    data.stepsCompleted++;
    keys.set(key, data);

    console.log(`[VoidKey] ✓ Step ${data.stepsCompleted}/${data.totalSteps} completed by user ${tv.userId}`);

    // All steps done?
    if (data.stepsCompleted >= data.totalSteps) {
        data.expiresAt = Date.now() + (data.totalSteps * CONFIG.HOURS_PER_STEP * 3600000);
        keys.set(key, data);
        pendingUsers.delete(tv.userId);

        try {
            const user = await client.users.fetch(tv.userId);
            await dmFinalKey(user, key, data.totalSteps);
            console.log(`[VoidKey] 🔑 Key delivered to ${user.tag}: ${key}`);
        } catch (e) {
            console.error("[VoidKey] Could not DM final key:", e.message);
        }

        return res.send(page(
            "complete",
            `All ${data.totalSteps} checkpoints complete! 🎉<br>Your key has been sent to your <strong>Discord DMs</strong>.`,
            data.stepsCompleted, data.stepsCompleted, data.totalSteps
        ));
    }

    // More steps — advance and send next checkpoint
    pending.currentStep++;
    pendingUsers.set(tv.userId, pending);

    try {
        const user = await client.users.fetch(tv.userId);
        await dmCheckpointLink(user, pending.currentStep, data.totalSteps);
    } catch (e) {
        console.error("[VoidKey] Could not DM next checkpoint:", e.message);
    }

    return res.send(page(
        "success",
        `Step ${data.stepsCompleted} complete! ✓<br>Check your <strong>Discord DMs</strong> for the next checkpoint link.`,
        data.stepsCompleted, data.stepsCompleted, data.totalSteps
    ));
});

// ── GET /validate?key=VOID-XXXX ───────────────────────
app.get("/validate", (req, res) => {
    const ip  = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
    const key = (req.query.key || "").toUpperCase().trim();

    if (isBlocked(ip))
        return res.json({ valid: false, message: "Too many failed attempts. Try again later." });

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

    if (data.blocked)
        return res.json({ valid: false, message: "Key has been revoked" });

    if (data.expiresAt === 0)
        return res.json({ valid: false, message: "Key not activated — complete your checkpoints first via ?getkey" });

    if (Date.now() > data.expiresAt)
        return res.json({ valid: false, message: "Key has expired — type ?getkey in Discord for a new one" });

    const timeLeft = msToHuman(data.expiresAt - Date.now());
    console.log(`[VoidKey] ✓ Validated key: ${key} (${timeLeft} remaining)`);

    return res.json({
        valid:      true,
        message:    "Access granted",
        userId:     data.userId,
        expiresIn:  timeLeft,
        expiresAt:  data.expiresAt,
        steps:      data.totalSteps,
    });
});

// ── GET / health check ────────────────────────────────
app.get("/", (req, res) => {
    const active  = [...keys.values()].filter(d => !d.blocked && d.expiresAt > Date.now()).length;
    const pending = pendingUsers.size;
    res.json({ status: "ok", totalKeys: keys.size, activeKeys: active, pendingUsers: pending });
});

// ═══════════════════════════════════════════════════════
//  CHECKPOINT PAGE HTML
// ═══════════════════════════════════════════════════════
function page(state, message, done, current, total) {
    const stepsHtml = Array.from({ length: total }, (_, i) => {
        const n   = i + 1;
        const cls = n < current || (n === current && (state === "success" || state === "complete"))
            ? "done"
            : n === current ? "active"
            : "locked";
        const ico = cls === "done" ? "✓" : n;
        return `
        <div class="step ${cls}">
            <div class="step-circle">${ico}</div>
            <div class="step-label">Step ${n}<br><span>${n * 24}h</span></div>
        </div>
        ${n < total ? '<div class="line"></div>' : ""}`;
    }).join("");

    const stateColor = {
        success:  "#a855f7",
        complete: "#22c55e",
        error:    "#ef4444",
        info:     "#c4b5fd",
    }[state] || "#c4b5fd";

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>VOID — Checkpoint Verification</title>
<style>
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #04030a;
    color: #a89dc0;
    font-family: 'Segoe UI', system-ui, sans-serif;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background-image: radial-gradient(ellipse at 50% 0%, #1a0a3020 0%, transparent 70%);
  }
  .card {
    background: linear-gradient(145deg, #0f0c1c, #080614);
    border: 1px solid #2a1f45;
    border-radius: 24px;
    padding: 48px 40px;
    max-width: 480px;
    width: 92%;
    text-align: center;
    box-shadow: 0 0 100px #6d28d915, 0 0 40px #00000060;
    position: relative;
    overflow: hidden;
  }
  .card::before {
    content: '';
    position: absolute;
    top: 0; left: 10%; right: 10%;
    height: 1px;
    background: linear-gradient(90deg, transparent, #7c3aed60, transparent);
  }
  .logo { font-size: 52px; color: #7c3aed; margin-bottom: 12px; filter: drop-shadow(0 0 16px #7c3aed60); }
  h1 { color: #e2d9f3; font-size: 22px; letter-spacing: 10px; font-weight: 900; margin-bottom: 4px; }
  .sub { color: #3d2f60; font-size: 11px; letter-spacing: 4px; margin-bottom: 40px; text-transform: uppercase; }
  .steps-row {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 40px;
    gap: 0;
  }
  .step { display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .step-circle {
    width: 52px; height: 52px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 18px; font-weight: 800;
    border: 2px solid #1e1535;
    background: #100d1e;
    color: #2e2248;
    transition: all .3s;
  }
  .step.done .step-circle  { background: #2d1a60; border-color: #7c3aed; color: #c4b5fd; box-shadow: 0 0 16px #7c3aed50; }
  .step.active .step-circle { background: #3b1f70; border-color: #a855f7; color: #f3e8ff; box-shadow: 0 0 22px #a855f770; }
  .step-label { font-size: 10px; color: #2e2248; text-align: center; line-height: 1.6; }
  .step-label span { color: #6d28d9; font-weight: bold; }
  .step.done .step-label, .step.active .step-label { color: #8b7aaa; }
  .step.done .step-label span, .step.active .step-label span { color: #a855f7; }
  .line { width: 40px; height: 2px; background: linear-gradient(90deg, #1e1535, #2d1a5040); margin-bottom: 28px; }
  .step.done + .line { background: linear-gradient(90deg, #7c3aed60, #2d1a5040); }
  .msg {
    padding: 18px 22px;
    border-radius: 14px;
    font-size: 13px;
    line-height: 1.7;
    margin-bottom: 28px;
    border: 1px solid ${stateColor}35;
    background: ${stateColor}10;
    color: ${stateColor};
  }
  .btn {
    display: block;
    background: linear-gradient(135deg, #5b21b6, #7c3aed);
    color: #f3e8ff;
    border: none;
    border-radius: 14px;
    padding: 15px 32px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 3px;
    cursor: pointer;
    text-decoration: none;
    transition: all .2s;
    width: 100%;
    text-transform: uppercase;
    box-shadow: 0 4px 24px #7c3aed30;
  }
  .btn:hover { background: linear-gradient(135deg, #6d28d9, #9333ea); box-shadow: 0 4px 32px #a855f750; transform: translateY(-1px); }
  .footer { margin-top: 28px; font-size: 10px; color: #1e1535; letter-spacing: 2px; text-transform: uppercase; }
</style>
</head>
<body>
<div class="card">
  <div class="logo">◈</div>
  <h1>VOID</h1>
  <p class="sub">Checkpoint Verification</p>
  <div class="steps-row">${stepsHtml}</div>
  <div class="msg">${message}</div>
  <a href="javascript:window.close()" class="btn">Close Window</a>
  <p class="footer">VOID Key System &nbsp;·&nbsp; Do not share your links</p>
</div>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════
//  AUTO CLEANUP — runs every hour
//  Removes expired keys, used tokens, old cooldowns
// ═══════════════════════════════════════════════════════
function runCleanup() {
    const now    = Date.now();
    let kRemoved = 0, tRemoved = 0, cRemoved = 0;

    // Remove expired keys (keep revoked ones for admin reference)
    for (const [k, d] of keys.entries()) {
        if (!d.blocked && d.expiresAt > 0 && now > d.expiresAt + 3600000) {
            keys.delete(k);
            kRemoved++;
        }
    }

    // Remove used/expired tokens
    for (const [t, tv] of verifyTokens.entries()) {
        if (tv.used || now - tv.createdAt > CONFIG.VERIFY_TOKEN_TTL * 2) {
            verifyTokens.delete(t);
            tRemoved++;
        }
    }

    // Remove old cooldowns
    for (const [uid, ts] of cooldowns.entries()) {
        if (now - ts > CONFIG.GETKEY_COOLDOWN * 10) {
            cooldowns.delete(uid);
            cRemoved++;
        }
    }

    // Remove expired IP blocks
    for (const [ip, rec] of failLog.entries()) {
        if (rec.blockedUntil && now > rec.blockedUntil + 3600000) {
            failLog.delete(ip);
        }
    }

    // Remove stale pending users (stuck > 2h)
    for (const [uid, p] of pendingUsers.entries()) {
        if (now - p.createdAt > 2 * 3600000) {
            pendingUsers.delete(uid);
        }
    }

    console.log(`[VoidKey] 🧹 Cleanup: removed ${kRemoved} keys, ${tRemoved} tokens, ${cRemoved} cooldowns`);
}

setInterval(runCleanup, CONFIG.CLEANUP_INTERVAL);

// ═══════════════════════════════════════════════════════
//  KEEP-ALIVE — pings self to prevent Render sleep
// ═══════════════════════════════════════════════════════
function keepAlive() {
    const url = CONFIG.BASE_URL;
    if (!url || url.includes("localhost")) return;

    setInterval(() => {
        const lib = url.startsWith("https") ? https : http;
        const req = lib.get(url, (res) => {
            console.log(`[VoidKey] 💓 Keep-alive → ${res.statusCode}`);
        });
        req.on("error", (e) => console.warn("[VoidKey] Keep-alive error:", e.message));
        req.end();
    }, CONFIG.KEEPALIVE_INTERVAL);

    console.log("[VoidKey] 💓 Keep-alive started — pinging every 10 minutes");
}

// ═══════════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════════
app.listen(CONFIG.API_PORT, () => {
    console.log(`[VoidKey] ✓ API listening on port ${CONFIG.API_PORT}`);
});

keepAlive();

process.on("unhandledRejection", (err) => {
    console.error("[VoidKey] Unhandled rejection:", err?.message || err);
});

process.on("uncaughtException", (err) => {
    console.error("[VoidKey] Uncaught exception:", err?.message || err);
});

client.login(CONFIG.TOKEN).catch((err) => {
    console.error("[VoidKey] ✗ LOGIN FAILED:", err.message);
    console.error("[VoidKey] Check BOT_TOKEN in Render Environment tab.");
    process.exit(1);
});
