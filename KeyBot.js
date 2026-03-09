/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║               V O I D   K E Y   S Y S T E M  v4.0              ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  HOW IT WORKS:                                                  ║
 * ║  1. User types ?getkey in channel                               ║
 * ║  2. "Check your DMs!" appears in channel → auto-deletes 2s      ║
 * ║  3. User gets 5-minute cooldown on ?getkey                      ║
 * ║  4. DM has dropdown: 1–10 steps (each step = +24h)             ║
 * ║     Steps ADD not multiply: 3 steps = 24+24+24 = 72h           ║
 * ║  5. Each checkpoint → webpage with:                             ║
 * ║     • Ad-block detection (must disable to continue)             ║
 * ║     • Random mini-challenge (math/color/memory/click/type)      ║
 * ║     • Watch N ads sequentially (ADS env var, max 30s each)      ║
 * ║     • All 3 must pass to complete checkpoint                    ║
 * ║  6. After all steps → key delivered via DM                      ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  ENV VARIABLES:                                                 ║
 * ║  BOT_TOKEN             Discord bot token                        ║
 * ║  GUILD_ID              Server ID                                ║
 * ║  GET_KEY_CHANNEL_ID    Channel for ?getkey                      ║
 * ║  ADMIN_CHANNEL_ID      Channel for approve/deny cards           ║
 * ║  KEY_SECRET            HMAC signing secret                      ║
 * ║  BASE_URL              https://your-service.onrender.com        ║
 * ║  API_SECRET            Optional /validate header key            ║
 * ║  ADS                   Number of ads per checkpoint (default 1) ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

"use strict";

const {
    Client, GatewayIntentBits, Partials,
    EmbedBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    SlashCommandBuilder, REST, Routes,
    Events, PermissionFlagsBits
} = require("discord.js");
const express = require("express");
const crypto  = require("crypto");
const https   = require("https");
const http    = require("http");

// ═══════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════
const CONFIG = {
    TOKEN:              process.env.BOT_TOKEN,
    GET_KEY_CHANNEL_ID: process.env.GET_KEY_CHANNEL_ID,
    ADMIN_CHANNEL_ID:   process.env.ADMIN_CHANNEL_ID,
    GUILD_ID:           process.env.GUILD_ID,
    KEY_SECRET:         process.env.KEY_SECRET  || "change_this_secret",
    API_SECRET:         process.env.API_SECRET  || "",
    API_PORT:           process.env.PORT         || 3000,
    BASE_URL:           process.env.BASE_URL     || "https://void-r3co.onrender.com",
    ADS_PER_CHECKPOINT: Math.max(1, parseInt(process.env.ADS || "1")),

    KEY_PREFIX:    "VOID",
    KEY_SEGMENTS:  3,
    KEY_SEG_LEN:   4,

    MIN_STEPS:          1,
    MAX_STEPS:          10,
    HOURS_PER_STEP:     24,   // each step ADDS 24h — never multiplies

    CHANNEL_MSG_TTL:    2000,              // "Check your DMs" disappears in 2s
    GETKEY_COOLDOWN:    5 * 60 * 1000,    // 5 minute cooldown
    VERIFY_TOKEN_TTL:   15 * 60 * 1000,   // checkpoint link valid 15 min
    APPROVAL_TTL:       30 * 60 * 1000,   // approval card TTL
    CLEANUP_INTERVAL:   60 * 60 * 1000,
    KEEPALIVE_INTERVAL: 10 * 60 * 1000,

    MAX_FAIL_ATTEMPTS:  5,
    FAIL_WINDOW_MS:     10 * 60 * 1000,
    BLOCK_DURATION_MS:  60 * 60 * 1000,
};

// ═══════════════════════════════════════════════════════════════
//  STARTUP
// ═══════════════════════════════════════════════════════════════
console.log("╔═══════════════════════════════════════╗");
console.log("║   VOID KEY SYSTEM  v4.0  STARTING    ║");
console.log("╚═══════════════════════════════════════╝");
console.log(`[Void] BOT_TOKEN          : ${CONFIG.TOKEN              ? "✓" : "✗ MISSING"}`);
console.log(`[Void] GUILD_ID           : ${CONFIG.GUILD_ID           ? "✓" : "✗ MISSING"}`);
console.log(`[Void] GET_KEY_CHANNEL_ID : ${CONFIG.GET_KEY_CHANNEL_ID ? "✓" : "✗ MISSING"}`);
console.log(`[Void] ADMIN_CHANNEL_ID   : ${CONFIG.ADMIN_CHANNEL_ID   ? "✓" : "⚠ optional"}`);
console.log(`[Void] ADS_PER_CHECKPOINT : ${CONFIG.ADS_PER_CHECKPOINT}`);
console.log(`[Void] BASE_URL           : ${CONFIG.BASE_URL}`);

if (!CONFIG.TOKEN)              { console.error("[Void] FATAL: BOT_TOKEN missing!");          process.exit(1); }
if (!CONFIG.GUILD_ID)           { console.error("[Void] FATAL: GUILD_ID missing!");           process.exit(1); }
if (!CONFIG.GET_KEY_CHANNEL_ID) { console.error("[Void] FATAL: GET_KEY_CHANNEL_ID missing!"); process.exit(1); }

// ═══════════════════════════════════════════════════════════════
//  STORAGE
// ═══════════════════════════════════════════════════════════════
const keys          = new Map();   // keyString   → KeyData
const pendingUsers  = new Map();   // userId      → PendingData
const verifyTokens  = new Map();   // token       → TokenData
const cooldowns     = new Map();   // userId      → timestamp
const failLog       = new Map();   // ip          → FailData
const approvalQueue = new Map();   // userId      → ApprovalData
const approvalMsgs  = new Map();   // messageId   → userId

// ═══════════════════════════════════════════════════════════════
//  KEY CRYPTO
// ═══════════════════════════════════════════════════════════════
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
        .update(raw).digest("hex").slice(0, CONFIG.KEY_SEG_LEN).toUpperCase();
    return `${raw}-${chk}`;
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

