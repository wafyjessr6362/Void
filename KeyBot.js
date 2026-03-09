/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║               V O I D   K E Y   S Y S T E M                    ║
 * ║          Ultimate Discord Bot + Validation API v3.0             ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  FEATURES:                                                      ║
 * ║  • Manual 0/1 verification — admin approves every request       ║
 * ║  • ?getkey → queued → admin approves → user picks steps         ║
 * ║  • Sequential checkpoints — key hidden until all done           ║
 * ║  • HMAC-signed keys — fakes rejected instantly                  ║
 * ║  • Rate limiting — anti-bot IP blocking                         ║
 * ║  • Auto keep-alive — never sleeps on Render free tier           ║
 * ║  • Auto cleanup — expired data removed hourly                   ║
 * ║  • /removemessage <link> — delete any message by link           ║
 * ║  • ?removekey @User — remove a user's key in channel            ║
 * ║  • Full admin DM commands with !help                            ║
 * ║  • Spam cooldown + duplicate request prevention                 ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  ENV VARIABLES (Render → Environment):                          ║
 * ║  BOT_TOKEN             Discord bot token                        ║
 * ║  GUILD_ID              Your Discord server ID                   ║
 * ║  GET_KEY_CHANNEL_ID    Channel where users type ?getkey         ║
 * ║  ADMIN_CHANNEL_ID      Channel where approval requests appear   ║
 * ║  KEY_SECRET            Any long random string (signs keys)      ║
 * ║  BASE_URL              https://your-service.onrender.com        ║
 * ║  API_SECRET            Optional header auth for /validate       ║
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
    ADMIN_CHANNEL_ID:   process.env.ADMIN_CHANNEL_ID,   // where approve/deny cards appear
    GUILD_ID:           process.env.GUILD_ID,
    KEY_SECRET:         process.env.KEY_SECRET  || "change_this_secret",
    API_SECRET:         process.env.API_SECRET  || "",
    API_PORT:           process.env.PORT         || 3000,
    BASE_URL:           process.env.BASE_URL     || "https://void-r3co.onrender.com",

    // Key format
    KEY_PREFIX:    "VOID",
    KEY_SEGMENTS:  3,
    KEY_SEG_LEN:   4,

    // Verification
    HOURS_PER_STEP:     24,
    MAX_STEPS:          3,

    // Timers
    VERIFY_TOKEN_TTL:   15 * 60 * 1000,
    GETKEY_COOLDOWN:    30 * 1000,
    CLEANUP_INTERVAL:   60 * 60 * 1000,
    KEEPALIVE_INTERVAL: 10 * 60 * 1000,
    APPROVAL_TTL:       30 * 60 * 1000,   // approval request expires in 30 min

    // Anti-bot
    MAX_FAIL_ATTEMPTS:  5,
    FAIL_WINDOW_MS:     10 * 60 * 1000,
    BLOCK_DURATION_MS:  60 * 60 * 1000,
};

// ═══════════════════════════════════════════════════════════════
//  STARTUP VALIDATION
// ═══════════════════════════════════════════════════════════════
console.log("╔══════════════════════════════════════╗");
console.log("║    VOID KEY SYSTEM  v3.0  STARTING   ║");
console.log("╚══════════════════════════════════════╝");
console.log(`[Void] BOT_TOKEN          : ${CONFIG.TOKEN              ? "✓" : "✗ MISSING"}`);
console.log(`[Void] GUILD_ID           : ${CONFIG.GUILD_ID           ? "✓" : "✗ MISSING"}`);
console.log(`[Void] GET_KEY_CHANNEL_ID : ${CONFIG.GET_KEY_CHANNEL_ID ? "✓" : "✗ MISSING"}`);
console.log(`[Void] ADMIN_CHANNEL_ID   : ${CONFIG.ADMIN_CHANNEL_ID   ? "✓" : "⚠ not set (using owner DMs)"}`);
console.log(`[Void] BASE_URL           : ${CONFIG.BASE_URL}`);

if (!CONFIG.TOKEN)              { console.error("[Void] FATAL: BOT_TOKEN missing!");          process.exit(1); }
if (!CONFIG.GUILD_ID)           { console.error("[Void] FATAL: GUILD_ID missing!");           process.exit(1); }
if (!CONFIG.GET_KEY_CHANNEL_ID) { console.error("[Void] FATAL: GET_KEY_CHANNEL_ID missing!"); process.exit(1); }

// ═══════════════════════════════════════════════════════════════
//  STORAGE
// ═══════════════════════════════════════════════════════════════
const keys          = new Map();   // keyString → KeyData
const pendingUsers  = new Map();   // userId    → PendingData
const verifyTokens  = new Map();   // token     → TokenData
const cooldowns     = new Map();   // userId    → timestamp
const failLog       = new Map();   // ip        → FailData
const approvalQueue = new Map();   // userId    → ApprovalData  (awaiting admin 0/1)
const approvalMsgs  = new Map();   // messageId → userId        (admin card → user lookup)

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
//  UTILITY HELPERS
// ═══════════════════════════════════════════════════════════════
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
    return last && Date.now() - last < CONFIG.GETKEY_COOLDOWN;
}

