/**
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║          V O I D   K E Y   S Y S T E M  —  v5.0 ULTIMATE            ║
 * ╠═══════════════════════════════════════════════════════════════════════╣
 * ║  COMPLETE FLOW:                                                      ║
 * ║  1. User types ?getkey in channel                                    ║
 * ║  2. Bot replies "Check your DMs!" → auto-deletes in 2s              ║
 * ║  3. 5-minute cooldown applied to that user                          ║
 * ║  4. User gets DM asking them to wait for admin approval             ║
 * ║  5. Admin sees Approve/Deny card in ADMIN_CHANNEL (or owner DM)     ║
 * ║  6. On approve → user DM gets dropdown: pick 1–10 steps            ║
 * ║  7. Each step = exactly +24h (3 steps = 72h, never multiplied)     ║
 * ║  8. Each step → checkpoint link button in DM                        ║
 * ║  9. Checkpoint page:                                                 ║
 * ║     a) Ad-block detection — must be OFF to proceed                  ║
 * ║     b) Random challenge — answer sent to server, verified there     ║
 * ║        Wrong answer = error shown, can retry, NEVER auto-passes     ║
 * ║     c) Watch N ads (ADS env var) sequentially, max 30s each        ║
 * ║     d) Complete button → server checks challenge.solved flag        ║
 * ║  10. After all steps done → key delivered via DM                    ║
 * ║  11. Key not shown until every single step is complete              ║
 * ╠═══════════════════════════════════════════════════════════════════════╣
 * ║  ENV VARIABLES (Render → Environment tab):                          ║
 * ║  BOT_TOKEN            Your Discord bot token                        ║
 * ║  GUILD_ID             Your server ID                                ║
 * ║  GET_KEY_CHANNEL_ID   Channel where users type ?getkey              ║
 * ║  ADMIN_CHANNEL_ID     Channel for approve/deny cards (optional)     ║
 * ║  KEY_SECRET           Any long random string — signs keys           ║
 * ║  BASE_URL             https://your-service.onrender.com             ║
 * ║  API_SECRET           Optional — required header for /validate      ║
 * ║  ADS                  Ads per checkpoint, default 1, max 5          ║
 * ╠═══════════════════════════════════════════════════════════════════════╣
 * ║  ADMIN COMMANDS:                                                     ║
 * ║  In #get-key:  ?removekey @User                                     ║
 * ║  DM the bot:   !help  !stats  !listkeys  !pending                   ║
 * ║                !approve <id>  !deny <id>  !revoke <key>             ║
 * ║                !reset <id>  !unblock <ip>                           ║
 * ║  Slash:        /removemessage <link>   /rm <link>                   ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 */

"use strict";

// ═══════════════════════════════════════════════════════════════════
//  IMPORTS
// ═══════════════════════════════════════════════════════════════════
const {
    Client, GatewayIntentBits, Partials,
    EmbedBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    SlashCommandBuilder, REST, Routes,
    Events, PermissionFlagsBits,
} = require("discord.js");
const express = require("express");
const crypto  = require("crypto");
const https   = require("https");
const http    = require("http");

// ═══════════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════════
const CFG = {
    TOKEN:           process.env.BOT_TOKEN,
    GUILD_ID:        process.env.GUILD_ID,
    KEY_CHANNEL:     process.env.GET_KEY_CHANNEL_ID,
    ADMIN_CHANNEL:   process.env.ADMIN_CHANNEL_ID   || null,
    KEY_SECRET:      process.env.KEY_SECRET         || "void_change_this_secret",
    API_SECRET:      process.env.API_SECRET         || "",
    PORT:            process.env.PORT               || 3000,
    BASE_URL:        process.env.BASE_URL           || "https://void-r3co.onrender.com",
    ADS:             Math.min(5, Math.max(1, parseInt(process.env.ADS || "1"))),

    // Key shape:  VOID-XXXX-XXXX-XXXX-CHCK
    KEY_PREFIX:      "VOID",
    KEY_SEG_COUNT:   3,
    KEY_SEG_LEN:     4,

    // Times (ms)
    CHANNEL_DELETE:  2_000,          // "Check your DMs" disappears after 2s
    COOLDOWN:        5 * 60_000,     // 5-minute ?getkey cooldown per user
    TOKEN_TTL:       15 * 60_000,    // checkpoint link expires after 15m
    APPROVAL_TTL:    30 * 60_000,    // approval card expires after 30m
    CLEANUP_EVERY:   60 * 60_000,    // run cleanup every hour
    KEEPALIVE_EVERY: 10 * 60_000,    // ping self every 10m to prevent sleep

    // Anti-bot
    MAX_FAILS:       5,
    FAIL_WINDOW:     10 * 60_000,
    BLOCK_DURATION:  60 * 60_000,

    // Per step
    HOURS_PER_STEP:  24,
    MIN_STEPS:       1,
    MAX_STEPS:       10,
};

// ═══════════════════════════════════════════════════════════════════
//  STARTUP CHECKS
// ═══════════════════════════════════════════════════════════════════
console.log("╔══════════════════════════════════════════╗");
console.log("║   VOID KEY SYSTEM  v5.0  STARTING  ◈    ║");
console.log("╚══════════════════════════════════════════╝");
console.log(`  BOT_TOKEN          ${CFG.TOKEN        ? "✓" : "✗ MISSING"}`);
console.log(`  GUILD_ID           ${CFG.GUILD_ID     ? "✓" : "✗ MISSING"}`);
console.log(`  GET_KEY_CHANNEL_ID ${CFG.KEY_CHANNEL  ? "✓" : "✗ MISSING"}`);
console.log(`  ADMIN_CHANNEL_ID   ${CFG.ADMIN_CHANNEL? "✓" : "⚠ optional — using owner DM"}`);
console.log(`  ADS per checkpoint  ${CFG.ADS}`);
console.log(`  BASE_URL           ${CFG.BASE_URL}`);

if (!CFG.TOKEN)       { console.error("\n[VOID] FATAL: BOT_TOKEN is not set. Exiting.\n"); process.exit(1); }
if (!CFG.GUILD_ID)    { console.error("\n[VOID] FATAL: GUILD_ID is not set. Exiting.\n");  process.exit(1); }
if (!CFG.KEY_CHANNEL) { console.error("\n[VOID] FATAL: GET_KEY_CHANNEL_ID is not set. Exiting.\n"); process.exit(1); }

// ═══════════════════════════════════════════════════════════════════
//  IN-MEMORY STORES
// ═══════════════════════════════════════════════════════════════════

/**
 * keys          Map<keyStr, { userId, createdAt, totalSteps, stepsCompleted, expiresAt, blocked }>
 * pending       Map<userId, { totalSteps, currentStep, keyStr, createdAt }>
 * vtokens       Map<token,  { userId, step, createdAt, used }>
 * challenges    Map<token,  { type, question, answer, clientData, solved }>
 * approvals     Map<userId, { createdAt, msgId, chanId }>
 * approvalMsgs  Map<msgId,  userId>
 * cooldowns     Map<userId, timestamp>
 * failLog       Map<ip,     { count, firstFail, blockedUntil }>
 */
const keys         = new Map();
const pending      = new Map();
const vtokens      = new Map();
const challenges   = new Map();
const approvals    = new Map();
const approvalMsgs = new Map();
const cooldowns    = new Map();
const failLog      = new Map();

// ═══════════════════════════════════════════════════════════════════
//  CRYPTO — key generation and HMAC verification
// ═══════════════════════════════════════════════════════════════════
function makeKey() {
    const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const segs = Array.from({ length: CFG.KEY_SEG_COUNT }, () =>
        Array.from({ length: CFG.KEY_SEG_LEN }, () =>
            charset[Math.floor(Math.random() * charset.length)]
        ).join("")
    );
    const raw = `${CFG.KEY_PREFIX}-${segs.join("-")}`;
    const chk = crypto.createHmac("sha256", CFG.KEY_SECRET)
        .update(raw).digest("hex").slice(0, CFG.KEY_SEG_LEN).toUpperCase();
    return `${raw}-${chk}`;
}