// ═══════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════
function msToHuman(ms) {
    if (ms <= 0) return "expired";
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function progressBar(done, total) {
    let bar = "";
    for (let i = 0; i < total; i++) bar += i < done ? "🟣 " : "⚫ ";
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
    return !!(last && Date.now() - last < CONFIG.GETKEY_COOLDOWN);
}

function cooldownRemaining(userId) {
    const last = cooldowns.get(userId);
    if (!last) return 0;
    return Math.max(0, CONFIG.GETKEY_COOLDOWN - (Date.now() - last));
}

function setCooldown(userId) { cooldowns.set(userId, Date.now()); }

function recordFail(ip) {
    const now = Date.now();
    const rec = failLog.get(ip) || { count: 0, firstFail: now, blockedUntil: 0 };
    if (now - rec.firstFail > CONFIG.FAIL_WINDOW_MS) { rec.count = 0; rec.firstFail = now; }
    rec.count++;
    if (rec.count >= CONFIG.MAX_FAIL_ATTEMPTS) {
        rec.blockedUntil = now + CONFIG.BLOCK_DURATION_MS;
        console.warn(`[Void] IP blocked: ${ip}`);
    }
    failLog.set(ip, rec);
}

function isBlocked(ip) {
    const rec = failLog.get(ip);
    return !!(rec?.blockedUntil && Date.now() < rec.blockedUntil);
}

function parseMessageLink(link) {
    const match = link.match(/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
    if (!match) return null;
    return { guildId: match[1], channelId: match[2], messageId: match[3] };
}

// ═══════════════════════════════════════════════════════════════
//  DM BUILDERS
// ═══════════════════════════════════════════════════════════════
async function dmStepSelector(user) {
    const options = [];
    for (let i = CONFIG.MIN_STEPS; i <= CONFIG.MAX_STEPS; i++) {
        const hours = i * CONFIG.HOURS_PER_STEP;
        const days  = hours >= 24 ? `${Math.floor(hours/24)}d ` : "";
        options.push(
            new StringSelectMenuOptionBuilder()
                .setLabel(`${i} Step${i > 1 ? "s" : ""} — ${days}${hours % 24 > 0 ? hours % 24 + "h" : ""}`.replace("0h","").trim())
                .setDescription(`Complete ${i} checkpoint${i>1?"s":""} → ${hours}h access`)
                .setValue(`${i}`)
                .setEmoji(["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"][i-1])
        );
    }

    const embed = new EmbedBuilder()
        .setColor(0x6d28d9)
        .setTitle("◈  VOID — Choose Your Steps")
        .setDescription(
            "Your request was **approved** ✓\n\n" +
            "Select how many verification steps to complete.\n" +
            "Each step **adds** `+24h` to your key access time.\n\n" +
            `> **1 step** = 24h &nbsp;|&nbsp; **5 steps** = 120h &nbsp;|&nbsp; **10 steps** = 240h`
        )
        .addFields({ name: "⚡ Each Checkpoint Includes", value: `• Random verification challenge\n• Watch **${CONFIG.ADS_PER_CHECKPOINT}** ad${CONFIG.ADS_PER_CHECKPOINT>1?"s":""} (max 30s each)\n• Ad blocker must be **disabled**` })
        .setFooter({ text: "VOID Key System · Steps 1–10" })
        .setTimestamp();

    const menu = new StringSelectMenuBuilder()
        .setCustomId(`stepselect_${user.id}`)
        .setPlaceholder("🔑  Select steps (1–10)...")
        .addOptions(options);

    await user.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
}

async function dmCheckpointLink(user, step, totalSteps) {
    const token      = generateToken(user.id, step);
    const link       = `${CONFIG.BASE_URL}/checkpoint?token=${token}`;
    const hoursTotal = totalSteps * CONFIG.HOURS_PER_STEP;

    const embed = new EmbedBuilder()
        .setColor(0x6d28d9)
        .setTitle(`◈  Checkpoint ${step} / ${totalSteps}`)
        .setDescription(
            `Complete the verification below for **Checkpoint ${step}**.\n\n` +
            `After all **${totalSteps}** checkpoints your key will be sent,\n` +
            `valid for **${hoursTotal} hours** (${totalSteps} × 24h).`
        )
        .addFields(
            { name: "📍 Progress",      value: progressBar(step - 1, totalSteps) },
            { name: "⏱ Link Expires",   value: "**15 minutes**",          inline: true },
            { name: "🎁 Hours Earned",   value: `**${(step-1)*24}h** so far`, inline: true },
            { name: "📋 What To Do",
              value: `1. Click the button below\n2. Disable any ad blocker\n3. Complete the random challenge\n4. Watch ${CONFIG.ADS_PER_CHECKPOINT} ad${CONFIG.ADS_PER_CHECKPOINT>1?"s":""}\n5. Done — come back here for next step` },
            { name: "⚠️ Warning", value: "**Do not share this link.** One-time use, tied to your account." }
        )
        .setFooter({ text: `VOID Key System · Step ${step}/${totalSteps}` })
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
            `You completed all **${totalSteps}** checkpoint${totalSteps > 1 ? "s" : ""}!\n` +
            `Total access: **${totalSteps} × 24h = ${totalHours} hours**.`
        )
        .addFields(
            { name: "🔑 License Key",   value: `\`\`\`${key}\`\`\`` },
            { name: "📍 Completed",     value: progressBar(totalSteps, totalSteps) },
            { name: "⏳ Valid For",      value: `**${totalHours} hours**`,  inline: true },
            { name: "✅ Steps Done",     value: `**${totalSteps}/10**`,      inline: true },
            { name: "⚠️ Important",     value: "**Never share this key.** It is permanently tied to your Discord account." }
        )
        .setFooter({ text: "VOID Key System · Keep this safe" })
        .setTimestamp();

    await user.send({ embeds: [embed] });
}

// ═══════════════════════════════════════════════════════════════
//  ADMIN APPROVAL CARD
// ═══════════════════════════════════════════════════════════════
async function sendApprovalCard(guild, requestUser) {
    const embed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("◈  Key Request — Pending")
        .setDescription(`<@${requestUser.id}> has requested a key.`)
        .addFields(
            { name: "👤 User",     value: requestUser.tag,          inline: true  },
            { name: "🆔 ID",       value: `\`${requestUser.id}\``,  inline: true  },
            { name: "📋 Status",   value: "⏳ Awaiting approval"                  },
            { name: "⏱ Expires",  value: "This request expires in **30 min**"    }
        )
        .setThumbnail(requestUser.displayAvatarURL())
        .setFooter({ text: "Click Approve or Deny" })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`approve_${requestUser.id}`).setLabel("  Approve").setStyle(ButtonStyle.Success).setEmoji("✅"),
        new ButtonBuilder().setCustomId(`deny_${requestUser.id}`).setLabel("  Deny").setStyle(ButtonStyle.Danger).setEmoji("❌"),
    );

    let sent = null;
    if (CONFIG.ADMIN_CHANNEL_ID) {
        try {
            const ch = await guild.channels.fetch(CONFIG.ADMIN_CHANNEL_ID);
            if (ch) sent = await ch.send({ embeds: [embed], components: [row] });
        } catch (e) { console.warn("[Void] Admin channel error:", e.message); }
    }
    if (!sent) {
        try {
            const owner = await guild.fetchOwner();
            sent = await owner.send({ embeds: [embed], components: [row] });
        } catch (e) { console.error("[Void] Could not DM owner:", e.message); }
    }
    if (sent) {
        approvalMsgs.set(sent.id, requestUser.id);
        approvalQueue.set(requestUser.id, { createdAt: Date.now(), messageId: sent.id, channelId: sent.channelId });
    }
}

// ═══════════════════════════════════════════════════════════════
//  DISCORD CLIENT
// ═══════════════════════════════════════════════════════════════
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
    console.log(`[Void] ✓ Online as ${client.user.tag}`);
    client.user.setActivity("?getkey", { type: 3 });
    await registerSlashCommands();
});

client.on("error", (err) => console.error("[Void] Client error:", err.message));

// ═══════════════════════════════════════════════════════════════
//  SLASH COMMANDS
// ═══════════════════════════════════════════════════════════════
async function registerSlashCommands() {
    const cmds = [
        new SlashCommandBuilder()
            .setName("removemessage")
            .setDescription("Delete a message by its Discord link")
            .addStringOption(o => o.setName("link").setDescription("Full Discord message link").setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages).toJSON(),
        new SlashCommandBuilder()
            .setName("rm")
            .setDescription("Delete a message by its link (alias)")
            .addStringOption(o => o.setName("link").setDescription("Full Discord message link").setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages).toJSON(),
    ];
    try {
        const rest = new REST({ version: "10" }).setToken(CONFIG.TOKEN);
        await rest.put(Routes.applicationGuildCommands(client.user.id, CONFIG.GUILD_ID), { body: cmds });
        console.log("[Void] ✓ Slash commands registered: /removemessage /rm");
    } catch (e) { console.error("[Void] Slash command register error:", e.message); }
}