function setCooldown(userId) { cooldowns.set(userId, Date.now()); }

function recordFail(ip) {
    const now = Date.now();
    const rec = failLog.get(ip) || { count: 0, firstFail: now, blockedUntil: 0 };
    if (now - rec.firstFail > CONFIG.FAIL_WINDOW_MS) { rec.count = 0; rec.firstFail = now; }
    rec.count++;
    if (rec.count >= CONFIG.MAX_FAIL_ATTEMPTS) {
        rec.blockedUntil = now + CONFIG.BLOCK_DURATION_MS;
        console.warn(`[Void] IP blocked: ${ip} (${rec.count} failures)`);
    }
    failLog.set(ip, rec);
}

function isBlocked(ip) {
    const rec = failLog.get(ip);
    return !!(rec?.blockedUntil && Date.now() < rec.blockedUntil);
}

// Parse a Discord message link into { guildId, channelId, messageId }
function parseMessageLink(link) {
    const match = link.match(/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
    if (!match) return null;
    return { guildId: match[1], channelId: match[2], messageId: match[3] };
}

// ═══════════════════════════════════════════════════════════════
//  DM BUILDERS
// ═══════════════════════════════════════════════════════════════
async function dmStepSelector(user) {
    const embed = new EmbedBuilder()
        .setColor(0x6d28d9)
        .setTitle("◈  VOID Key System — Request Approved")
        .setDescription(
            "Your request has been **approved** ✓\n\n" +
            "Now choose how many verification steps you want.\n" +
            "**More steps = longer key access.**\n" +
            "Your key will only be revealed after completing **all** chosen steps."
        )
        .addFields(
            { name: "1️⃣  1 Step",  value: "Complete **1** checkpoint  →  **24h** access"  },
            { name: "2️⃣  2 Steps", value: "Complete **2** checkpoints →  **48h** access" },
            { name: "3️⃣  3 Steps", value: "Complete **3** checkpoints →  **72h** access" },
        )
        .setFooter({ text: "VOID Key System · Select your steps below" })
        .setTimestamp();

    const menu = new StringSelectMenuBuilder()
        .setCustomId(`stepselect_${user.id}`)
        .setPlaceholder("🔑  Choose your verification steps...")
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel("1 Step — 24 Hours").setDescription("1 checkpoint · 24h key").setValue("1").setEmoji("1️⃣"),
            new StringSelectMenuOptionBuilder()
                .setLabel("2 Steps — 48 Hours").setDescription("2 checkpoints · 48h key").setValue("2").setEmoji("2️⃣"),
            new StringSelectMenuOptionBuilder()
                .setLabel("3 Steps — 72 Hours").setDescription("3 checkpoints · 72h key").setValue("3").setEmoji("3️⃣"),
        );

    await user.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
}

async function dmCheckpointLink(user, step, totalSteps) {
    const token      = generateToken(user.id, step);
    const link       = `${CONFIG.BASE_URL}/checkpoint?token=${token}`;
    const totalHours = totalSteps * CONFIG.HOURS_PER_STEP;

    const embed = new EmbedBuilder()
        .setColor(0x6d28d9)
        .setTitle(`◈  Checkpoint ${step} of ${totalSteps}`)
        .setDescription(
            `Click the button below to complete **Checkpoint ${step}**.\n\n` +
            `After all **${totalSteps}** checkpoints your key will be sent — valid for **${totalHours}h**.`
        )
        .addFields(
            { name: "📍 Progress",     value: progressBar(step - 1, totalSteps) },
            { name: "⏱ Link Valid For", value: "**15 minutes**",        inline: true },
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
            { name: "🔑 License Key",   value: `\`\`\`${key}\`\`\`` },
            { name: "📍 Checkpoints",   value: progressBar(totalSteps, totalSteps) },
            { name: "⏳ Valid For",      value: `**${totalHours} hours**`,         inline: true },
            { name: "🔒 Verified",       value: `**${totalSteps}-Step**`,           inline: true },
            { name: "⚠️ Important",     value: "**Never share this key.** It is permanently tied to your Discord account." }
        )
        .setFooter({ text: "VOID Key System · Keep this safe" })
        .setTimestamp();

    await user.send({ embeds: [embed] });
}