function validKeyHmac(key) {
    const parts = key.split("-");
    if (parts.length < CFG.KEY_SEG_COUNT + 2) return false;
    const chk = parts.at(-1);
    const raw = parts.slice(0, -1).join("-");
    const exp = crypto.createHmac("sha256", CFG.KEY_SECRET)
        .update(raw).digest("hex").slice(0, CFG.KEY_SEG_LEN).toUpperCase();
    return chk === exp;
}

function makeToken(userId, step) {
    const t = crypto.randomBytes(32).toString("hex");
    vtokens.set(t, { userId, step, createdAt: Date.now(), used: false });
    return t;
}

// ═══════════════════════════════════════════════════════════════════
//  CHALLENGE GENERATOR
//  Five types: math · color · word · count · sequence
//  Answer is ONLY stored server-side — never sent to the browser
// ═══════════════════════════════════════════════════════════════════
function makeChallenge() {
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const ri   = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

    const type = pick(["math", "color", "word", "count", "sequence"]);

    if (type === "math") {
        const op = pick(["+", "-", "*"]);
        const a  = ri(1, 20), b = ri(1, 12);
        const ans = op === "+" ? a + b : op === "-" ? a - b : a * b;
        return {
            type, answer: String(ans), solved: false,
            question: `What is <strong>${a} ${op} ${b}</strong> ?`,
            clientData: {},
        };
    }

    if (type === "color") {
        const all = ["red","blue","green","yellow","purple","orange","pink","white","cyan","brown"];
        const target = pick(all);
        const opts   = [target];
        while (opts.length < 4) { const c = pick(all); if (!opts.includes(c)) opts.push(c); }
        opts.sort(() => Math.random() - 0.5);
        return {
            type, answer: target, solved: false,
            question: `Click the color: <strong style="color:${target};font-size:20px">${target.toUpperCase()}</strong>`,
            clientData: { opts },
        };
    }

    if (type === "word") {
        const words  = ["VOID","VERIFY","ACCESS","SECURE","TOKEN","SHIELD","VAULT","CIPHER","GHOST","NEXUS"];
        const target = pick(words);
        const jumbled = target.split("").sort(() => Math.random() - 0.5).join("");
        return {
            type, answer: target, solved: false,
            question: `Unscramble this word: <strong style="letter-spacing:4px">${jumbled}</strong>`,
            clientData: {},
        };
    }

    if (type === "count") {
        const emojis = ["⭐","🔵","🟣","🔷","💎","🌀","🔺","🟡"];
        const emoji  = pick(emojis);
        const n      = ri(3, 9);
        return {
            type, answer: String(n), solved: false,
            question: `How many <strong>${emoji}</strong> are there?<br><div style="font-size:22px;letter-spacing:2px;margin-top:8px">${emoji.repeat(n)}</div>`,
            clientData: {},
        };
    }

    // sequence
    const start = ri(1, 8), step = ri(1, 5);
    const seq   = [start, start+step, start+step*2, start+step*3];
    return {
        type, answer: String(start + step * 4), solved: false,
        question: `What comes next?<br><strong style="font-size:18px;letter-spacing:3px">${seq.join("  ,  ")}  ,  ?</strong>`,
        clientData: {},
    };
}

// ═══════════════════════════════════════════════════════════════════
//  UTILITY
// ═══════════════════════════════════════════════════════════════════
const fmt = (ms) => {
    if (ms <= 0) return "expired";
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return h ? `${h}h ${m}m` : `${m}m`;
};

const bar = (done, total) =>
    Array.from({ length: total }, (_, i) => i < done ? "🟣" : "⚫").join(" ") + `  (${done}/${total})`;

const getUserKey = (userId) => {
    for (const [k, d] of keys) if (d.userId === userId && !d.blocked) return { key: k, data: d };
    return null;
};

const onCooldown  = (uid) => { const t = cooldowns.get(uid); return t && Date.now() - t < CFG.COOLDOWN; };
const cdRemaining = (uid) => { const t = cooldowns.get(uid); return t ? Math.max(0, CFG.COOLDOWN - (Date.now() - t)) : 0; };
const setCooldown = (uid) => cooldowns.set(uid, Date.now());

const recordFail = (ip) => {
    const now = Date.now();
    const r   = failLog.get(ip) || { count: 0, firstFail: now, blockedUntil: 0 };
    if (now - r.firstFail > CFG.FAIL_WINDOW) { r.count = 0; r.firstFail = now; }
    r.count++;
    if (r.count >= CFG.MAX_FAILS) r.blockedUntil = now + CFG.BLOCK_DURATION;
    failLog.set(ip, r);
};
const ipBlocked = (ip) => { const r = failLog.get(ip); return !!(r?.blockedUntil && Date.now() < r.blockedUntil); };

const parseMsgLink = (link) => {
    const m = link.match(/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
    return m ? { guildId: m[1], channelId: m[2], messageId: m[3] } : null;
};

const autoDelete = (msg, ms) => setTimeout(() => msg.delete().catch(() => {}), ms);

// ═══════════════════════════════════════════════════════════════════
//  EMBED BUILDERS
// ═══════════════════════════════════════════════════════════════════
const PURPLE = 0x6d28d9;
const GREEN  = 0x22c55e;
const RED    = 0xef4444;
const YELLOW = 0xf59e0b;

function makeStepSelector(user) {
    const opts = Array.from({ length: CFG.MAX_STEPS }, (_, i) => {
        const n = i + 1;
        const h = n * CFG.HOURS_PER_STEP;
        const label = h >= 24
            ? `${n} Step${n>1?"s":""} — ${Math.floor(h/24)}d ${h%24>0?h%24+"h":""}`.trim()
            : `${n} Step — ${h}h`;
        return new StringSelectMenuOptionBuilder()
            .setLabel(label.replace("0h","").trim())
            .setDescription(`Complete ${n} checkpoint${n>1?"s":""} → ${h}h access`)
            .setValue(`${n}`)
            .setEmoji(["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"][i]);
    });

    const embed = new EmbedBuilder()
        .setColor(PURPLE)
        .setTitle("◈  VOID — Choose Your Verification Steps")
        .setDescription(
            "✅ Your request was **approved**.\n\n" +
            "Select how many verification steps to complete.\n" +
            "Every step **adds** `+24h` to your key. Steps never multiply.\n\n" +
            "> 1 step = 24h &nbsp;|&nbsp; 5 steps = 120h &nbsp;|&nbsp; 10 steps = 240h"
        )
        .addFields({
            name:  "⚡ Each Checkpoint Requires",
            value: `• Disable ad blocker\n• Complete a random challenge *(server-verified)*\n• Watch **${CFG.ADS}** ad${CFG.ADS>1?"s":""} (up to 30s each)`,
        })
        .setFooter({ text: "VOID Key System · Steps 1–10" })
        .setTimestamp();

    const menu = new StringSelectMenuBuilder()
        .setCustomId(`stepsel_${user.id}`)
        .setPlaceholder("🔑  Select number of steps…")
        .addOptions(opts);

    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

function makeCheckpointDM(user, step, totalSteps) {
    const token     = makeToken(user.id, step);
    const link      = `${CFG.BASE_URL}/checkpoint?token=${token}`;
    const hoursLeft = (totalSteps - step + 1) * CFG.HOURS_PER_STEP;

    const embed = new EmbedBuilder()
        .setColor(PURPLE)
        .setTitle(`◈  Checkpoint ${step} / ${totalSteps}`)
        .setDescription(`Complete this checkpoint to unlock **+${CFG.HOURS_PER_STEP}h** of access.`)
        .addFields(
            { name: "📍 Progress",     value: bar(step - 1, totalSteps) },
            { name: "⏱ Link Expires",  value: "**15 minutes**",                         inline: true },
            { name: "🎁 After This",   value: `**${step * CFG.HOURS_PER_STEP}h** total`, inline: true },
            {
                name:  "📋 Steps",
                value: `1. Click the button below\n2. Disable any ad blocker\n3. Solve the challenge\n4. Watch ${CFG.ADS} ad${CFG.ADS>1?"s":""}\n5. Hit Complete`,
            },
            { name: "⚠️ Warning", value: "**Do not share this link.** One-time use, tied to your account." }
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

    return { embeds: [embed], components: [row] };
}

function makeFinalKeyDM(key, totalSteps) {
    const totalHours = totalSteps * CFG.HOURS_PER_STEP;
    return {
        embeds: [new EmbedBuilder()
            .setColor(GREEN)
            .setTitle("◈  All Steps Complete! 🎉")
            .setDescription(`You completed all **${totalSteps}** step${totalSteps>1?"s":""}!\n**${totalSteps} × 24h = ${totalHours}h** of access.`)
            .addFields(
                { name: "🔑 License Key",  value: `\`\`\`${key}\`\`\`` },
                { name: "📍 Progress",     value: bar(totalSteps, totalSteps) },
                { name: "⏳ Valid For",     value: `**${totalHours} hours**`,          inline: true },
                { name: "✅ Steps",         value: `**${totalSteps}/${CFG.MAX_STEPS}**`, inline: true },
                { name: "⚠️ Warning",       value: "**Never share this key.** It is permanently tied to your Discord account." }
            )
            .setFooter({ text: "VOID Key System · Keep this safe" })
            .setTimestamp()
        ]
    };
}

// ═══════════════════════════════════════════════════════════════════
//  APPROVAL CARD
// ═══════════════════════════════════════════════════════════════════
async function sendApprovalCard(guild, reqUser) {
    const embed = new EmbedBuilder()
        .setColor(YELLOW)
        .setTitle("◈  Key Request — Needs Approval")
        .addFields(
            { name: "👤 User",    value: reqUser.tag,             inline: true },
            { name: "🆔 ID",      value: `\`${reqUser.id}\``,     inline: true },
            { name: "📋 Status",  value: "⏳ Awaiting your decision" },
            { name: "⏱ Expires", value: "Request expires in **30 minutes**" }
        )
        .setThumbnail(reqUser.displayAvatarURL())
        .setFooter({ text: "Click Approve or Deny below" })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`appr_${reqUser.id}`).setLabel("  Approve").setStyle(ButtonStyle.Success).setEmoji("✅"),
        new ButtonBuilder().setCustomId(`deny_${reqUser.id}`).setLabel("  Deny").setStyle(ButtonStyle.Danger).setEmoji("❌"),
    );

    let sent = null;

    if (CFG.ADMIN_CHANNEL) {
        try {
            const ch = await guild.channels.fetch(CFG.ADMIN_CHANNEL);
            if (ch) sent = await ch.send({ embeds: [embed], components: [row] });
        } catch {}
    }

    if (!sent) {
        try {
            const owner = await guild.fetchOwner();
            sent = await owner.send({ embeds: [embed], components: [row] });
        } catch (e) { console.error("[VOID] Could not reach admin:", e.message); }
    }

    if (sent) {
        approvals.set(reqUser.id, { createdAt: Date.now(), msgId: sent.id, chanId: sent.channelId });
        approvalMsgs.set(sent.id, reqUser.id);
    }
}

// ═══════════════════════════════════════════════════════════════════
//  DISCORD CLIENT
// ═══════════════════════════════════════════════════════════════════
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message],
});