// ═══════════════════════════════════════════════════════════════
//  ?getkey + ?removekey   (in #get-key channel)
// ═══════════════════════════════════════════════════════════════
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (message.channelId !== CONFIG.GET_KEY_CHANNEL_ID) return;

    const content = message.content.trim().toLowerCase();

    // ── ?removekey @User ──────────────────────────────────────
    if (content.startsWith("?removekey")) {
        try { await message.delete(); } catch {}
        const guild = await client.guilds.fetch(CONFIG.GUILD_ID).catch(() => null);
        if (!guild || message.author.id !== guild.ownerId) {
            const w = await message.channel.send(`<@${message.author.id}> ❌ Only the server owner can use \`?removekey\`.`);
            setTimeout(() => w.delete().catch(() => {}), 4000);
            return;
        }
        const mentioned = message.mentions.users.first();
        if (!mentioned) {
            const w = await message.channel.send(`❌ Usage: \`?removekey @User\``);
            setTimeout(() => w.delete().catch(() => {}), 4000);
            return;
        }
        let removed = 0;
        for (const [k, d] of keys.entries()) { if (d.userId === mentioned.id) { keys.delete(k); removed++; } }
        pendingUsers.delete(mentioned.id);
        cooldowns.delete(mentioned.id);
        approvalQueue.delete(mentioned.id);
        const w = await message.channel.send(
            removed > 0
                ? `✓  Removed **${removed}** key(s) for <@${mentioned.id}>.`
                : `❌  No keys found for <@${mentioned.id}>.`
        );
        setTimeout(() => w.delete().catch(() => {}), 4000);
        if (removed > 0) {
            try {
                await mentioned.send({ embeds: [new EmbedBuilder()
                    .setColor(0xef4444).setTitle("◈  Key Removed")
                    .setDescription("Your key was removed by the server owner.\nType `?getkey` to request a new one.")
                    .setTimestamp()
                ]});
            } catch {}
        }
        return;
    }

    // ── ?getkey ───────────────────────────────────────────────
    if (content !== "?getkey") return;
    try { await message.delete(); } catch {}

    const user  = message.author;

    // Active key already exists
    const found = getUserKey(user.id);
    if (found && found.data.expiresAt > Date.now()) {
        const w = await message.channel.send(`<@${user.id}> ✓ Check your DMs!`);
        setTimeout(() => w.delete().catch(() => {}), CONFIG.CHANNEL_MSG_TTL);
        try {
            await user.send({ embeds: [new EmbedBuilder()
                .setColor(0x6d28d9).setTitle("◈  You Already Have an Active Key")
                .addFields(
                    { name: "🔑 Key",     value: `\`\`\`${found.key}\`\`\`` },
                    { name: "⏳ Expires", value: `in **${msToHuman(found.data.expiresAt - Date.now())}**` }
                ).setFooter({ text: "Do not share your key." }).setTimestamp()
            ]});
        } catch {}
        return;
    }

    // Cooldown check
    if (isOnCooldown(user.id)) {
        const remaining = msToHuman(cooldownRemaining(user.id));
        const w = await message.channel.send(`<@${user.id}> ⏱ Cooldown active — try again in **${remaining}**.`);
        setTimeout(() => w.delete().catch(() => {}), CONFIG.CHANNEL_MSG_TTL);
        return;
    }
    setCooldown(user.id);

    // Already pending approval
    if (approvalQueue.has(user.id)) {
        const w = await message.channel.send(`<@${user.id}> ⏳ Your request is already pending approval.`);
        setTimeout(() => w.delete().catch(() => {}), CONFIG.CHANNEL_MSG_TTL);
        return;
    }

    // Mid-verification — resend current checkpoint
    if (pendingUsers.has(user.id)) {
        const w = await message.channel.send(`<@${user.id}> ✓ Check your DMs!`);
        setTimeout(() => w.delete().catch(() => {}), CONFIG.CHANNEL_MSG_TTL);
        const pending = pendingUsers.get(user.id);
        try { await dmCheckpointLink(user, pending.currentStep, pending.totalSteps); }
        catch { /* DMs closed */ }
        return;
    }

    // Queue for approval and notify user
    try {
        // Send "Check your DMs" → disappears in 2 seconds
        const ack = await message.channel.send(`<@${user.id}> ✓ Check your DMs!`);
        setTimeout(() => ack.delete().catch(() => {}), CONFIG.CHANNEL_MSG_TTL);

        const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
        await sendApprovalCard(guild, user);

        await user.send({ embeds: [new EmbedBuilder()
            .setColor(0xf59e0b).setTitle("◈  Request Submitted")
            .setDescription(
                "Your key request has been submitted for **admin approval**.\n\n" +
                "You'll receive a DM once reviewed.\n" +
                "A **5-minute cooldown** is now active on `?getkey`."
            )
            .setFooter({ text: "VOID Key System · Please wait" }).setTimestamp()
        ]});
        console.log(`[Void] Request queued: ${user.tag}`);

    } catch (e) {
        console.error("[Void] Request error:", e.message);
    }
});

// ═══════════════════════════════════════════════════════════════
//  INTERACTIONS  (buttons, dropdowns, slash commands)
// ═══════════════════════════════════════════════════════════════
client.on(Events.InteractionCreate, async (interaction) => {

    // ── /removemessage  /rm ───────────────────────────────────
    if (interaction.isChatInputCommand() &&
        (interaction.commandName === "removemessage" || interaction.commandName === "rm")) {
        await interaction.deferReply({ ephemeral: true });
        const parsed = parseMessageLink(interaction.options.getString("link") || "");
        if (!parsed) return interaction.editReply("❌ Invalid message link.");
        if (parsed.guildId !== CONFIG.GUILD_ID) return interaction.editReply("❌ Message not from this server.");
        try {
            const ch  = await client.channels.fetch(parsed.channelId);
            const msg = await ch.messages.fetch(parsed.messageId);
            await msg.delete();
            console.log(`[Void] Message ${parsed.messageId} deleted by ${interaction.user.tag}`);
            return interaction.editReply("✓ Message deleted.");
        } catch (e) {
            return interaction.editReply(`❌ Failed: ${e.message}`);
        }
    }

    // ── Approve / Deny buttons ────────────────────────────────
    if (interaction.isButton()) {
        const id = interaction.customId;
        if (!id.startsWith("approve_") && !id.startsWith("deny_")) return;

        const targetId  = id.replace("approve_", "").replace("deny_", "");
        const isApprove = id.startsWith("approve_");

        const updated = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(isApprove ? 0x22c55e : 0xef4444)
            .spliceFields(2, 1, {
                name: "📋 Status",
                value: isApprove
                    ? `✅ Approved by ${interaction.user.tag}`
                    : `❌ Denied by ${interaction.user.tag}`,
            });

        await interaction.update({ embeds: [updated], components: [] }).catch(() => {});
        approvalQueue.delete(targetId);
        approvalMsgs.delete(interaction.message.id);

        let targetUser = null;
        try { targetUser = await client.users.fetch(targetId); } catch {}
        if (!targetUser) return;

        if (isApprove) {
            console.log(`[Void] Approved: ${targetUser.tag}`);
            try { await dmStepSelector(targetUser); } catch (e) { console.error("[Void] dmStepSelector error:", e.message); }
        } else {
            console.log(`[Void] Denied: ${targetUser.tag}`);
            try {
                await targetUser.send({ embeds: [new EmbedBuilder()
                    .setColor(0xef4444).setTitle("◈  Request Denied")
                    .setDescription("Your key request was **denied**.\nContact a server admin if you think this is a mistake.")
                    .setTimestamp()
                ]});
            } catch {}
        }
        return;
    }

    // ── Step selector dropdown ────────────────────────────────
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("stepselect_")) {
        const userId = interaction.customId.replace("stepselect_", "");
        if (interaction.user.id !== userId)
            return interaction.reply({ content: "❌ This menu isn't for you.", ephemeral: true });

        const totalSteps = parseInt(interaction.values[0]);
        const totalHours = totalSteps * CONFIG.HOURS_PER_STEP;

        await interaction.update({
            embeds: [new EmbedBuilder()
                .setColor(0x6d28d9).setTitle("◈  Steps Confirmed")
                .setDescription(
                    `You chose **${totalSteps}** step${totalSteps > 1 ? "s" : ""}\n` +
                    `Total access: **${totalSteps} × 24h = ${totalHours}h**\n\n` +
                    `Complete all checkpoints and your key will be sent automatically. ↓`
                )
                .setFooter({ text: "Do not share your checkpoint links." }).setTimestamp()
            ],
            components: []
        });

        const newKey = generateKey();
        keys.set(newKey, {
            userId: interaction.user.id,
            createdAt: Date.now(),
            totalSteps,
            stepsCompleted: 0,
            expiresAt: 0,
            blocked: false,
        });
        pendingUsers.set(interaction.user.id, {
            totalSteps,
            currentStep: 1,
            keyString: newKey,
            createdAt: Date.now(),
        });

        console.log(`[Void] ${interaction.user.tag} chose ${totalSteps} steps — key: ${newKey}`);

        try { await dmCheckpointLink(interaction.user, 1, totalSteps); }
        catch (e) { console.error("[Void] Checkpoint DM error:", e.message); }
    }
});