// ═══════════════════════════════════════════════════════════════
//  ADMIN APPROVAL CARD
//  Sends approve/deny card to ADMIN_CHANNEL_ID (or owner DM)
// ═══════════════════════════════════════════════════════════════
async function sendApprovalCard(guild, requestUser) {
    const embed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("◈  Key Request — Pending Approval")
        .setDescription(`<@${requestUser.id}> has requested a key.`)
        .addFields(
            { name: "👤 User",    value: `${requestUser.tag}`,         inline: true },
            { name: "🆔 User ID", value: `\`${requestUser.id}\``,      inline: true },
            { name: "📋 Status",  value: "⏳ Awaiting admin decision" },
            { name: "⏱ Expires", value: "This request expires in **30 minutes**" }
        )
        .setThumbnail(requestUser.displayAvatarURL())
        .setFooter({ text: "Click Approve or Deny below" })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`approve_${requestUser.id}`)
            .setLabel("  Approve")
            .setStyle(ButtonStyle.Success)
            .setEmoji("✅"),
        new ButtonBuilder()
            .setCustomId(`deny_${requestUser.id}`)
            .setLabel("  Deny")
            .setStyle(ButtonStyle.Danger)
            .setEmoji("❌"),
    );

    let sent = null;

    // Try admin channel first
    if (CONFIG.ADMIN_CHANNEL_ID) {
        try {
            const ch = await guild.channels.fetch(CONFIG.ADMIN_CHANNEL_ID);
            if (ch) sent = await ch.send({ embeds: [embed], components: [row] });
        } catch (e) {
            console.warn("[Void] Could not send to ADMIN_CHANNEL_ID:", e.message);
        }
    }

    // Fallback: DM the server owner
    if (!sent) {
        try {
            const owner = await guild.fetchOwner();
            sent = await owner.send({ embeds: [embed], components: [row] });
        } catch (e) {
            console.error("[Void] Could not DM owner:", e.message);
        }
    }

    if (sent) {
        approvalMsgs.set(sent.id, requestUser.id);
        approvalQueue.set(requestUser.id, {
            createdAt:  Date.now(),
            messageId:  sent.id,
            channelId:  sent.channelId,
        });
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
    console.log(`[Void] ✓ Serving ${client.guilds.cache.size} guild(s)`);
    client.user.setActivity("?getkey", { type: 3 });
    await registerSlashCommands();
});

client.on("error", (err) => console.error("[Void] Client error:", err.message));

// ═══════════════════════════════════════════════════════════════
//  REGISTER SLASH COMMANDS
// ═══════════════════════════════════════════════════════════════
async function registerSlashCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName("removemessage")
            .setDescription("Delete a message by its link")
            .addStringOption(opt =>
                opt.setName("link")
                    .setDescription("The full Discord message link")
                    .setRequired(true)
            )
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
            .toJSON(),

        new SlashCommandBuilder()
            .setName("rm")
            .setDescription("Delete a message by its link (alias for /removemessage)")
            .addStringOption(opt =>
                opt.setName("link")
                    .setDescription("The full Discord message link")
                    .setRequired(true)
            )
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
            .toJSON(),
    ];

    try {
        const rest = new REST({ version: "10" }).setToken(CONFIG.TOKEN);
        await rest.put(Routes.applicationGuildCommands(client.user.id, CONFIG.GUILD_ID), { body: commands });
        console.log("[Void] ✓ Slash commands registered: /removemessage, /rm");
    } catch (e) {
        console.error("[Void] Failed to register slash commands:", e.message);
    }
}

// ═══════════════════════════════════════════════════════════════
//  ?getkey COMMAND
// ═══════════════════════════════════════════════════════════════
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (message.channelId !== CONFIG.GET_KEY_CHANNEL_ID) return;

    const content = message.content.trim().toLowerCase();

    // ── ?removekey @User ─────────────────────────────────────
    if (content.startsWith("?removekey")) {
        try { await message.delete(); } catch {}

        const guild = await client.guilds.fetch(CONFIG.GUILD_ID).catch(() => null);
        if (!guild || message.author.id !== guild.ownerId) {
            const w = await message.channel.send(`<@${message.author.id}> ❌ Only the server owner can use \`?removekey\`.`);
            setTimeout(() => w.delete().catch(() => {}), 5000);
            return;
        }

        const mentioned = message.mentions.users.first();
        if (!mentioned) {
            const w = await message.channel.send(`<@${message.author.id}> ❌ Usage: \`?removekey @User\``);
            setTimeout(() => w.delete().catch(() => {}), 6000);
            return;
        }

        let removed = 0;
        for (const [k, d] of keys.entries()) {
            if (d.userId === mentioned.id) { keys.delete(k); removed++; }
        }
        pendingUsers.delete(mentioned.id);
        cooldowns.delete(mentioned.id);
        approvalQueue.delete(mentioned.id);

        if (removed > 0) {
            console.log(`[Void] Removed ${removed} key(s) for ${mentioned.tag}`);
            const w = await message.channel.send(`✓  Removed **${removed}** key(s) for <@${mentioned.id}>.`);
            setTimeout(() => w.delete().catch(() => {}), 6000);
            try {
                await mentioned.send({ embeds: [new EmbedBuilder()
                    .setColor(0xef4444)
                    .setTitle("◈  Key Removed")
                    .setDescription("Your key has been removed by the server owner.\nType `?getkey` to request a new one.")
                    .setTimestamp()
                ]});
            } catch {}
        } else {
            const w = await message.channel.send(`❌  No active keys found for <@${mentioned.id}>.`);
            setTimeout(() => w.delete().catch(() => {}), 6000);
        }
        return;
    }

    // ── ?getkey ───────────────────────────────────────────────
    if (content !== "?getkey") return;
    try { await message.delete(); } catch {}

    const user  = message.author;
    const found = getUserKey(user.id);

    // Already has active key
    if (found && found.data.expiresAt > Date.now()) {
        try {
            const tl = msToHuman(found.data.expiresAt - Date.now());
            await user.send({ embeds: [new EmbedBuilder()
                .setColor(0x6d28d9)
                .setTitle("◈  Active Key Found")
                .setDescription("You already have an active key.")
                .addFields(
                    { name: "🔑 Key",     value: `\`\`\`${found.key}\`\`\`` },
                    { name: "⏳ Expires", value: `in **${tl}**`             }
                )
                .setFooter({ text: "Do not share your key." })
                .setTimestamp()
            ]});
        } catch {}
        const w = await message.channel.send(`<@${user.id}> ✓ Check your DMs!`);
        setTimeout(() => w.delete().catch(() => {}), 5000);
        return;
    }

    // Cooldown
    if (isOnCooldown(user.id)) {
        const w = await message.channel.send(`<@${user.id}> ⏱ Please wait before using \`?getkey\` again.`);
        setTimeout(() => w.delete().catch(() => {}), 5000);
        return;
    }
    setCooldown(user.id);

    // Already pending approval
    if (approvalQueue.has(user.id)) {
        const w = await message.channel.send(`<@${user.id}> ⏳ Your request is already pending admin approval.`);
        setTimeout(() => w.delete().catch(() => {}), 6000);
        return;
    }

    // Mid-verification — resend current checkpoint
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

    // Queue for admin approval
    try {
        const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
        await sendApprovalCard(guild, user);

        await user.send({ embeds: [new EmbedBuilder()
            .setColor(0xf59e0b)
            .setTitle("◈  Request Submitted")
            .setDescription(
                "Your key request has been submitted for **admin approval**.\n\n" +
                "You will receive a DM once it has been reviewed.\n" +
                "This usually takes a few minutes."
            )
            .setFooter({ text: "VOID Key System · Please wait" })
            .setTimestamp()
        ]});

        const w = await message.channel.send(`<@${user.id}> ✓ Request submitted — check your DMs!`);
        setTimeout(() => w.delete().catch(() => {}), 5000);
        console.log(`[Void] Key request queued for ${user.tag}`);

    } catch (e) {
        console.error("[Void] Could not process request:", e.message);
        const w = await message.channel.send(`<@${user.id}> ❌ Enable DMs from server members and try again.`);
        setTimeout(() => w.delete().catch(() => {}), 8000);
    }
});