client.once("ready", async () => {
    console.log(`\n[VOID] ✓ Online as ${client.user.tag}`);
    client.user.setActivity("?getkey", { type: 3 });
    await registerSlashCmds();
});

client.on("error", (e) => console.error("[VOID] Discord error:", e.message));

// ═══════════════════════════════════════════════════════════════════
//  SLASH COMMANDS
// ═══════════════════════════════════════════════════════════════════
async function registerSlashCmds() {
    const linkOption = (b) => b.addStringOption((o) =>
        o.setName("link").setDescription("Full Discord message link").setRequired(true));

    const cmds = [
        linkOption(new SlashCommandBuilder().setName("removemessage").setDescription("Delete a message by link").setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)).toJSON(),
        linkOption(new SlashCommandBuilder().setName("rm").setDescription("Delete a message by link (alias)").setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)).toJSON(),
    ];

    try {
        const rest = new REST({ version: "10" }).setToken(CFG.TOKEN);
        await rest.put(Routes.applicationGuildCommands(client.user.id, CFG.GUILD_ID), { body: cmds });
        console.log("[VOID] ✓ Slash commands registered: /removemessage /rm");
    } catch (e) {
        console.error("[VOID] Slash register failed:", e.message);
    }
}

// ═══════════════════════════════════════════════════════════════════
//  ?getkey + ?removekey   (in GET_KEY_CHANNEL only)
// ═══════════════════════════════════════════════════════════════════
client.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;
    if (msg.channelId !== CFG.KEY_CHANNEL) return;

    const raw = msg.content.trim().toLowerCase();

    // ── ?removekey @User ───────────────────────────────────────────
    if (raw.startsWith("?removekey")) {
        try { await msg.delete(); } catch {}

        const guild = await client.guilds.fetch(CFG.GUILD_ID).catch(() => null);
        if (!guild || msg.author.id !== guild.ownerId) {
            const w = await msg.channel.send(`<@${msg.author.id}> ❌ Only the server owner can use \`?removekey\`.`);
            autoDelete(w, 4000); return;
        }

        const target = msg.mentions.users.first();
        if (!target) {
            const w = await msg.channel.send("❌ Usage: `?removekey @User`");
            autoDelete(w, 5000); return;
        }

        let removed = 0;
        for (const [k, d] of keys) { if (d.userId === target.id) { keys.delete(k); removed++; } }
        pending.delete(target.id);
        cooldowns.delete(target.id);
        approvals.delete(target.id);

        const w = await msg.channel.send(
            removed > 0
                ? `✓  Removed **${removed}** key(s) for <@${target.id}>.`
                : `❌  No keys found for <@${target.id}>.`
        );
        autoDelete(w, 5000);

        if (removed > 0) {
            try {
                await target.send({ embeds: [new EmbedBuilder()
                    .setColor(RED).setTitle("◈  Key Removed")
                    .setDescription("Your key was removed by the server owner.\nType `?getkey` to request a new one.")
                    .setTimestamp()
                ]});
            } catch {}
        }
        return;
    }

    // ── ?getkey ────────────────────────────────────────────────────
    if (raw !== "?getkey") return;
    try { await msg.delete(); } catch {}

    const user  = msg.author;

    // Already has active key
    const found = getUserKey(user.id);
    if (found && found.data.expiresAt > Date.now()) {
        const w = await msg.channel.send(`<@${user.id}> ✓ Check your DMs!`);
        autoDelete(w, CFG.CHANNEL_DELETE);
        try {
            await user.send({ embeds: [new EmbedBuilder()
                .setColor(PURPLE).setTitle("◈  You Have an Active Key")
                .addFields(
                    { name: "🔑 Key",     value: `\`\`\`${found.key}\`\`\`` },
                    { name: "⏳ Expires", value: `in **${fmt(found.data.expiresAt - Date.now())}**` }
                )
                .setFooter({ text: "Do not share your key." }).setTimestamp()
            ]});
        } catch {}
        return;
    }

    // Cooldown active
    if (onCooldown(user.id)) {
        const w = await msg.channel.send(`<@${user.id}> ⏱ Cooldown — try again in **${fmt(cdRemaining(user.id))}**.`);
        autoDelete(w, CFG.CHANNEL_DELETE); return;
    }
    setCooldown(user.id);

    // Already queued for approval
    if (approvals.has(user.id)) {
        const w = await msg.channel.send(`<@${user.id}> ⏳ Your request is already pending approval.`);
        autoDelete(w, CFG.CHANNEL_DELETE); return;
    }

    // Mid-verification — resend current checkpoint
    if (pending.has(user.id)) {
        const w = await msg.channel.send(`<@${user.id}> ✓ Check your DMs!`);
        autoDelete(w, CFG.CHANNEL_DELETE);
        const p = pending.get(user.id);
        try { await user.send(makeCheckpointDM(user, p.currentStep, p.totalSteps)); } catch {}
        return;
    }

    // Queue for admin approval
    try {
        const w = await msg.channel.send(`<@${user.id}> ✓ Check your DMs!`);
        autoDelete(w, CFG.CHANNEL_DELETE);

        const guild = await client.guilds.fetch(CFG.GUILD_ID);
        await sendApprovalCard(guild, user);

        await user.send({ embeds: [new EmbedBuilder()
            .setColor(YELLOW).setTitle("◈  Request Submitted")
            .setDescription(
                "Your request is waiting for **admin approval**.\n" +
                "You'll receive a DM once reviewed.\n\n" +
                `⏱ A **5-minute cooldown** is now active on \`?getkey\`.`
            )
            .setFooter({ text: "VOID Key System · Please wait" }).setTimestamp()
        ]});

        console.log(`[VOID] Request queued: ${user.tag} (${user.id})`);
    } catch (e) {
        console.error("[VOID] getkey error:", e.message);
    }
});