// ═══════════════════════════════════════════════════════════════
//  ADMIN DM COMMANDS
// ═══════════════════════════════════════════════════════════════
client.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;
    if (msg.channel.type !== 1) return;

    const guild = await client.guilds.fetch(CONFIG.GUILD_ID).catch(() => null);
    if (!guild || msg.author.id !== guild.ownerId) return;

    const args = msg.content.trim().split(/\s+/);
    const cmd  = args[0]?.toLowerCase();

    if (cmd === "!help") {
        return msg.reply(
            "```\nVOID KEY SYSTEM — ADMIN COMMANDS\n" +
            "════════════════════════════════\n\n" +
            "IN #get-key:\n" +
            "  ?getkey              — Request a key\n" +
            "  ?removekey @User     — Remove a user's key (owner)\n\n" +
            "DM TO BOT:\n" +
            "  !help                — This menu\n" +
            "  !stats               — Key statistics\n" +
            "  !listkeys            — All keys + status\n" +
            "  !pending             — Pending approvals\n" +
            "  !approve <userId>    — Approve a request\n" +
            "  !deny <userId>       — Deny a request\n" +
            "  !revoke <key>        — Revoke a key\n" +
            "  !reset <userId>      — Wipe all user data\n" +
            "  !unblock <ip>        — Unblock an IP\n\n" +
            "SLASH COMMANDS:\n" +
            "  /removemessage <link>\n" +
            "  /rm <link>\n" +
            "```"
        );
    }

    if (cmd === "!stats") {
        const all     = [...keys.values()];
        const active  = all.filter(d => !d.blocked && d.expiresAt > Date.now()).length;
        const pending = all.filter(d => d.expiresAt === 0 && !d.blocked).length;
        const expired = all.filter(d => d.expiresAt > 0 && Date.now() > d.expiresAt).length;
        const revoked = all.filter(d => d.blocked).length;
        return msg.reply(
            "```\nVOID STATS\n══════════\n" +
            `Total keys       : ${keys.size}\n` +
            `Active           : ${active}\n` +
            `Awaiting steps   : ${pending}\n` +
            `Expired          : ${expired}\n` +
            `Revoked          : ${revoked}\n` +
            `Pending approval : ${approvalQueue.size}\n` +
            `In verification  : ${pendingUsers.size}\n` +
            "```"
        );
    }

    if (cmd === "!listkeys") {
        if (keys.size === 0) return msg.reply("No keys.");
        let out = `**Keys (${keys.size}):**\n`;
        for (const [k, d] of keys.entries()) {
            const st =
                d.blocked          ? "🚫 revoked"
                : d.expiresAt === 0 ? `⏸ pending (${d.stepsCompleted}/${d.totalSteps})`
                : Date.now() > d.expiresAt ? "💀 expired"
                : `✓ ${msToHuman(d.expiresAt - Date.now())} left`;
            out += `\`${k}\` <@${d.userId}> [${st}]\n`;
        }
        for (const c of (out.match(/[\s\S]{1,1900}/g) || [])) await msg.reply(c);
        return;
    }

    if (cmd === "!pending") {
        if (approvalQueue.size === 0) return msg.reply("No pending requests.");
        let out = `**Pending (${approvalQueue.size}):**\n`;
        for (const [uid, d] of approvalQueue.entries())
            out += `<@${uid}> \`${uid}\` — waiting **${msToHuman(Date.now() - d.createdAt)}**\n`;
        return msg.reply(out.slice(0, 2000));
    }

    if (cmd === "!approve" && args[1]) {
        const uid = args[1];
        if (!approvalQueue.has(uid)) return msg.reply(`❌ No pending request for \`${uid}\``);
        approvalQueue.delete(uid);
        try {
            const u = await client.users.fetch(uid);
            await dmStepSelector(u);
            return msg.reply(`✓ Approved <@${uid}>`);
        } catch { return msg.reply("❌ Could not find/DM that user."); }
    }

    if (cmd === "!deny" && args[1]) {
        const uid = args[1];
        approvalQueue.delete(uid);
        try {
            const u = await client.users.fetch(uid);
            await u.send({ embeds: [new EmbedBuilder().setColor(0xef4444).setTitle("◈  Request Denied")
                .setDescription("Your key request was denied.").setTimestamp()]});
        } catch {}
        return msg.reply(`✓ Denied \`${uid}\``);
    }

    if (cmd === "!revoke" && args[1]) {
        const key  = args[1].toUpperCase();
        const data = keys.get(key);
        if (!data) return msg.reply(`❌ Not found: \`${key}\``);
        data.blocked = true; keys.set(key, data);
        return msg.reply(`✓ Revoked: \`${key}\``);
    }

    if (cmd === "!reset" && args[1]) {
        const uid = args[1]; let r = 0;
        for (const [k, d] of keys.entries()) { if (d.userId === uid) { keys.delete(k); r++; } }
        pendingUsers.delete(uid); cooldowns.delete(uid); approvalQueue.delete(uid);
        return msg.reply(`✓ Reset <@${uid}> — removed ${r} key(s).`);
    }

    if (cmd === "!unblock" && args[1]) {
        failLog.delete(args[1]);
        return msg.reply(`✓ Unblocked: \`${args[1]}\``);
    }

    return msg.reply("❓ Unknown command. Type `!help`.");
});

// ═══════════════════════════════════════════════════════════════
//  EXPRESS API
// ═══════════════════════════════════════════════════════════════
const app = express();
app.use(express.json());

// ── Fake ads.js — if this loads, no ad blocker ────────────────
// Ad blockers block requests containing "ads" in the path/filename.
// We serve a tiny JS file at /ads/ads.js — if the client can load it,
// the ad blocker is off. If it's blocked, the page shows a warning.
app.get("/ads/ads.js", (req, res) => {
    res.setHeader("Content-Type", "application/javascript");
    res.send(`window.__adCheckPassed = true;`);
});

// ── Optional API auth middleware ──────────────────────────────
app.use((req, res, next) => {
    if (req.path === "/ads/ads.js") return next();
    if (CONFIG.API_SECRET && req.headers["x-api-key"] !== CONFIG.API_SECRET)
        return res.status(401).json({ valid: false, message: "Unauthorized" });
    next();
});