// ═══════════════════════════════════════════════════════════════
//  INTERACTION HANDLER
//  Handles: approve/deny buttons, step selector dropdown,
//           /removemessage slash, /rm slash
// ═══════════════════════════════════════════════════════════════
client.on(Events.InteractionCreate, async (interaction) => {

    // ── /removemessage  and  /rm ─────────────────────────────
    if (interaction.isChatInputCommand() &&
        (interaction.commandName === "removemessage" || interaction.commandName === "rm")) {

        await interaction.deferReply({ ephemeral: true });

        const link   = interaction.options.getString("link");
        const parsed = parseMessageLink(link);

        if (!parsed) {
            return interaction.editReply({ content: "❌ Invalid message link. Use a full Discord message URL." });
        }

        if (parsed.guildId !== CONFIG.GUILD_ID) {
            return interaction.editReply({ content: "❌ That message is not from this server." });
        }

        try {
            const channel = await client.channels.fetch(parsed.channelId);
            if (!channel) return interaction.editReply({ content: "❌ Channel not found." });

            const msg = await channel.messages.fetch(parsed.messageId);
            if (!msg) return interaction.editReply({ content: "❌ Message not found." });

            await msg.delete();
            console.log(`[Void] Message ${parsed.messageId} deleted by ${interaction.user.tag}`);
            return interaction.editReply({ content: "✓ Message deleted." });

        } catch (e) {
            console.error("[Void] /removemessage error:", e.message);
            return interaction.editReply({ content: `❌ Failed to delete: ${e.message}` });
        }
    }

    // ── Approve / Deny buttons ───────────────────────────────
    if (interaction.isButton()) {
        const id = interaction.customId;

        if (id.startsWith("approve_") || id.startsWith("deny_")) {
            const targetUserId = id.replace("approve_", "").replace("deny_", "");
            const isApprove    = id.startsWith("approve_");

            // Update the card
            const newEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(isApprove ? 0x22c55e : 0xef4444)
                .spliceFields(2, 1, {
                    name:  "📋 Status",
                    value: isApprove
                        ? `✅ Approved by ${interaction.user.tag}`
                        : `❌ Denied by ${interaction.user.tag}`,
                });

            await interaction.update({ embeds: [newEmbed], components: [] }).catch(() => {});

            // Remove from approval queue
            approvalQueue.delete(targetUserId);
            approvalMsgs.delete(interaction.message.id);

            let targetUser = null;
            try { targetUser = await client.users.fetch(targetUserId); } catch {}

            if (!targetUser) return;

            if (isApprove) {
                console.log(`[Void] ✓ Approved: ${targetUser.tag}`);
                try {
                    await dmStepSelector(targetUser);
                } catch (e) {
                    console.error("[Void] Could not DM step selector:", e.message);
                }
            } else {
                console.log(`[Void] ✗ Denied: ${targetUser.tag}`);
                try {
                    await targetUser.send({ embeds: [new EmbedBuilder()
                        .setColor(0xef4444)
                        .setTitle("◈  Request Denied")
                        .setDescription(
                            "Your key request has been **denied** by the admin.\n\n" +
                            "If you believe this is a mistake, please contact a server admin."
                        )
                        .setTimestamp()
                    ]});
                } catch {}
            }
            return;
        }
    }

    // ── Step selector dropdown ───────────────────────────────
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("stepselect_")) {
        const userId = interaction.customId.replace("stepselect_", "");
        const user   = interaction.user;

        if (user.id !== userId) {
            return interaction.reply({ content: "❌ This menu is not for you.", ephemeral: true });
        }

        const totalSteps = parseInt(interaction.values[0]);
        const totalHours = totalSteps * CONFIG.HOURS_PER_STEP;

        await interaction.update({
            embeds: [new EmbedBuilder()
                .setColor(0x6d28d9)
                .setTitle("◈  Steps Confirmed")
                .setDescription(
                    `You chose **${totalSteps} step${totalSteps > 1 ? "s" : ""}** → **${totalHours}h** access.\n\n` +
                    `Complete all ${totalSteps} checkpoint${totalSteps > 1 ? "s" : ""} and your key will be sent automatically.\n\n` +
                    `Your first checkpoint link is coming. ↓`
                )
                .setFooter({ text: "Do not share your checkpoint links." })
                .setTimestamp()
            ],
            components: []
        });

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

        console.log(`[Void] ${user.tag} chose ${totalSteps} steps — key: ${newKey}`);

        try {
            await dmCheckpointLink(user, 1, totalSteps);
        } catch (e) {
            console.error("[Void] Could not send checkpoint:", e.message);
        }
    }
});