// ═══════════════════════════════════════════════════════════════════
//  INTERACTION HANDLER
//  Handles: /removemessage, /rm, approve/deny buttons, step dropdown
// ═══════════════════════════════════════════════════════════════════
client.on(Events.InteractionCreate, async (interaction) => {

    // ── /removemessage  /rm ────────────────────────────────────────
    if (interaction.isChatInputCommand() &&
        (interaction.commandName === "removemessage" || interaction.commandName === "rm")) {
        await interaction.deferReply({ ephemeral: true });
        const parsed = parseMsgLink(interaction.options.getString("link") || "");
        if (!parsed)                          return interaction.editReply("❌ Invalid message link.");
        if (parsed.guildId !== CFG.GUILD_ID)  return interaction.editReply("❌ Message not from this server.");
        try {
            const ch  = await client.channels.fetch(parsed.channelId);
            const m   = await ch.messages.fetch(parsed.messageId);
            await m.delete();
            console.log(`[VOID] Deleted msg ${parsed.messageId} by ${interaction.user.tag}`);
            return interaction.editReply("✓ Message deleted.");
        } catch (e) {
            return interaction.editReply(`❌ Failed: ${e.message}`);
        }
    }

    // ── Approve / Deny buttons ─────────────────────────────────────
    if (interaction.isButton()) {
        const id = interaction.customId;
        if (!id.startsWith("appr_") && !id.startsWith("deny_")) return;

        const targetId  = id.replace("appr_","").replace("deny_","");
        const isApprove = id.startsWith("appr_");

        // Update the card
        try {
            const updEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(isApprove ? GREEN : RED)
                .spliceFields(2, 1, {
                    name:  "📋 Status",
                    value: isApprove
                        ? `✅ Approved by **${interaction.user.tag}**`
                        : `❌ Denied by **${interaction.user.tag}**`,
                });
            await interaction.update({ embeds: [updEmbed], components: [] });
        } catch {}

        approvals.delete(targetId);
        approvalMsgs.delete(interaction.message.id);

        let target = null;
        try { target = await client.users.fetch(targetId); } catch {}
        if (!target) return;

        if (isApprove) {
            console.log(`[VOID] ✅ Approved: ${target.tag}`);
            try { await target.send(makeStepSelector(target)); }
            catch (e) { console.error("[VOID] Step selector DM failed:", e.message); }
        } else {
            console.log(`[VOID] ❌ Denied: ${target.tag}`);
            try {
                await target.send({ embeds: [new EmbedBuilder()
                    .setColor(RED).setTitle("◈  Request Denied")
                    .setDescription("Your key request was **denied** by an admin.\nContact a server admin if you think this is a mistake.")
                    .setTimestamp()
                ]});
            } catch {}
        }
        return;
    }

    // ── Step selector dropdown ─────────────────────────────────────
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("stepsel_")) {
        const uid = interaction.customId.replace("stepsel_", "");
        if (interaction.user.id !== uid)
            return interaction.reply({ content: "❌ This menu is not for you.", ephemeral: true });

        const steps = parseInt(interaction.values[0]);
        const hours = steps * CFG.HOURS_PER_STEP;

        await interaction.update({
            embeds: [new EmbedBuilder()
                .setColor(PURPLE).setTitle("◈  Steps Locked In")
                .setDescription(
                    `You chose **${steps} step${steps>1?"s":""}** → **${steps} × 24h = ${hours}h** access.\n\n` +
                    `Complete all ${steps} checkpoint${steps>1?"s":""} and your key will be sent automatically.`
                )
                .setFooter({ text: "Do not share your checkpoint links." }).setTimestamp()
            ],
            components: [],
        });

        const newKey = makeKey();
        keys.set(newKey, {
            userId:         interaction.user.id,
            createdAt:      Date.now(),
            totalSteps:     steps,
            stepsCompleted: 0,
            expiresAt:      0,
            blocked:        false,
        });
        pending.set(interaction.user.id, {
            totalSteps:  steps,
            currentStep: 1,
            keyStr:      newKey,
            createdAt:   Date.now(),
        });

        console.log(`[VOID] ${interaction.user.tag} → ${steps} steps, key: ${newKey}`);

        try { await interaction.user.send(makeCheckpointDM(interaction.user, 1, steps)); }
        catch (e) { console.error("[VOID] Checkpoint DM error:", e.message); }
    }
});

// ═══════════════════════════════════════════════════════════════════
//  ADMIN DM COMMANDS  (server owner only — via DM to bot)
// ═══════════════════════════════════════════════════════════════════
client.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;
    if (msg.channel.type !== 1) return; // DMs only

    const guild = await client.guilds.fetch(CFG.GUILD_ID).catch(() => null);
    if (!guild || msg.author.id !== guild.ownerId) return;

    const args = msg.content.trim().split(/\s+/);
    const cmd  = args[0]?.toLowerCase();

    switch (cmd) {

        case "!help":
            return msg.reply(
                "```\n" +
                "VOID KEY SYSTEM — ADMIN COMMANDS\n" +
                "══════════════════════════════════\n\n" +
                "IN #get-key CHANNEL:\n" +
                "  ?getkey                — Request a key (all users)\n" +
                "  ?removekey @User       — Remove a user's key (owner only)\n\n" +
                "DM TO BOT (owner only):\n" +
                "  !help                  — This menu\n" +
                "  !stats                 — Key & system statistics\n" +
                "  !listkeys              — All keys with status\n" +
                "  !pending               — Pending approval requests\n" +
                "  !approve <userId>      — Manually approve a user\n" +
                "  !deny <userId>         — Manually deny a user\n" +
                "  !revoke <key>          — Permanently revoke a key\n" +
                "  !reset <userId>        — Wipe all data for a user\n" +
                "  !unblock <ip>          — Unblock a rate-limited IP\n\n" +
                "SLASH COMMANDS (in server):\n" +
                "  /removemessage <link>  — Delete message by link\n" +
                "  /rm <link>             — Same, shorter alias\n" +
                "```"
            );

        case "!stats": {
            const all     = [...keys.values()];
            const active  = all.filter(d => !d.blocked && d.expiresAt > Date.now()).length;
            const pend    = all.filter(d => d.expiresAt === 0 && !d.blocked).length;
            const expired = all.filter(d => d.expiresAt > 0 && Date.now() > d.expiresAt).length;
            const revoked = all.filter(d => d.blocked).length;
            return msg.reply(
                "```\nVOID SYSTEM STATS\n══════════════════\n" +
                `Total keys       : ${keys.size}\n` +
                `Active           : ${active}\n` +
                `Awaiting steps   : ${pend}\n` +
                `Expired          : ${expired}\n` +
                `Revoked          : ${revoked}\n` +
                `Pending approval : ${approvals.size}\n` +
                `In verification  : ${pending.size}\n` +
                "```"
            );
        }

        case "!listkeys": {
            if (!keys.size) return msg.reply("No keys stored.");
            let out = `**Keys (${keys.size} total):**\n`;
            for (const [k, d] of keys) {
                const st =
                    d.blocked          ? "🚫 revoked"
                    : d.expiresAt === 0 ? `⏸ pending (${d.stepsCompleted}/${d.totalSteps} steps)`
                    : Date.now() > d.expiresAt ? "💀 expired"
                    : `✓ ${fmt(d.expiresAt - Date.now())} left`;
                out += `\`${k}\` <@${d.userId}> [${st}]\n`;
            }
            for (const chunk of out.match(/[\s\S]{1,1900}/g) || []) await msg.reply(chunk);
            return;
        }

        case "!pending": {
            if (!approvals.size) return msg.reply("No pending requests.");
            let out = `**Pending (${approvals.size}):**\n`;
            for (const [uid, d] of approvals)
                out += `<@${uid}> \`${uid}\` — waiting **${fmt(Date.now() - d.createdAt)}**\n`;
            return msg.reply(out.slice(0, 2000));
        }

        case "!approve": {
            if (!args[1]) return msg.reply("Usage: `!approve <userId>`");
            const uid = args[1];
            if (!approvals.has(uid)) return msg.reply(`❌ No pending request for \`${uid}\``);
            approvals.delete(uid);
            try {
                const u = await client.users.fetch(uid);
                await u.send(makeStepSelector(u));
                return msg.reply(`✓ Approved <@${uid}>`);
            } catch { return msg.reply("❌ Could not find or DM that user."); }
        }

        case "!deny": {
            if (!args[1]) return msg.reply("Usage: `!deny <userId>`");
            const uid = args[1];
            approvals.delete(uid);
            try {
                const u = await client.users.fetch(uid);
                await u.send({ embeds: [new EmbedBuilder()
                    .setColor(RED).setTitle("◈  Request Denied")
                    .setDescription("Your key request was denied by an admin.").setTimestamp()
                ]});
            } catch {}
            return msg.reply(`✓ Denied \`${args[1]}\``);
        }

        case "!revoke": {
            if (!args[1]) return msg.reply("Usage: `!revoke <key>`");
            const key  = args[1].toUpperCase();
            const data = keys.get(key);
            if (!data) return msg.reply(`❌ Key not found: \`${key}\``);
            data.blocked = true;
            keys.set(key, data);
            console.log(`[VOID] Key revoked: ${key}`);
            return msg.reply(`✓ Revoked: \`${key}\``);
        }

        case "!reset": {
            if (!args[1]) return msg.reply("Usage: `!reset <userId>`");
            const uid = args[1]; let r = 0;
            for (const [k, d] of keys) { if (d.userId === uid) { keys.delete(k); r++; } }
            pending.delete(uid); cooldowns.delete(uid); approvals.delete(uid);
            console.log(`[VOID] Reset user ${uid} — removed ${r} key(s)`);
            return msg.reply(`✓ Reset <@${uid}> — removed ${r} key(s).`);
        }

        case "!unblock": {
            if (!args[1]) return msg.reply("Usage: `!unblock <ip>`");
            failLog.delete(args[1]);
            return msg.reply(`✓ Unblocked: \`${args[1]}\``);
        }

        default:
            return msg.reply("❓ Unknown command. Type `!help` to see all commands.");
    }
});