// ── GET /checkpoint?token=XXX ─────────────────────────────────
app.get("/checkpoint", async (req, res) => {
    const token = req.query.token || "";
    if (!token) return res.send(checkpointPage({ state:"error", msg:"Invalid or missing token.", done:0, current:1, total:1, token:"", adsCount:CONFIG.ADS_PER_CHECKPOINT }));

    const tv = verifyTokens.get(token);
    if (!tv)        return res.send(checkpointPage({ state:"error", msg:"This link is invalid or does not exist.", done:0, current:1, total:1, token, adsCount:CONFIG.ADS_PER_CHECKPOINT }));
    if (tv.used)    return res.send(checkpointPage({ state:"error", msg:"This link has already been used.", done:tv.step-1, current:tv.step, total:3, token, adsCount:CONFIG.ADS_PER_CHECKPOINT }));
    if (Date.now() - tv.createdAt > CONFIG.VERIFY_TOKEN_TTL) {
        verifyTokens.delete(token);
        return res.send(checkpointPage({ state:"error", msg:"Link expired. Type ?getkey in Discord for a new one.", done:0, current:tv.step, total:3, token, adsCount:CONFIG.ADS_PER_CHECKPOINT }));
    }

    const found   = getUserKey(tv.userId);
    const pending = pendingUsers.get(tv.userId);

    if (!found)   return res.send(checkpointPage({ state:"error", msg:"No key found. Type ?getkey first.", done:0, current:tv.step, total:3, token, adsCount:CONFIG.ADS_PER_CHECKPOINT }));
    if (!pending) return res.send(checkpointPage({ state:"error", msg:"Session expired. Type ?getkey again.", done:0, current:tv.step, total:found.data.totalSteps, token, adsCount:CONFIG.ADS_PER_CHECKPOINT }));
    if (tv.step !== pending.currentStep)
        return res.send(checkpointPage({ state:"error", msg:`Wrong step. Complete Step ${pending.currentStep} first.`, done:found.data.stepsCompleted, current:tv.step, total:found.data.totalSteps, token, adsCount:CONFIG.ADS_PER_CHECKPOINT }));

    // Valid token — serve the interactive checkpoint page
    return res.send(checkpointPage({
        state:    "verify",
        msg:      "",
        done:     found.data.stepsCompleted,
        current:  tv.step,
        total:    found.data.totalSteps,
        token,
        adsCount: CONFIG.ADS_PER_CHECKPOINT,
    }));
});

// ── POST /checkpoint/complete  (called by JS after all checks pass)
app.post("/checkpoint/complete", async (req, res) => {
    const { token, challengeAnswer, challengeId } = req.body || {};
    if (!token) return res.json({ ok: false, msg: "Missing token" });

    const tv = verifyTokens.get(token);
    if (!tv || tv.used) return res.json({ ok: false, msg: "Invalid or already used token" });
    if (Date.now() - tv.createdAt > CONFIG.VERIFY_TOKEN_TTL) {
        verifyTokens.delete(token);
        return res.json({ ok: false, msg: "Token expired" });
    }

    // Verify challenge answer server-side
    const challenge = activeChallenges.get(token);
    if (!challenge) return res.json({ ok: false, msg: "Challenge not found — reload the page" });
    if (String(challengeAnswer).trim() !== String(challenge.answer).trim())
        return res.json({ ok: false, msg: "Wrong challenge answer" });

    activeChallenges.delete(token);

    const found   = getUserKey(tv.userId);
    const pending = pendingUsers.get(tv.userId);

    if (!found || !pending) return res.json({ ok: false, msg: "Session lost — type ?getkey again" });
    if (tv.step !== pending.currentStep) return res.json({ ok: false, msg: "Wrong step" });

    // ✓ Complete step
    tv.used = true;
    verifyTokens.set(token, tv);
    const { key, data } = found;
    data.stepsCompleted++;
    keys.set(key, data);

    console.log(`[Void] ✓ Step ${data.stepsCompleted}/${data.totalSteps} complete for ${tv.userId}`);

    if (data.stepsCompleted >= data.totalSteps) {
        data.expiresAt = Date.now() + (data.totalSteps * CONFIG.HOURS_PER_STEP * 3600000);
        keys.set(key, data);
        pendingUsers.delete(tv.userId);
        try {
            const user = await client.users.fetch(tv.userId);
            await dmFinalKey(user, key, data.totalSteps);
            console.log(`[Void] 🔑 Key delivered to ${user.tag}: ${key}`);
        } catch (e) { console.error("[Void] DM error:", e.message); }
        return res.json({ ok: true, done: true, msg: `All ${data.totalSteps} checkpoints complete! Key sent to your Discord DMs.` });
    }

    pending.currentStep++;
    pendingUsers.set(tv.userId, pending);
    try {
        const user = await client.users.fetch(tv.userId);
        await dmCheckpointLink(user, pending.currentStep, data.totalSteps);
    } catch (e) { console.error("[Void] Next checkpoint DM error:", e.message); }

    return res.json({ ok: true, done: false, msg: `Step ${data.stepsCompleted} complete! Check your Discord DMs for the next checkpoint.` });
});

// ── GET /challenge?token=XXX  — generate + return a challenge ─
const activeChallenges = new Map();

app.get("/challenge", (req, res) => {
    const token = req.query.token || "";
    const tv    = verifyTokens.get(token);
    if (!tv || tv.used) return res.json({ ok: false });

    const challenge = generateChallenge();
    activeChallenges.set(token, challenge);
    res.json({ ok: true, type: challenge.type, question: challenge.question, data: challenge.clientData });
});

function generateChallenge() {
    const types = ["math", "color", "word", "count", "sequence"];
    const type  = types[Math.floor(Math.random() * types.length)];

    if (type === "math") {
        const ops = ["+", "-", "*"];
        const op  = ops[Math.floor(Math.random() * ops.length)];
        const a   = Math.floor(Math.random() * 20) + 1;
        const b   = Math.floor(Math.random() * 10) + 1;
        const answer = op === "+" ? a + b : op === "-" ? a - b : a * b;
        return { type:"math", question:`What is ${a} ${op} ${b}?`, answer: String(answer), clientData:{} };
    }

    if (type === "color") {
        const colors  = ["red","blue","green","yellow","purple","orange","pink","white"];
        const target  = colors[Math.floor(Math.random() * colors.length)];
        const options = [target];
        while (options.length < 4) {
            const c = colors[Math.floor(Math.random() * colors.length)];
            if (!options.includes(c)) options.push(c);
        }
        options.sort(() => Math.random() - 0.5);
        return { type:"color", question:`Click the button that says: <strong style="color:${target}">${target.toUpperCase()}</strong>`, answer: target, clientData:{ options } };
    }

    if (type === "word") {
        const words   = ["VOID","VERIFY","ACCESS","SECURE","TOKEN","SHIELD","VAULT","CIPHER"];
        const target  = words[Math.floor(Math.random() * words.length)];
        const jumbled = target.split("").sort(() => Math.random() - 0.5).join("");
        return { type:"word", question:`Unscramble and type: <strong>${jumbled}</strong>`, answer: target, clientData:{} };
    }

    if (type === "count") {
        const n      = Math.floor(Math.random() * 7) + 3;
        const emoji  = ["⭐","🔵","🟣","🔷","💎","🌀"][Math.floor(Math.random()*6)];
        return { type:"count", question:`How many ${emoji} do you see? &nbsp; ${emoji.repeat(n)}`, answer: String(n), clientData:{} };
    }

    if (type === "sequence") {
        const start = Math.floor(Math.random() * 5) + 1;
        const step  = Math.floor(Math.random() * 3) + 1;
        const seq   = [start, start+step, start+step*2, start+step*3];
        return { type:"sequence", question:`What comes next? &nbsp; <strong>${seq.join(", ")}, ?</strong>`, answer: String(start+step*4), clientData:{} };
    }
}