// ═══════════════════════════════════════════════════════════════
//  ADMIN DM COMMANDS  (server owner only)
// ═══════════════════════════════════════════════════════════════
client.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;
    if (msg.channel.type !== 1) return;

    const guild = await client.guilds.fetch(CONFIG.GUILD_ID).catch(() => null);
    if (!guild || msg.author.id !== guild.ownerId) return;

    const args = msg.content.trim().split(/\s+/);
    const cmd  = args[0]?.toLowerCase();

    // ── !help ─────────────────────────────────────────────────
    if (cmd === "!help") {
        await msg.reply(
            "```\n" +
            "VOID KEY SYSTEM — ADMIN COMMANDS\n" +
            "══════════════════════════════════\n\n" +
            "IN #get-key CHANNEL:\n" +
            "  ?getkey               — Request a key (all users)\n" +
            "  ?removekey @User      — Remove a user's key (owner only)\n\n" +
            "VIA DM TO BOT (owner only):\n" +
            "  !help                 — Show this menu\n" +
            "  !stats                — Show key statistics\n" +
            "  !listkeys             — List all keys and status\n" +
            "  !pending              — Show pending approval requests\n" +
            "  !approve <userId>     — Manually approve a user\n" +
            "  !deny <userId>        — Manually deny a user\n" +
            "  !revoke <key>         — Permanently revoke a key\n" +
            "  !reset <userId>       — Wipe all data for a user\n" +
            "  !unblock <ip>         — Unblock a rate-limited IP\n\n" +
            "SLASH COMMANDS (in server):\n" +
            "  /removemessage <link> — Delete a message by link\n" +
            "  /rm <link>            — Same as above (short alias)\n" +
            "```"
        );
        return;
    }

    // ── !stats ────────────────────────────────────────────────
    if (cmd === "!stats") {
        const total   = keys.size;
        const active  = [...keys.values()].filter(d => !d.blocked && d.expiresAt > Date.now()).length;
        const pending = [...keys.values()].filter(d => d.expiresAt === 0 && !d.blocked).length;
        const expired = [...keys.values()].filter(d => d.expiresAt > 0 && Date.now() > d.expiresAt).length;
        const revoked = [...keys.values()].filter(d => d.blocked).length;
        await msg.reply(
            "```\n" +
            "VOID KEY STATS\n" +
            "══════════════\n" +
            `Total keys     : ${total}\n` +
            `Active         : ${active}\n` +
            `Pending steps  : ${pending}\n` +
            `Expired        : ${expired}\n` +
            `Revoked        : ${revoked}\n` +
            `Awaiting appr. : ${approvalQueue.size}\n` +
            `Pending users  : ${pendingUsers.size}\n` +
            "```"
        );
        return;
    }

    // ── !listkeys ─────────────────────────────────────────────
    if (cmd === "!listkeys") {
        if (keys.size === 0) return msg.reply("No keys in store.");
        let out = `**Keys (${keys.size} total):**\n`;
        for (const [k, d] of keys.entries()) {
            const status =
                d.blocked            ? "🚫 revoked"
                : d.expiresAt === 0  ? `⏸ pending (${d.stepsCompleted}/${d.totalSteps} steps)`
                : Date.now() > d.expiresAt ? "💀 expired"
                : `✓ ${msToHuman(d.expiresAt - Date.now())} left`;
            out += `\`${k}\` <@${d.userId}> [${status}]\n`;
        }
        const chunks = out.match(/[\s\S]{1,1900}/g) || [out];
        for (const c of chunks) await msg.reply(c);
        return;
    }

    // ── !pending ──────────────────────────────────────────────
    if (cmd === "!pending") {
        if (approvalQueue.size === 0) return msg.reply("No pending approval requests.");
        let out = `**Pending Approvals (${approvalQueue.size}):**\n`;
        for (const [uid, data] of approvalQueue.entries()) {
            const age = msToHuman(Date.now() - data.createdAt);
            out += `<@${uid}> \`${uid}\` — waiting **${age}**\n`;
        }
        await msg.reply(out.slice(0, 2000));
        return;
    }

    // ── !approve <userId> ─────────────────────────────────────
    if (cmd === "!approve" && args[1]) {
        const uid = args[1];
        if (!approvalQueue.has(uid)) {
            await msg.reply(`❌ No pending request for \`${uid}\``);
            return;
        }
        approvalQueue.delete(uid);
        let targetUser = null;
        try { targetUser = await client.users.fetch(uid); } catch {}
        if (!targetUser) { await msg.reply("❌ Could not find that user."); return; }
        await dmStepSelector(targetUser).catch(() => {});
        await msg.reply(`✓ Approved <@${uid}> — step selector sent.`);
        console.log(`[Void] Manual approve: ${targetUser.tag}`);
        return;
    }

    // ── !deny <userId> ────────────────────────────────────────
    if (cmd === "!deny" && args[1]) {
        const uid = args[1];
        approvalQueue.delete(uid);
        let targetUser = null;
        try { targetUser = await client.users.fetch(uid); } catch {}
        if (targetUser) {
            await targetUser.send({ embeds: [new EmbedBuilder()
                .setColor(0xef4444)
                .setTitle("◈  Request Denied")
                .setDescription("Your key request has been denied by the admin.")
                .setTimestamp()
            ]}).catch(() => {});
        }
        await msg.reply(`✓ Denied \`${uid}\`.`);
        return;
    }

    // ── !revoke <key> ─────────────────────────────────────────
    if (cmd === "!revoke" && args[1]) {
        const key  = args[1].toUpperCase();
        const data = keys.get(key);
        if (!data) { await msg.reply(`❌ Key not found: \`${key}\``); return; }
        data.blocked = true;
        keys.set(key, data);
        await msg.reply(`✓ Key revoked: \`${key}\``);
        console.log(`[Void] Key revoked: ${key}`);
        return;
    }

    // ── !reset <userId> ───────────────────────────────────────
    if (cmd === "!reset" && args[1]) {
        const uid = args[1];
        let removed = 0;
        for (const [k, d] of keys.entries()) {
            if (d.userId === uid) { keys.delete(k); removed++; }
        }
        pendingUsers.delete(uid);
        cooldowns.delete(uid);
        approvalQueue.delete(uid);
        await msg.reply(removed > 0
            ? `✓ Reset all data for <@${uid}> — removed ${removed} key(s).`
            : `✓ Cleared state for <@${uid}> (no keys found).`
        );
        return;
    }

    // ── !unblock <ip> ─────────────────────────────────────────
    if (cmd === "!unblock" && args[1]) {
        failLog.delete(args[1]);
        await msg.reply(`✓ Unblocked IP: \`${args[1]}\``);
        return;
    }

    // Unknown command
    await msg.reply("❓ Unknown command. Type `!help` to see all commands.");
});