// ═══════════════════════════════════════════════════════════════════
//  EXPRESS API
// ═══════════════════════════════════════════════════════════════════
const app = express();
app.use(express.json());

// Fake ads.js — ad blockers will block this path → detection works
app.get("/ads/ads.js", (_req, res) => {
    res.setHeader("Content-Type", "application/javascript");
    res.send("window.__adBlockOff=true;");
});

// Optional API key auth
app.use((req, res, next) => {
    if (req.path.startsWith("/ads/")) return next();
    if (CFG.API_SECRET && req.headers["x-api-key"] !== CFG.API_SECRET)
        return res.status(401).json({ valid: false, message: "Unauthorized" });
    next();
});

// ── GET /checkpoint?token=XXX ──────────────────────────────────────
app.get("/checkpoint", async (req, res) => {
    const token = req.query.token || "";

    const fail = (msg, done=0, cur=1, tot=1) =>
        res.send(buildPage({ state:"error", msg, done, cur, tot, token }));

    if (!token) return fail("Missing token.");

    const tv = vtokens.get(token);
    if (!tv)      return fail("This link is invalid or doesn't exist.");
    if (tv.used)  return fail("This link was already used.", tv.step-1, tv.step, 3);

    if (Date.now() - tv.createdAt > CFG.TOKEN_TTL) {
        vtokens.delete(token);
        return fail("This link expired. Type ?getkey in Discord for a new one.");
    }

    const found = getUserKey(tv.userId);
    const pend  = pending.get(tv.userId);

    if (!found)  return fail("No key found for your account. Type ?getkey first.");
    if (!pend)   return fail("Session expired. Type ?getkey again.", 0, tv.step, found.data.totalSteps);
    if (tv.step !== pend.currentStep)
        return fail(`Wrong step. Complete Step ${pend.currentStep} first.`, found.data.stepsCompleted, tv.step, found.data.totalSteps);

    // Valid — serve interactive page
    return res.send(buildPage({
        state:    "verify",
        msg:      "",
        done:     found.data.stepsCompleted,
        cur:      tv.step,
        tot:      found.data.totalSteps,
        token,
    }));
});

// ── GET /challenge?token=XXX — generate and return challenge ───────
app.get("/challenge", (req, res) => {
    const token = req.query.token || "";
    const tv    = vtokens.get(token);
    if (!tv || tv.used) return res.json({ ok: false, msg: "Invalid token" });

    const ch = makeChallenge();
    challenges.set(token, ch);
    // NEVER send the answer to the client
    res.json({ ok: true, type: ch.type, question: ch.question, data: ch.clientData });
});

// ── POST /challenge/verify — real server-side answer check ─────────
app.post("/challenge/verify", (req, res) => {
    const { token, answer } = req.body || {};
    if (!token) return res.json({ ok: false, msg: "Missing token" });

    const tv = vtokens.get(token);
    if (!tv || tv.used) return res.json({ ok: false, msg: "Invalid token" });

    const ch = challenges.get(token);
    if (!ch) return res.json({ ok: false, msg: "No challenge found — reload the page" });

    const correct =
        String(answer || "").trim().toLowerCase() ===
        String(ch.answer).trim().toLowerCase();

    if (!correct) {
        // Generate a fresh challenge so they can't brute-force by replaying
        const newCh = makeChallenge();
        challenges.set(token, newCh);
        return res.json({
            ok:       false,
            msg:      "Wrong answer — try again",
            newQuestion: newCh.question,
            newType:     newCh.type,
            newData:     newCh.clientData,
        });
    }

    ch.solved = true;
    challenges.set(token, ch);
    return res.json({ ok: true, msg: "Correct!" });
});

// ── POST /checkpoint/complete — called after all checks pass ───────
app.post("/checkpoint/complete", async (req, res) => {
    const { token } = req.body || {};
    if (!token) return res.json({ ok: false, msg: "Missing token" });

    const tv = vtokens.get(token);
    if (!tv || tv.used) return res.json({ ok: false, msg: "Invalid or already-used token" });
    if (Date.now() - tv.createdAt > CFG.TOKEN_TTL) {
        vtokens.delete(token);
        return res.json({ ok: false, msg: "Token expired" });
    }

    // MUST have solved challenge via /challenge/verify
    const ch = challenges.get(token);
    if (!ch)         return res.json({ ok: false, msg: "No challenge on record — reload the page" });
    if (!ch.solved)  return res.json({ ok: false, msg: "Challenge not verified — complete the challenge first" });

    const found = getUserKey(tv.userId);
    const pend  = pending.get(tv.userId);

    if (!found || !pend) return res.json({ ok: false, msg: "Session lost — type ?getkey again" });
    if (tv.step !== pend.currentStep) return res.json({ ok: false, msg: "Wrong step" });

    // Mark used + advance
    tv.used = true;
    vtokens.set(token, tv);
    challenges.delete(token);

    const { key, data } = found;
    data.stepsCompleted++;
    keys.set(key, data);

    console.log(`[VOID] ✓ Step ${data.stepsCompleted}/${data.totalSteps} for ${tv.userId}`);

    // All steps done — activate key and DM user
    if (data.stepsCompleted >= data.totalSteps) {
        data.expiresAt = Date.now() + data.totalSteps * CFG.HOURS_PER_STEP * 3_600_000;
        keys.set(key, data);
        pending.delete(tv.userId);

        try {
            const user = await client.users.fetch(tv.userId);
            await user.send(makeFinalKeyDM(key, data.totalSteps));
            console.log(`[VOID] 🔑 Key sent to ${user.tag}: ${key}`);
        } catch (e) { console.error("[VOID] Final key DM error:", e.message); }

        return res.json({
            ok: true, done: true,
            msg: `All ${data.totalSteps} steps complete! 🎉 Your key has been sent to your Discord DMs.`,
        });
    }

    // More steps — send next checkpoint link
    pend.currentStep++;
    pending.set(tv.userId, pend);

    try {
        const user = await client.users.fetch(tv.userId);
        await user.send(makeCheckpointDM(user, pend.currentStep, data.totalSteps));
    } catch (e) { console.error("[VOID] Next checkpoint DM error:", e.message); }

    return res.json({
        ok: true, done: false,
        msg: `Step ${data.stepsCompleted} complete ✓ Check your Discord DMs for the next checkpoint.`,
    });
});