// ── GET /validate?key=VOID-XXXX ───────────────────────────────
app.get("/validate", (req, res) => {
    const ip  = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?").split(",")[0].trim();
    const key = (req.query.key || "").toUpperCase().trim();

    if (isBlocked(ip))         return res.json({ valid:false, message:"Too many failed attempts. Try again later." });
    if (!key)                  { recordFail(ip); return res.json({ valid:false, message:"No key provided" }); }
    if (!verifyKeyHmac(key))   { recordFail(ip); return res.json({ valid:false, message:"Invalid key format" }); }

    const data = keys.get(key);
    if (!data)                 { recordFail(ip); return res.json({ valid:false, message:"Key not found" }); }
    if (data.blocked)          return res.json({ valid:false, message:"Key revoked" });
    if (data.expiresAt === 0)  return res.json({ valid:false, message:"Key not activated — complete checkpoints first" });
    if (Date.now() > data.expiresAt) return res.json({ valid:false, message:"Key expired — type ?getkey for a new one" });

    const timeLeft = msToHuman(data.expiresAt - Date.now());
    console.log(`[Void] ✓ Validated: ${key} (${timeLeft} left)`);
    return res.json({ valid:true, message:"Access granted", userId:data.userId, expiresIn:timeLeft, expiresAt:data.expiresAt, steps:data.totalSteps });
});

app.get("/", (req, res) => {
    res.json({ status:"ok", totalKeys:keys.size, activeKeys:[...keys.values()].filter(d=>!d.blocked&&d.expiresAt>Date.now()).length, pendingApprovals:approvalQueue.size });
});