// ═══════════════════════════════════════════════════════════════
//  EXPRESS API
// ═══════════════════════════════════════════════════════════════
const app = express();
app.use(express.json());

app.use((req, res, next) => {
    if (CONFIG.API_SECRET && req.headers["x-api-key"] !== CONFIG.API_SECRET)
        return res.status(401).json({ valid: false, message: "Unauthorized" });
    next();
});

// ── GET /checkpoint?token=XXX ─────────────────────────────────
app.get("/checkpoint", async (req, res) => {
    const token = req.query.token || "";

    if (!token)
        return res.send(checkpointPage("error", "Invalid or missing token.", 0, 1, 1));

    const tv = verifyTokens.get(token);

    if (!tv)
        return res.send(checkpointPage("error", "This link is invalid or does not exist.", 0, 1, 1));

    if (tv.used)
        return res.send(checkpointPage("error", "This link has already been used.", tv.step - 1, tv.step, 3));

    if (Date.now() - tv.createdAt > CONFIG.VERIFY_TOKEN_TTL) {
        verifyTokens.delete(token);
        return res.send(checkpointPage("error", "This link has expired. Type ?getkey in Discord to get a new one.", 0, tv.step, 3));
    }

    const found   = getUserKey(tv.userId);
    const pending = pendingUsers.get(tv.userId);

    if (!found)
        return res.send(checkpointPage("error", "No key found for your account. Type ?getkey first.", 0, tv.step, 3));

    if (!pending)
        return res.send(checkpointPage("error", "Session expired. Type ?getkey again in Discord.", 0, tv.step, found.data.totalSteps));

    if (tv.step !== pending.currentStep)
        return res.send(checkpointPage("error",
            `Wrong step. You need to complete Step ${pending.currentStep} first.`,
            found.data.stepsCompleted, tv.step, found.data.totalSteps
        ));

    // ✓ Valid — complete step
    const { key, data } = found;
    tv.used = true;
    verifyTokens.set(token, tv);
    data.stepsCompleted++;
    keys.set(key, data);

    console.log(`[Void] ✓ Step ${data.stepsCompleted}/${data.totalSteps} completed by ${tv.userId}`);

    // All steps done → activate key and DM user
    if (data.stepsCompleted >= data.totalSteps) {
        data.expiresAt = Date.now() + (data.totalSteps * CONFIG.HOURS_PER_STEP * 3600000);
        keys.set(key, data);
        pendingUsers.delete(tv.userId);

        try {
            const user = await client.users.fetch(tv.userId);
            await dmFinalKey(user, key, data.totalSteps);
            console.log(`[Void] 🔑 Key delivered to ${user.tag}: ${key}`);
        } catch (e) {
            console.error("[Void] Could not DM final key:", e.message);
        }

        return res.send(checkpointPage(
            "complete",
            `All ${data.totalSteps} checkpoints complete! 🎉<br>Your key has been sent to your <strong>Discord DMs</strong>.`,
            data.stepsCompleted, data.stepsCompleted, data.totalSteps
        ));
    }

    // More steps — advance and DM next link
    pending.currentStep++;
    pendingUsers.set(tv.userId, pending);

    try {
        const user = await client.users.fetch(tv.userId);
        await dmCheckpointLink(user, pending.currentStep, data.totalSteps);
    } catch (e) {
        console.error("[Void] Could not DM next checkpoint:", e.message);
    }

    return res.send(checkpointPage(
        "success",
        `Step ${data.stepsCompleted} complete! ✓<br>Check your <strong>Discord DMs</strong> for the next checkpoint link.`,
        data.stepsCompleted, data.stepsCompleted, data.totalSteps
    ));
});