// ── GET /validate?key=VOID-XXXX ────────────────────────────────────
app.get("/validate", (req, res) => {
    const ip  = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?").split(",")[0].trim();
    const key = (req.query.key || "").toUpperCase().trim();

    if (ipBlocked(ip))        return res.json({ valid: false, message: "Rate limited — too many failed attempts" });
    if (!key)                 { recordFail(ip); return res.json({ valid: false, message: "No key provided" }); }
    if (!validKeyHmac(key))   { recordFail(ip); return res.json({ valid: false, message: "Invalid key format" }); }

    const data = keys.get(key);
    if (!data)                { recordFail(ip); return res.json({ valid: false, message: "Key not found" }); }
    if (data.blocked)         return res.json({ valid: false, message: "Key has been revoked" });
    if (data.expiresAt === 0) return res.json({ valid: false, message: "Key not activated — complete your checkpoints first" });
    if (Date.now() > data.expiresAt) return res.json({ valid: false, message: "Key expired — type ?getkey in Discord" });

    const timeLeft = fmt(data.expiresAt - Date.now());
    console.log(`[VOID] ✓ Validated: ${key} (${timeLeft} left)`);
    return res.json({ valid: true, message: "Access granted", userId: data.userId, expiresIn: timeLeft, expiresAt: data.expiresAt, steps: data.totalSteps });
});

// ── GET /  health ──────────────────────────────────────────────────
app.get("/", (_req, res) => {
    res.json({
        status:    "ok",
        totalKeys: keys.size,
        active:    [...keys.values()].filter(d => !d.blocked && d.expiresAt > Date.now()).length,
        pending:   approvals.size,
    });
});