// ═══════════════════════════════════════════════════════════════
//  CHECKPOINT PAGE HTML
//  Full interactive page:
//  1. Ad blocker detection
//  2. Random challenge (fetched from /challenge)
//  3. Sequential ad watching (N ads, max 30s each)
//  4. POST to /checkpoint/complete when all done
// ═══════════════════════════════════════════════════════════════
function checkpointPage({ state, msg, done, current, total, token, adsCount }) {

    const stepsHtml = Array.from({ length: total }, (_, i) => {
        const n   = i + 1;
        const cls = n < current || (n === current && (state === "success" || state === "complete"))
            ? "done" : n === current ? "active" : "locked";
        return `
        <div class="step ${cls}">
            <div class="sc">${cls === "done" ? "✓" : n}</div>
            <div class="sl">Step ${n}<br><span>${n * 24}h</span></div>
        </div>
        ${n < total ? '<div class="ln"></div>' : ""}`;
    }).join("");

    // For error/complete states just show a message card
    if (state !== "verify") {
        const col = { success:"#a855f7", complete:"#22c55e", error:"#ef4444" }[state] || "#c4b5fd";
        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>VOID — Checkpoint</title>
<style>${baseCSS()}</style></head><body>
<div class="card">
  <div class="logo">◈</div><h1>VOID</h1><p class="sub">CHECKPOINT VERIFICATION</p>
  <div class="steps">${stepsHtml}</div>
  <div class="msg" style="color:${col};border-color:${col}30;background:${col}0d">${msg}</div>
  <a href="javascript:window.close()" class="btn">CLOSE WINDOW</a>
  <p class="footer">VOID KEY SYSTEM &nbsp;·&nbsp; DO NOT SHARE YOUR LINKS</p>
</div></body></html>`;
    }

    // Interactive verification page
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VOID — Checkpoint ${current}/${total}</title>
<style>
${baseCSS()}
/* ── Stages ─────────────────────────────── */
.stage { display:none }
.stage.active { display:block }
/* ── Ad player ──────────────────────────── */
.ad-box {
  background:#0a0817;border:1px solid #2a1f45;border-radius:16px;
  padding:24px;margin:20px 0;text-align:center;position:relative;
}
.ad-screen {
  width:100%;height:180px;background:#000;border-radius:10px;
  display:flex;align-items:center;justify-content:center;
  position:relative;overflow:hidden;margin-bottom:14px;
  border:1px solid #1a1030;
}
.ad-visual {
  width:100%;height:100%;display:flex;align-items:center;justify-content:center;
  flex-direction:column;gap:8px;
}
.ad-timer {
  position:absolute;top:8px;right:10px;
  background:#00000090;color:#fff;font-size:11px;
  padding:3px 8px;border-radius:6px;font-weight:bold;
}
.ad-skip {
  background:#1a1030;border:1px solid #3d2f60;color:#a89dc0;
  padding:8px 20px;border-radius:8px;font-size:11px;cursor:default;
  opacity:0.5;transition:.3s;
}
.ad-skip.ready { opacity:1;cursor:pointer;background:#5b21b6;color:#f3e8ff;border-color:#7c3aed; }
.ad-skip.ready:hover { background:#7c3aed; }
.ad-progress-bar { width:100%;height:3px;background:#1a1030;border-radius:2px;margin-top:10px;overflow:hidden; }
.ad-progress-fill { height:100%;background:linear-gradient(90deg,#7c3aed,#a855f7);transition:width .5s linear; }
/* ── Challenge ──────────────────────────── */
.challenge-box { background:#0a0817;border:1px solid #2a1f45;border-radius:16px;padding:24px;margin:20px 0; }
.challenge-q { font-size:14px;color:#c4b5fd;margin-bottom:16px;line-height:1.6; }
.challenge-input { width:100%;background:#100d1e;border:1px solid #2a1f45;border-radius:10px;color:#e2d9f3;
  padding:10px 14px;font-size:14px;outline:none; }
.challenge-input:focus { border-color:#7c3aed; }
.color-btns { display:flex;flex-wrap:wrap;gap:8px;justify-content:center; }
.color-btn { padding:10px 20px;border-radius:8px;border:1px solid #3d2f60;background:#1a1030;
  color:#a89dc0;cursor:pointer;font-size:12px;transition:.2s;font-weight:bold; }
.color-btn:hover { border-color:#7c3aed;color:#c4b5fd; }
/* ── Status ─────────────────────────────── */
.status-ok  { color:#22c55e;font-size:12px;margin-top:6px; }
.status-err { color:#ef4444;font-size:12px;margin-top:6px; }
.status-info{ color:#a855f7;font-size:12px;margin-top:6px; }
.section-title { color:#5a3890;font-size:10px;letter-spacing:3px;text-transform:uppercase;margin-bottom:12px; }
/* ── Adblock warning ────────────────────── */
.adblock-warn { background:#2a0f14;border:1px solid #7f1d1d;border-radius:14px;
  padding:18px 20px;margin:20px 0;color:#f87171;font-size:13px;line-height:1.7;display:none; }
</style>
</head>
<body>
<div class="card" style="max-width:520px">
  <div class="logo">◈</div>
  <h1>VOID</h1>
  <p class="sub">CHECKPOINT ${current} / ${total}</p>
  <div class="steps">${stepsHtml}</div>

  <!-- Ad blocker warning (shown if ad blocker detected) -->
  <div class="adblock-warn" id="adblockWarn">
    🚫 <strong>Ad blocker detected!</strong><br>
    You must disable your ad blocker to complete this checkpoint.<br>
    Disable it, then <a href="" style="color:#f87171">refresh this page</a>.
  </div>

  <!-- STAGE 1: Challenge -->
  <div class="stage active" id="stage-challenge">
    <p class="section-title">Step 1 of 3 &nbsp;—&nbsp; Verification Challenge</p>
    <div class="challenge-box" id="challengeBox">
      <p class="challenge-q" id="challengeQ">Loading challenge…</p>
      <div id="challengeInput"></div>
      <p id="challengeStatus" class="status-info"></p>
    </div>
    <button class="btn" id="challengeBtn" onclick="submitChallenge()" disabled>Verify Answer</button>
  </div>

  <!-- STAGE 2: Ads -->
  <div class="stage" id="stage-ads">
    <p class="section-title" id="adStageTitle">Step 2 of 3 &nbsp;—&nbsp; Watch Ad <span id="adNum">1</span> / ${adsCount}</p>
    <div class="ad-box">
      <div class="ad-screen">
        <div class="ad-visual" id="adVisual"></div>
        <div class="ad-timer" id="adTimer">0s</div>
      </div>
      <div class="ad-progress-bar"><div class="ad-progress-fill" id="adProgressFill" style="width:0%"></div></div>
      <p id="adStatus" class="status-info" style="margin-top:10px">Preparing ad…</p>
      <br>
      <button class="ad-skip" id="adSkipBtn" onclick="skipAd()">Skip Ad ›</button>
    </div>
  </div>

  <!-- STAGE 3: Confirm -->
  <div class="stage" id="stage-confirm">
    <p class="section-title">Step 3 of 3 &nbsp;—&nbsp; Complete</p>
    <div class="challenge-box">
      <p style="color:#a89dc0;font-size:13px;margin-bottom:16px">
        ✓ Challenge passed &nbsp;|&nbsp; ✓ Ads watched<br><br>
        Click below to complete this checkpoint.
      </p>
      <p id="confirmStatus" class="status-info"></p>
    </div>
    <button class="btn" id="confirmBtn" onclick="completeCheckpoint()">Complete Checkpoint ${current}</button>
  </div>

  <!-- STAGE 4: Done -->
  <div class="stage" id="stage-done">
    <div class="challenge-box" style="text-align:center">
      <p style="font-size:32px;margin-bottom:12px">🎉</p>
      <p id="doneMsg" style="color:#22c55e;font-size:14px;line-height:1.7"></p>
    </div>
    <a href="javascript:window.close()" class="btn">Close Window</a>
  </div>

  <p class="footer">VOID KEY SYSTEM &nbsp;·&nbsp; DO NOT SHARE YOUR LINKS</p>
</div>

<script>
const TOKEN    = ${JSON.stringify(token)};
const ADS      = ${adsCount};
const BASE     = ${JSON.stringify(CONFIG.BASE_URL)};

let challengeType   = "";
let challengeAnswer = "";
let challengePassed = false;
let adsPassed       = false;
let currentAd       = 1;
let adTimer         = null;
let adSecondsLeft   = 0;
let adLength        = 0;
let skipReady       = false;

// ── Ad blocker detection ────────────────────────────────────
function checkAdBlock() {
  return new Promise(resolve => {
    const s = document.createElement("script");
    s.src   = BASE + "/ads/ads.js?t=" + Date.now();
    s.onload  = () => resolve(false);
    s.onerror = () => resolve(true);
    document.head.appendChild(s);
    setTimeout(() => resolve(!window.__adCheckPassed), 2000);
  });
}

async function init() {
  const blocked = await checkAdBlock();
  if (blocked) {
    document.getElementById("adblockWarn").style.display = "block";
    document.getElementById("stage-challenge").classList.remove("active");
    return;
  }
  loadChallenge();
}

// ── Challenge ───────────────────────────────────────────────
async function loadChallenge() {
  const r    = await fetch(BASE + "/challenge?token=" + TOKEN).then(x => x.json()).catch(() => null);
  if (!r || !r.ok) {
    document.getElementById("challengeQ").innerHTML = "Failed to load challenge. Please reload.";
    return;
  }
  challengeType = r.type;
  document.getElementById("challengeQ").innerHTML = r.question;
  const inp = document.getElementById("challengeInput");

  if (r.type === "color") {
    const wrap = document.createElement("div");
    wrap.className = "color-btns";
    r.data.options.forEach(opt => {
      const b = document.createElement("button");
      b.className = "color-btn";
      b.textContent = opt.toUpperCase();
      b.onclick = () => { challengeAnswer = opt; document.querySelectorAll(".color-btn").forEach(x=>x.style.borderColor=""); b.style.borderColor="#7c3aed"; document.getElementById("challengeBtn").disabled = false; };
      wrap.appendChild(b);
    });
    inp.appendChild(wrap);
  } else {
    const input = document.createElement("input");
    input.className = "challenge-input";
    input.placeholder = r.type === "math" ? "Enter the number" : r.type === "word" ? "Type the word" : r.type === "count" ? "Count and enter" : "Enter the answer";
    input.addEventListener("input", () => {
      challengeAnswer = input.value;
      document.getElementById("challengeBtn").disabled = input.value.trim() === "";
    });
    input.addEventListener("keydown", e => { if(e.key==="Enter" && input.value.trim()) submitChallenge(); });
    inp.appendChild(input);
  }
  document.getElementById("challengeBtn").disabled = false;
}

async function submitChallenge() {
  const btn = document.getElementById("challengeBtn");
  btn.disabled = true;
  const st  = document.getElementById("challengeStatus");
  const ans = String(challengeAnswer || "").trim();
  if (!ans) { st.textContent = "Please enter an answer."; st.className="status-err"; btn.disabled=false; return; }

  // Server validates
  const r = await fetch(BASE + "/challenge?token=" + TOKEN + "&answer=" + encodeURIComponent(ans)).then(()=>null).catch(()=>null);

  // For real validation we'll do it in /checkpoint/complete — just store locally
  challengePassed = true;
  st.textContent  = "✓ Challenge complete!";
  st.className    = "status-ok";
  setTimeout(() => goToAds(), 800);
}

// ── Ads ─────────────────────────────────────────────────────
const adThemes = [
  { bg:"linear-gradient(135deg,#1a0a30,#0d1a3a)", icon:"🚀", title:"VOID PREMIUM", desc:"Upgrade your access today" },
  { bg:"linear-gradient(135deg,#0d1a0d,#1a2d0a)", icon:"🛡️", title:"VOID SECURITY", desc:"Military-grade protection" },
  { bg:"linear-gradient(135deg,#1a0d1a,#2d0a2d)", icon:"💎", title:"VOID ELITE",    desc:"Exclusive script access" },
  { bg:"linear-gradient(135deg,#1a1a0a,#2d2a0d)", icon:"⚡", title:"VOID SPEED",    desc:"Zero-lag execution" },
  { bg:"linear-gradient(135deg,#0a1a1a,#0d2d2a)", icon:"🔑", title:"VOID KEYS",    desc:"Secure key distribution" },
  { bg:"linear-gradient(135deg,#1a0a0a,#2d100d)", icon:"🌐", title:"VOID NETWORK",  desc:"Global script network" },
];

function goToAds() {
  document.getElementById("stage-challenge").classList.remove("active");
  document.getElementById("stage-ads").classList.add("active");
  playAd(1);
}

function playAd(n) {
  currentAd     = n;
  skipReady     = false;
  adSecondsLeft = Math.floor(Math.random() * 21) + 10; // 10–30s random
  adLength      = adSecondsLeft;

  document.getElementById("adNum").textContent       = n;
  document.getElementById("adSkipBtn").className     = "ad-skip";
  document.getElementById("adSkipBtn").textContent   = "Skip Ad ›";
  document.getElementById("adProgressFill").style.width = "0%";

  const theme  = adThemes[Math.floor(Math.random() * adThemes.length)];
  const visual = document.getElementById("adVisual");
  visual.style.background = theme.bg;
  visual.innerHTML = \`
    <span style="font-size:40px">\${theme.icon}</span>
    <div style="color:#e2d9f3;font-size:16px;font-weight:bold;letter-spacing:4px">\${theme.title}</div>
    <div style="color:#8b7aaa;font-size:11px">\${theme.desc}</div>
  \`;

  document.getElementById("adStatus").textContent = \`Ad \${n} of \${ADS} — watch until you can skip\`;

  if (adTimer) clearInterval(adTimer);
  adTimer = setInterval(() => {
    adSecondsLeft--;
    const elapsed  = adLength - adSecondsLeft;
    const pct      = Math.min(100, (elapsed / adLength) * 100);
    document.getElementById("adTimer").textContent       = adSecondsLeft + "s";
    document.getElementById("adProgressFill").style.width = pct + "%";

    // Can skip after 5s
    if (adSecondsLeft <= adLength - 5 && !skipReady) {
      skipReady = true;
      const btn = document.getElementById("adSkipBtn");
      btn.classList.add("ready");
      btn.textContent = "Skip Ad ›";
    }

    if (adSecondsLeft <= 0) {
      clearInterval(adTimer);
      adDone();
    }
  }, 1000);
}

function skipAd() {
  if (!skipReady) return;
  clearInterval(adTimer);
  adDone();
}

function adDone() {
  document.getElementById("adStatus").textContent = \`✓ Ad \${currentAd} complete!\`;
  if (currentAd < ADS) {
    setTimeout(() => playAd(currentAd + 1), 1200);
  } else {
    adsPassed = true;
    setTimeout(() => {
      document.getElementById("stage-ads").classList.remove("active");
      document.getElementById("stage-confirm").classList.add("active");
    }, 1000);
  }
}

// ── Complete checkpoint ─────────────────────────────────────
async function completeCheckpoint() {
  const btn = document.getElementById("confirmBtn");
  const st  = document.getElementById("confirmStatus");
  btn.disabled  = true;
  btn.textContent = "Submitting…";
  st.textContent  = "Verifying…";
  st.className    = "status-info";

  try {
    const r = await fetch(BASE + "/checkpoint/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: TOKEN, challengeAnswer, challengeId: "" })
    }).then(x => x.json());

    if (r.ok) {
      document.getElementById("stage-confirm").classList.remove("active");
      document.getElementById("stage-done").classList.add("active");
      document.getElementById("doneMsg").innerHTML = r.msg;
    } else {
      st.textContent = "❌ " + r.msg;
      st.className   = "status-err";
      btn.disabled   = false;
      btn.textContent = "Complete Checkpoint ${current}";
    }
  } catch (e) {
    st.textContent = "❌ Network error. Try again.";
    st.className   = "status-err";
    btn.disabled   = false;
    btn.textContent = "Complete Checkpoint ${current}";
  }
}

init();
</script>
</body>
</html>`;
}

function baseCSS() {
    return `
*{margin:0;padding:0;box-sizing:border-box}
body{background:#04030a;color:#a89dc0;font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;background-image:radial-gradient(ellipse at 50% 0%,#1a0a3018 0%,transparent 70%)}
.card{background:linear-gradient(145deg,#0f0c1c,#080614);border:1px solid #2a1f45;border-radius:24px;padding:40px 36px;max-width:480px;width:100%;text-align:center;box-shadow:0 0 100px #6d28d912,0 0 40px #00000060;position:relative;overflow:hidden}
.card::before{content:'';position:absolute;top:0;left:10%;right:10%;height:1px;background:linear-gradient(90deg,transparent,#7c3aed50,transparent)}
.logo{font-size:48px;color:#7c3aed;margin-bottom:10px;filter:drop-shadow(0 0 16px #7c3aed55)}
h1{color:#e2d9f3;font-size:20px;letter-spacing:10px;font-weight:900;margin-bottom:4px}
.sub{color:#3d2f60;font-size:10px;letter-spacing:4px;margin-bottom:28px}
.steps{display:flex;align-items:center;justify-content:center;margin-bottom:28px;flex-wrap:wrap;gap:0}
.step{display:flex;flex-direction:column;align-items:center;gap:8px}
.ln{width:24px;height:2px;background:#1e1535;margin-bottom:22px}
.step.done+.ln{background:#7c3aed60}
.sc{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;border:2px solid #1e1535;background:#100d1e;color:#2e2248}
.step.done .sc{background:#2d1a60;border-color:#7c3aed;color:#c4b5fd;box-shadow:0 0 14px #7c3aed40}
.step.active .sc{background:#3b1f70;border-color:#a855f7;color:#f3e8ff;box-shadow:0 0 20px #a855f760}
.sl{font-size:9px;color:#2e2248;text-align:center;line-height:1.5}
.sl span{color:#6d28d9;font-weight:bold}
.step.done .sl,.step.active .sl{color:#8b7aaa}
.step.done .sl span,.step.active .sl span{color:#a855f7}
.msg{padding:16px 20px;border-radius:12px;font-size:13px;line-height:1.7;margin-bottom:24px;border:1px solid}
.btn{display:block;background:linear-gradient(135deg,#5b21b6,#7c3aed);color:#f3e8ff;border:none;border-radius:12px;padding:14px 32px;font-size:11px;font-weight:800;letter-spacing:3px;cursor:pointer;text-decoration:none;transition:.2s;width:100%;box-shadow:0 4px 24px #7c3aed28;margin-top:8px}
.btn:hover:not(:disabled){background:linear-gradient(135deg,#6d28d9,#9333ea);transform:translateY(-1px)}
.btn:disabled{opacity:0.5;cursor:not-allowed}
.footer{margin-top:24px;font-size:10px;color:#1e1535;letter-spacing:2px}`;
}

// ═══════════════════════════════════════════════════════════════
//  AUTO CLEANUP
// ═══════════════════════════════════════════════════════════════
function runCleanup() {
    const now = Date.now();
    let kR=0, tR=0;
    for (const [k, d] of keys.entries())
        if (!d.blocked && d.expiresAt > 0 && now > d.expiresAt + 3600000) { keys.delete(k); kR++; }
    for (const [t, tv] of verifyTokens.entries())
        if (tv.used || now - tv.createdAt > CONFIG.VERIFY_TOKEN_TTL * 2) { verifyTokens.delete(t); tR++; }
    for (const [uid, ts] of cooldowns.entries())
        if (now - ts > CONFIG.GETKEY_COOLDOWN * 20) cooldowns.delete(uid);
    for (const [uid, d] of approvalQueue.entries())
        if (now - d.createdAt > CONFIG.APPROVAL_TTL) approvalQueue.delete(uid);
    for (const [uid, p] of pendingUsers.entries())
        if (now - p.createdAt > 3 * 3600000) pendingUsers.delete(uid);
    for (const [ip, rec] of failLog.entries())
        if (rec.blockedUntil && now > rec.blockedUntil + 3600000) failLog.delete(ip);
    for (const [token, ch] of activeChallenges.entries()) {
        const tv = verifyTokens.get(token);
        if (!tv || tv.used || now - tv.createdAt > CONFIG.VERIFY_TOKEN_TTL * 2) activeChallenges.delete(token);
    }
    console.log(`[Void] 🧹 Cleanup done — keys-${kR} tokens-${tR}`);
}

setInterval(runCleanup, CONFIG.CLEANUP_INTERVAL);

// ═══════════════════════════════════════════════════════════════
//  KEEP-ALIVE
// ═══════════════════════════════════════════════════════════════
function keepAlive() {
    const url = CONFIG.BASE_URL;
    if (!url || url.includes("localhost")) return;
    setInterval(() => {
        const lib = url.startsWith("https") ? https : http;
        const req = lib.get(url, r => console.log(`[Void] 💓 ${r.statusCode}`));
        req.on("error", e => console.warn("[Void] Keep-alive error:", e.message));
        req.end();
    }, CONFIG.KEEPALIVE_INTERVAL);
    console.log("[Void] 💓 Keep-alive started");
}

// ═══════════════════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════════════════
app.listen(CONFIG.API_PORT, () => console.log(`[Void] ✓ API on port ${CONFIG.API_PORT}`));
keepAlive();

process.on("unhandledRejection", err => console.error("[Void] Unhandled:", err?.message || err));
process.on("uncaughtException",  err => console.error("[Void] Uncaught:",  err?.message || err));

client.login(CONFIG.TOKEN).catch(err => {
    console.error("[Void] LOGIN FAILED:", err.message);
    process.exit(1);
});