// ── GET /validate?key=VOID-XXXX ───────────────────────────────
app.get("/validate", (req, res) => {
    const ip  = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
    const key = (req.query.key || "").toUpperCase().trim();

    if (isBlocked(ip))
        return res.json({ valid: false, message: "Too many failed attempts. Try again later." });

    if (!key) { recordFail(ip); return res.json({ valid: false, message: "No key provided" }); }
    if (!verifyKeyHmac(key)) { recordFail(ip); return res.json({ valid: false, message: "Invalid key format" }); }

    const data = keys.get(key);
    if (!data)          { recordFail(ip); return res.json({ valid: false, message: "Key not found" }); }
    if (data.blocked)   return res.json({ valid: false, message: "Key has been revoked" });
    if (data.expiresAt === 0) return res.json({ valid: false, message: "Key not activated — complete your checkpoints first" });
    if (Date.now() > data.expiresAt) return res.json({ valid: false, message: "Key has expired — type ?getkey for a new one" });

    const timeLeft = msToHuman(data.expiresAt - Date.now());
    console.log(`[Void] ✓ Key validated: ${key} (${timeLeft} remaining)`);

    return res.json({
        valid:     true,
        message:   "Access granted",
        userId:    data.userId,
        expiresIn: timeLeft,
        expiresAt: data.expiresAt,
        steps:     data.totalSteps,
    });
});

// ── GET / health check ────────────────────────────────────────
app.get("/", (req, res) => {
    const active  = [...keys.values()].filter(d => !d.blocked && d.expiresAt > Date.now()).length;
    res.json({ status: "ok", totalKeys: keys.size, activeKeys: active, pendingApprovals: approvalQueue.size });
});