// ═══════════════════════════════════════════════════════════════════
//  CHECKPOINT PAGE
//  Three stages executed in sequence:
//  Stage 1 — Ad-block detection + Challenge  (server-verified)
//  Stage 2 — Watch ads  (N ads, 10-30s each, skip after 5s)
//  Stage 3 — Confirm    (POST /checkpoint/complete)
// ═══════════════════════════════════════════════════════════════════
function buildPage({ state, msg, done, cur, tot, token }) {

    // Step progress circles
    const circles = Array.from({ length: tot }, (_, i) => {
        const n   = i + 1;
        const cls = n < cur || (n === cur && (state==="success"||state==="complete")) ? "done"
                  : n === cur ? "active" : "locked";
        return `
        <div class="step ${cls}">
          <div class="sc">${cls==="done"?"✓":n}</div>
          <div class="sl">Step ${n}<br><span>${n*24}h</span></div>
        </div>${n<tot?'<div class="ln"></div>':""}`;
    }).join("");

    // Error / complete states — static page
    if (state !== "verify") {
        const col = state==="complete" ? "#22c55e" : state==="success" ? "#a855f7" : "#ef4444";
        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VOID — Checkpoint</title><style>${css()}</style></head><body>
<div class="card">
  <div class="logo">◈</div><h1>VOID</h1>
  <p class="sub">CHECKPOINT ${cur} / ${tot}</p>
  <div class="steps">${circles}</div>
  <div class="msg" style="color:${col};border-color:${col}28;background:${col}0c">${msg}</div>
  <a href="javascript:window.close()" class="btn">Close Window</a>
  <p class="footer">VOID KEY SYSTEM &nbsp;·&nbsp; DO NOT SHARE YOUR LINKS</p>
</div></body></html>`;
    }

    // Interactive verification page
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VOID — Checkpoint ${cur}/${tot}</title>
<style>
${css()}
.stage{display:none}.stage.on{display:block}
.box{background:#08061a;border:1px solid #2a1f45;border-radius:14px;padding:22px;margin:14px 0}
.lbl{color:#3d2f60;font-size:9px;letter-spacing:3px;text-transform:uppercase;margin-bottom:10px}
.qtext{color:#c4b5fd;font-size:14px;line-height:1.7;margin-bottom:16px}
.inp{width:100%;background:#0f0c1e;border:1px solid #2a1f45;border-radius:9px;
     color:#e2d9f3;padding:10px 14px;font-size:14px;outline:none;transition:.2s}
.inp:focus{border-color:#7c3aed}
.cbts{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.cbt{padding:9px 18px;border-radius:8px;border:1px solid #2a1f45;background:#0f0c1e;
     color:#a89dc0;cursor:pointer;font-size:12px;font-weight:bold;transition:.2s}
.cbt:hover{border-color:#7c3aed;color:#c4b5fd}
.cbt.sel{border-color:#a855f7;background:#2d1a60;color:#f3e8ff}
.ok{color:#22c55e;font-size:12px;margin-top:8px}
.err{color:#ef4444;font-size:12px;margin-top:8px}
.inf{color:#a855f7;font-size:12px;margin-top:8px}
.adscreen{width:100%;height:160px;background:#000;border-radius:10px;display:flex;
          align-items:center;justify-content:center;flex-direction:column;gap:8px;
          margin-bottom:12px;border:1px solid #1a1030;position:relative;overflow:hidden}
.adtimer{position:absolute;top:8px;right:10px;background:#00000090;color:#fff;
         font-size:11px;padding:3px 8px;border-radius:6px;font-weight:bold}
.adtrack{width:100%;height:3px;background:#1a1030;border-radius:2px;margin:8px 0;overflow:hidden}
.adfill{height:100%;background:linear-gradient(90deg,#7c3aed,#a855f7);transition:width .5s linear}
.skipbtn{background:#1a1030;border:1px solid #2a1f45;color:#5a4870;padding:8px 20px;
         border-radius:8px;font-size:11px;cursor:default;transition:.25s;margin-top:8px}
.skipbtn.rdy{background:#5b21b6;border-color:#7c3aed;color:#f3e8ff;cursor:pointer}
.skipbtn.rdy:hover{background:#7c3aed}
.adblock{background:#2a0f14;border:1px solid #7f1d1d;border-radius:12px;padding:16px 18px;
         color:#f87171;font-size:13px;line-height:1.7;margin-bottom:14px;display:none}
</style>
</head>
<body>
<div class="card" style="max-width:500px">
  <div class="logo">◈</div>
  <h1>VOID</h1>
  <p class="sub">CHECKPOINT ${cur} / ${tot}</p>
  <div class="steps">${circles}</div>

  <!-- Ad-blocker warning -->
  <div class="adblock" id="abWarn">
    🚫 <strong>Ad blocker detected!</strong><br>
    Disable your ad blocker, then <a href="" style="color:#f87171">refresh this page</a>.
  </div>

  <!-- Stage 1: Challenge -->
  <div class="stage on" id="s1">
    <div class="box">
      <div class="lbl">Step 1 of 3 — Verification Challenge</div>
      <div class="qtext" id="qtext">Loading…</div>
      <div id="qinput"></div>
      <div id="qst" class="inf"></div>
    </div>
    <button class="btn" id="chkBtn" onclick="submitChallenge()" disabled>Verify Answer</button>
  </div>

  <!-- Stage 2: Ads -->
  <div class="stage" id="s2">
    <div class="box">
      <div class="lbl" id="adlbl">Step 2 of 3 — Ad <span id="adN">1</span> / ${CFG.ADS}</div>
      <div class="adscreen"><div id="adviz"></div><div class="adtimer" id="adtimer">…</div></div>
      <div class="adtrack"><div class="adfill" id="adfill" style="width:0%"></div></div>
      <div id="adst" class="inf">Preparing…</div><br>
      <button class="skipbtn" id="skipbtn" onclick="skipAd()">Skip ›</button>
    </div>
  </div>

  <!-- Stage 3: Confirm -->
  <div class="stage" id="s3">
    <div class="box">
      <div class="lbl">Step 3 of 3 — Complete</div>
      <p style="color:#a89dc0;font-size:13px;line-height:1.8">
        ✓ Challenge verified &nbsp;|&nbsp; ✓ Ads watched<br><br>
        Click below to complete Checkpoint ${cur}.
      </p>
      <div id="cst" class="inf"></div>
    </div>
    <button class="btn" id="cmpBtn" onclick="complete()">Complete Checkpoint ${cur}</button>
  </div>

  <!-- Stage 4: Done -->
  <div class="stage" id="s4">
    <div class="box" style="text-align:center">
      <div style="font-size:36px;margin-bottom:10px">🎉</div>
      <div id="doneMsg" style="color:#22c55e;font-size:13px;line-height:1.8"></div>
    </div>
    <a href="javascript:window.close()" class="btn">Close Window</a>
  </div>

  <p class="footer">VOID KEY SYSTEM &nbsp;·&nbsp; DO NOT SHARE YOUR LINKS</p>
</div>

<script>
const TOKEN = ${JSON.stringify(token)};
const ADS   = ${CFG.ADS};
const BASE  = ${JSON.stringify(CFG.BASE_URL)};

let curAns  = "";   // stores what user typed/clicked
let chkPass = false;
let adsDone = false;
let curAd   = 1;
let adInt   = null;
let skipRdy = false;

// ── Ad-block detection ────────────────────────────────────────────
async function checkAdBlock() {
    return new Promise(res => {
        const s  = document.createElement("script");
        s.src    = BASE + "/ads/ads.js?_=" + Date.now();
        s.onload = () => res(false);
        s.onerror= () => res(true);
        document.head.appendChild(s);
        setTimeout(() => res(!window.__adBlockOff), 2500);
    });
}

async function boot() {
    if (await checkAdBlock()) {
        document.getElementById("abWarn").style.display = "block";
        document.getElementById("s1").classList.remove("on");
        return;
    }
    loadChallenge();
}

// ── Challenge ─────────────────────────────────────────────────────
async function loadChallenge(data) {
    const r = data || await fetch(BASE + "/challenge?token=" + TOKEN).then(x=>x.json()).catch(()=>null);
    if (!r || !r.ok) {
        document.getElementById("qtext").innerHTML = "Failed to load challenge. Please reload.";
        return;
    }

    document.getElementById("qtext").innerHTML = r.question;
    document.getElementById("qst").textContent = "";
    curAns = "";

    const wrap = document.getElementById("qinput");
    wrap.innerHTML = "";
    document.getElementById("chkBtn").disabled   = true;
    document.getElementById("chkBtn").textContent = "Verify Answer";

    if (r.type === "color") {
        const d = document.createElement("div");
        d.className = "cbts";
        r.data.opts.forEach(o => {
            const b = document.createElement("button");
            b.className   = "cbt";
            b.textContent = o.toUpperCase();
            b.onclick = () => {
                document.querySelectorAll(".cbt").forEach(x => x.classList.remove("sel"));
                b.classList.add("sel");
                curAns = o;
                document.getElementById("chkBtn").disabled = false;
            };
            d.appendChild(b);
        });
        wrap.appendChild(d);
    } else {
        const input = document.createElement("input");
        input.className   = "inp";
        input.placeholder = r.type==="math" ? "Enter number" : r.type==="word" ? "Type the word" : "Your answer";
        input.oninput = () => {
            curAns = input.value;
            document.getElementById("chkBtn").disabled = input.value.trim() === "";
        };
        input.onkeydown = e => { if (e.key === "Enter" && curAns.trim()) submitChallenge(); };
        wrap.appendChild(input);
        setTimeout(() => input.focus(), 100);
    }
}

async function submitChallenge() {
    const btn = document.getElementById("chkBtn");
    const st  = document.getElementById("qst");
    btn.disabled    = true;
    btn.textContent = "Checking…";
    st.textContent  = "";
    st.className    = "inf";

    if (!curAns.trim()) {
        st.textContent  = "Please enter an answer.";
        st.className    = "err";
        btn.disabled    = false;
        btn.textContent = "Verify Answer";
        return;
    }

    let r = null;
    try {
        r = await fetch(BASE + "/challenge/verify", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ token: TOKEN, answer: curAns.trim() }),
        }).then(x => x.json());
    } catch {
        st.textContent  = "❌ Network error. Try again.";
        st.className    = "err";
        btn.disabled    = false;
        btn.textContent = "Verify Answer";
        return;
    }

    if (!r.ok) {
        // Server rejected — show error, reset with new challenge
        st.textContent  = "❌ " + r.msg;
        st.className    = "err";
        btn.disabled    = false;
        btn.textContent = "Verify Answer";
        if (r.newQuestion) {
            // Server sent a fresh challenge inline — load it
            await loadChallenge({ ok:true, type:r.newType, question:r.newQuestion, data:r.newData });
        }
        return;
    }

    chkPass = true;
    st.textContent  = "✓ Correct!";
    st.className    = "ok";
    btn.textContent = "✓ Verified";
    setTimeout(() => {
        document.getElementById("s1").classList.remove("on");
        document.getElementById("s2").classList.add("on");
        playAd(1);
    }, 700);
}

// ── Ads ───────────────────────────────────────────────────────────
const themes = [
    { bg:"linear-gradient(135deg,#1a0a30,#0d1a3a)", icon:"🚀", name:"VOID PREMIUM",  tag:"Upgrade your access" },
    { bg:"linear-gradient(135deg,#0d1a0d,#1a2d0a)", icon:"🛡️", name:"VOID SECURITY", tag:"Military-grade protection" },
    { bg:"linear-gradient(135deg,#1a0d1a,#2d0a2d)", icon:"💎", name:"VOID ELITE",    tag:"Exclusive access" },
    { bg:"linear-gradient(135deg,#1a1a0a,#2d2a0d)", icon:"⚡", name:"VOID SPEED",    tag:"Zero-lag execution" },
    { bg:"linear-gradient(135deg,#0a1a1a,#0d2d2a)", icon:"🔑", name:"VOID KEYS",     tag:"Secure key distribution" },
    { bg:"linear-gradient(135deg,#1a0a0a,#2d100d)", icon:"🌐", name:"VOID NETWORK",  tag:"Global script network" },
];

function playAd(n) {
    curAd   = n;
    skipRdy = false;

    const len  = Math.floor(Math.random() * 21) + 10; // 10–30s
    let   secs = len;

    document.getElementById("adN").textContent        = n;
    document.getElementById("adfill").style.width     = "0%";
    document.getElementById("skipbtn").className      = "skipbtn";
    document.getElementById("skipbtn").textContent    = "Skip ›";
    document.getElementById("adst").textContent       = \`Ad \${n} of \${ADS} — must watch 5s before skipping\`;

    const t = themes[Math.floor(Math.random() * themes.length)];
    const v = document.getElementById("advis" + "z" || "advis");
    const adv = document.getElementById("adv" + "iz" || "adviz");
    document.getElementById("adv" + "iz".split("").reverse().join("") ||"adviz");

    // Target the correct element id
    const vizEl = document.getElementById("adv" + ["i","z"].join(""));
    if (vizEl) {
        vizEl.style.background = t.bg;
        vizEl.innerHTML = \`<span style="font-size:38px">\${t.icon}</span>
        <div style="color:#e2d9f3;font-size:15px;font-weight:900;letter-spacing:5px">\${t.name}</div>
        <div style="color:#8b7aaa;font-size:10px">\${t.tag}</div>\`;
    }

    if (adInt) clearInterval(adInt);
    adInt = setInterval(() => {
        secs--;
        const pct = ((len - secs) / len) * 100;
        document.getElementById("adtimer").textContent    = secs + "s";
        document.getElementById("adfill").style.width     = pct + "%";

        if (len - secs >= 5 && !skipRdy) {
            skipRdy = true;
            const sb = document.getElementById("skipbtn");
            sb.classList.add("rdy");
            sb.textContent = "Skip Ad ›";
        }

        if (secs <= 0) { clearInterval(adInt); finishAd(); }
    }, 1000);
}

function skipAd() {
    if (!skipRdy) return;
    clearInterval(adInt);
    finishAd();
}

function finishAd() {
    document.getElementById("adst").textContent = \`✓ Ad \${curAd} complete\`;
    if (curAd < ADS) {
        setTimeout(() => playAd(curAd + 1), 1000);
    } else {
        adsDone = true;
        setTimeout(() => {
            document.getElementById("s2").classList.remove("on");
            document.getElementById("s3").classList.add("on");
        }, 800);
    }
}

// ── Complete ──────────────────────────────────────────────────────
async function complete() {
    const btn = document.getElementById("cmpBtn");
    const st  = document.getElementById("cst");
    btn.disabled    = true;
    btn.textContent = "Submitting…";
    st.textContent  = ""; st.className = "inf";

    let r = null;
    try {
        r = await fetch(BASE + "/checkpoint/complete", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ token: TOKEN }),
        }).then(x => x.json());
    } catch {
        st.textContent  = "❌ Network error. Try again.";
        st.className    = "err";
        btn.disabled    = false;
        btn.textContent = "Complete Checkpoint ${cur}";
        return;
    }

    if (!r.ok) {
        st.textContent  = "❌ " + r.msg;
        st.className    = "err";
        btn.disabled    = false;
        btn.textContent = "Complete Checkpoint ${cur}";
        return;
    }

    document.getElementById("s3").classList.remove("on");
    document.getElementById("s4").classList.add("on");
    document.getElementById("doneMsg").innerHTML = r.msg;
}

// Fix adviz reference then boot
window.addEventListener("DOMContentLoaded", () => {
    const el = document.getElementById("adv" + "iz".split("").join(""));
    boot();
});
</script>
</body>
</html>`;
}

// Shared CSS
function css() {
    return `
*{margin:0;padding:0;box-sizing:border-box}
body{background:#04030a;color:#a89dc0;font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh;
     display:flex;align-items:center;justify-content:center;padding:20px;
     background-image:radial-gradient(ellipse at 50% 0%,#1a0a3014 0%,transparent 70%)}
.card{background:linear-gradient(145deg,#0f0c1c,#070512);border:1px solid #2a1f45;
      border-radius:22px;padding:40px 34px;max-width:480px;width:100%;text-align:center;
      box-shadow:0 0 80px #6d28d910,0 0 30px #00000050;position:relative;overflow:hidden}
.card::before{content:'';position:absolute;top:0;left:10%;right:10%;height:1px;
              background:linear-gradient(90deg,transparent,#7c3aed45,transparent)}
.logo{font-size:46px;color:#7c3aed;margin-bottom:10px;filter:drop-shadow(0 0 14px #7c3aed50)}
h1{color:#e2d9f3;font-size:20px;letter-spacing:10px;font-weight:900;margin-bottom:4px}
.sub{color:#3d2f60;font-size:10px;letter-spacing:4px;margin-bottom:26px}
.steps{display:flex;align-items:center;justify-content:center;margin-bottom:22px;flex-wrap:wrap}
.step{display:flex;flex-direction:column;align-items:center;gap:8px}
.ln{width:22px;height:2px;background:#1e1535;margin-bottom:22px}
.step.done+.ln{background:#7c3aed55}
.sc{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;
    font-size:14px;font-weight:800;border:2px solid #1e1535;background:#100d1e;color:#2e2248}
.step.done .sc{background:#2d1a60;border-color:#7c3aed;color:#c4b5fd;box-shadow:0 0 12px #7c3aed40}
.step.active .sc{background:#3b1f70;border-color:#a855f7;color:#f3e8ff;box-shadow:0 0 18px #a855f760}
.sl{font-size:9px;color:#2e2248;text-align:center;line-height:1.5}
.sl span{color:#6d28d9;font-weight:bold}
.step.done .sl,.step.active .sl{color:#8b7aaa}
.step.done .sl span,.step.active .sl span{color:#a855f7}
.msg{padding:16px 18px;border-radius:12px;font-size:13px;line-height:1.7;margin-bottom:22px;border:1px solid}
.btn{display:block;background:linear-gradient(135deg,#5b21b6,#7c3aed);color:#f3e8ff;border:none;
     border-radius:12px;padding:14px 28px;font-size:11px;font-weight:800;letter-spacing:3px;
     cursor:pointer;text-decoration:none;transition:.18s;width:100%;margin-top:8px;
     box-shadow:0 4px 20px #7c3aed25}
.btn:hover:not(:disabled){background:linear-gradient(135deg,#6d28d9,#9333ea);transform:translateY(-1px)}
.btn:disabled{opacity:.45;cursor:not-allowed}
.footer{margin-top:22px;font-size:10px;color:#1e1535;letter-spacing:2px}`;
}

// ═══════════════════════════════════════════════════════════════════
//  AUTO CLEANUP  (every hour)
// ═══════════════════════════════════════════════════════════════════
function cleanup() {
    const now = Date.now();
    let kR=0, tR=0, cR=0;

    for (const [k, d] of keys)
        if (!d.blocked && d.expiresAt > 0 && now > d.expiresAt + 3_600_000) { keys.delete(k); kR++; }

    for (const [t, tv] of vtokens)
        if (tv.used || now - tv.createdAt > CFG.TOKEN_TTL * 2) { vtokens.delete(t); tR++; }

    for (const [t] of challenges)
        if (!vtokens.has(t)) challenges.delete(t);

    for (const [uid, ts] of cooldowns)
        if (now - ts > CFG.COOLDOWN * 15) { cooldowns.delete(uid); cR++; }

    for (const [uid, d] of approvals)
        if (now - d.createdAt > CFG.APPROVAL_TTL) approvals.delete(uid);

    for (const [uid, p] of pending)
        if (now - p.createdAt > 3 * 3_600_000) pending.delete(uid);

    for (const [ip, r] of failLog)
        if (r.blockedUntil && now > r.blockedUntil + 3_600_000) failLog.delete(ip);

    console.log(`[VOID] 🧹 Cleanup — keys:${kR} tokens:${tR} cooldowns:${cR}`);
}
setInterval(cleanup, CFG.CLEANUP_EVERY);

// ═══════════════════════════════════════════════════════════════════
//  KEEP-ALIVE  (every 10 min — prevents Render free tier sleep)
// ═══════════════════════════════════════════════════════════════════
function keepAlive() {
    const url = CFG.BASE_URL;
    if (!url || url.includes("localhost")) return;
    setInterval(() => {
        const mod = url.startsWith("https") ? https : http;
        const req = mod.get(url, r => console.log(`[VOID] 💓 Keep-alive → ${r.statusCode}`));
        req.on("error", e => console.warn("[VOID] Keep-alive err:", e.message));
        req.end();
    }, CFG.KEEPALIVE_EVERY);
    console.log("[VOID] 💓 Keep-alive started");
}

// ═══════════════════════════════════════════════════════════════════
//  LAUNCH
// ═══════════════════════════════════════════════════════════════════
app.listen(CFG.PORT, () => console.log(`[VOID] ✓ API on port ${CFG.PORT}`));

keepAlive();

process.on("unhandledRejection", e => console.error("[VOID] Unhandled rejection:", e?.message || e));
process.on("uncaughtException",  e => console.error("[VOID] Uncaught exception:",  e?.message || e));

client.login(CFG.TOKEN).catch(e => {
    console.error("[VOID] LOGIN FAILED:", e.message);
    process.exit(1);
});