// ═══════════════════════════════════════════════════════════════
//  CHECKPOINT PAGE HTML
// ═══════════════════════════════════════════════════════════════
function checkpointPage(state, message, done, current, total) {
    const stepsHtml = Array.from({ length: total }, (_, i) => {
        const n   = i + 1;
        const cls = (n < current || (n === current && (state === "success" || state === "complete")))
            ? "done" : n === current ? "active" : "locked";
        const ico = cls === "done" ? "✓" : n;
        return `
        <div class="step ${cls}">
            <div class="sc">${ico}</div>
            <div class="sl">Step ${n}<br><span>${n * 24}h</span></div>
        </div>
        ${n < total ? '<div class="ln"></div>' : ""}`;
    }).join("");

    const col = { success:"#a855f7", complete:"#22c55e", error:"#ef4444", info:"#c4b5fd" }[state] || "#c4b5fd";

    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VOID — Checkpoint</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#04030a;color:#a89dc0;font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;background-image:radial-gradient(ellipse at 50% 0%,#1a0a3018 0%,transparent 70%)}
.card{background:linear-gradient(145deg,#0f0c1c,#080614);border:1px solid #2a1f45;border-radius:24px;padding:48px 40px;max-width:480px;width:92%;text-align:center;box-shadow:0 0 100px #6d28d912,0 0 40px #00000060;position:relative;overflow:hidden}
.card::before{content:'';position:absolute;top:0;left:10%;right:10%;height:1px;background:linear-gradient(90deg,transparent,#7c3aed50,transparent)}
.logo{font-size:52px;color:#7c3aed;margin-bottom:12px;filter:drop-shadow(0 0 16px #7c3aed55)}
h1{color:#e2d9f3;font-size:22px;letter-spacing:10px;font-weight:900;margin-bottom:4px}
.sub{color:#3d2f60;font-size:11px;letter-spacing:4px;margin-bottom:40px}
.steps{display:flex;align-items:center;justify-content:center;margin-bottom:40px}
.step{display:flex;flex-direction:column;align-items:center;gap:10px}
.ln{width:40px;height:2px;background:#1e1535;margin-bottom:28px}
.step.done+.ln{background:linear-gradient(90deg,#7c3aed60,#1e1535)}
.sc{width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:800;border:2px solid #1e1535;background:#100d1e;color:#2e2248}
.step.done .sc{background:#2d1a60;border-color:#7c3aed;color:#c4b5fd;box-shadow:0 0 16px #7c3aed45}
.step.active .sc{background:#3b1f70;border-color:#a855f7;color:#f3e8ff;box-shadow:0 0 22px #a855f765}
.sl{font-size:10px;color:#2e2248;text-align:center;line-height:1.6}
.sl span{color:#6d28d9;font-weight:bold}
.step.done .sl,.step.active .sl{color:#8b7aaa}
.step.done .sl span,.step.active .sl span{color:#a855f7}
.msg{padding:18px 22px;border-radius:14px;font-size:13px;line-height:1.7;margin-bottom:28px;border:1px solid ${col}30;background:${col}0d;color:${col}}
.btn{display:block;background:linear-gradient(135deg,#5b21b6,#7c3aed);color:#f3e8ff;border:none;border-radius:14px;padding:15px 32px;font-size:11px;font-weight:800;letter-spacing:3px;cursor:pointer;text-decoration:none;transition:.2s;width:100%;box-shadow:0 4px 24px #7c3aed28}
.btn:hover{background:linear-gradient(135deg,#6d28d9,#9333ea);transform:translateY(-1px);box-shadow:0 4px 32px #a855f748}
.footer{margin-top:28px;font-size:10px;color:#1e1535;letter-spacing:2px}
</style></head><body>
<div class="card">
  <div class="logo">◈</div>
  <h1>VOID</h1>
  <p class="sub">CHECKPOINT VERIFICATION</p>
  <div class="steps">${stepsHtml}</div>
  <div class="msg">${message}</div>
  <a href="javascript:window.close()" class="btn">CLOSE WINDOW</a>
  <p class="footer">VOID KEY SYSTEM &nbsp;·&nbsp; DO NOT SHARE YOUR LINKS</p>
</div></body></html>`;
}

// ═══════════════════════════════════════════════════════════════
//  AUTO CLEANUP — runs every hour
// ═══════════════════════════════════════════════════════════════
function runCleanup() {
    const now = Date.now();
    let kR = 0, tR = 0, cR = 0, aR = 0;

    for (const [k, d] of keys.entries())
        if (!d.blocked && d.expiresAt > 0 && now > d.expiresAt + 3600000) { keys.delete(k); kR++; }

    for (const [t, tv] of verifyTokens.entries())
        if (tv.used || now - tv.createdAt > CONFIG.VERIFY_TOKEN_TTL * 2) { verifyTokens.delete(t); tR++; }

    for (const [uid, ts] of cooldowns.entries())
        if (now - ts > CONFIG.GETKEY_COOLDOWN * 20) { cooldowns.delete(uid); cR++; }

    for (const [uid, data] of approvalQueue.entries())
        if (now - data.createdAt > CONFIG.APPROVAL_TTL) { approvalQueue.delete(uid); aR++; }

    for (const [uid, p] of pendingUsers.entries())
        if (now - p.createdAt > 2 * 3600000) pendingUsers.delete(uid);

    for (const [ip, rec] of failLog.entries())
        if (rec.blockedUntil && now > rec.blockedUntil + 3600000) failLog.delete(ip);

    console.log(`[Void] 🧹 Cleanup: keys=${kR} tokens=${tR} cooldowns=${cR} approvals=${aR}`);
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
        const req = lib.get(url, (res) => console.log(`[Void] 💓 Keep-alive → ${res.statusCode}`));
        req.on("error", (e) => console.warn("[Void] Keep-alive error:", e.message));
        req.end();
    }, CONFIG.KEEPALIVE_INTERVAL);
    console.log("[Void] 💓 Keep-alive started");
}

// ═══════════════════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════════════════
app.listen(CONFIG.API_PORT, () => {
    console.log(`[Void] ✓ API listening on port ${CONFIG.API_PORT}`);
});

keepAlive();

process.on("unhandledRejection", (err) => console.error("[Void] Unhandled rejection:", err?.message || err));
process.on("uncaughtException",  (err) => console.error("[Void] Uncaught exception:",  err?.message || err));

client.login(CONFIG.TOKEN).catch((err) => {
    console.error("[Void] LOGIN FAILED:", err.message);
    process.exit(1);
});
