const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require("discord.js");
const express = require("express");
const crypto  = require("crypto");

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
    KEY_PREFIX:         "VOID",
    KEY_SEGMENTS:       3,
    KEY_SEG_LEN:        4,
    ONE_TIME_USE:       true,
    KEY_TTL_MS:         0,
};

// ══════════════════════════════════════════════
//  STARTUP CHECKS
// ══════════════════════════════════════════════
console.log("[VoidKey] Starting...");
console.log("[VoidKey] BOT_TOKEN set:", !!CONFIG.TOKEN);
console.log("[VoidKey] GUILD_ID set:", !!CONFIG.GUILD_ID);
console.log("[VoidKey] GET_KEY_CHANNEL_ID set:", !!CONFIG.GET_KEY_CHANNEL_ID);

if (!CONFIG.TOKEN) {
    console.error("[VoidKey] ERROR: BOT_TOKEN is missing! Set it in Render Environment tab.");
    process.exit(1);
}

if (!CONFIG.GUILD_ID) {
    console.error("[VoidKey] ERROR: GUILD_ID is missing! Set it in Render Environment tab.");
    process.exit(1);
}

if (!CONFIG.GET_KEY_CHANNEL_ID) {
    console.error("[VoidKey] ERROR: GET_KEY_CHANNEL_ID is missing! Set it in Render Environment tab.");
    process.exit(1);
}

// ══════════════════════════════════════════════
//  KEY STORAGE
// ══════════════════════════════════════════════
const keys = new Map();

// ══════════════════════════════════════════════
//  KEY GENERATION
// ══════════════════════════════════════════════
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
        .update(raw)
        .digest("hex")
        .slice(0, CONFIG.KEY_SEG_LEN)
        .toUpperCase();

    return raw + "-" + checksum;
}

function verifyKeyHmac(key) {
    const parts = key.split("-");
    if (parts.length < CONFIG.KEY_SEGMENTS + 2) return false;
    const checksum = parts[parts.length - 1];
    const raw      = parts.slice(0, parts.length - 1).join("-");
    const expected = crypto
        .createHmac("sha256", CONFIG.KEY_SECRET)
        .update(raw)
        .digest("hex")
        .slice(0, CONFIG.KEY_SEG_LEN)
        .toUpperCase();
    return checksum === expected;
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

    const user = message.author;

    // Check for existing unused key
    for (const [existingKey, data] of keys.entries()) {
        if (data.userId !== user.id || data.used) continue;

        const expired = CONFIG.KEY_TTL_MS > 0 && Date.now() - data.createdAt > CONFIG.KEY_TTL_MS;

        if (!expired) {
            try {
                const embed = new EmbedBuilder()
                    .setColor(0x5c2da0)
                    .setTitle("◈  Your Existing Key")
                    .setDescription("You already have an active unused key.")
                    .addFields({ name: "Key", value: `\`\`\`${existingKey}\`\`\`` })
                    .setFooter({ text: "Do not share this key with anyone." })
                    .setTimestamp();
                await user.send({ embeds: [embed] });
            } catch {
                const w = await message.channel.send(`<@${user.id}> ❌ Enable DMs from server members, then try again.`);
                setTimeout(() => w.delete().catch(() => {}), 8000);
            }
            return;
        } else {
            keys.delete(existingKey);
        }
    }

    // Generate new key
    const newKey = generateKey();
    keys.set(newKey, {
        userId:    user.id,
        createdAt: Date.now(),
        used:      false,
        usedAt:    null,
    });

    console.log(`[VoidKey] Generated key for ${user.tag}: ${newKey}`);

    try {
        const embed = new EmbedBuilder()
            .setColor(0x5c2da0)
            .setTitle("◈  Your License Key")
            .setDescription("Your unique key has been generated.\nPaste it into the script when prompted.")
            .addFields(
                { name: "Key",       value: `\`\`\`${newKey}\`\`\`` },
                { name: "⚠ Warning", value: "**Never share this key.** It is tied to your account." }
            )
            .setFooter({ text: "One-time use · Do not share" })
            .setTimestamp();

        await user.send({ embeds: [embed] });

        const ack = await message.channel.send(`✓  <@${user.id}> Key sent via DM!`);
        setTimeout(() => ack.delete().catch(() => {}), 5000);

    } catch (e) {
        console.error("[VoidKey] Could not DM user:", e.message);
        const err = await message.channel.send(`<@${user.id}> ❌ I couldn't DM you. Enable DMs from server members and try again.`);
        setTimeout(() => err.delete().catch(() => {}), 8000);
        keys.delete(newKey);
    }
});

// ── Admin commands via DM ─────────────────────
client.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;
    if (msg.channel.type !== 1) return;

    const guild = await client.guilds.fetch(CONFIG.GUILD_ID).catch(() => null);
    if (!guild || msg.author.id !== guild.ownerId) return;

    const args = msg.content.trim().split(/\s+/);
    const cmd  = args[0].toLowerCase();

    if (cmd === "!revoke" && args[1]) {
        const key = args[1].toUpperCase();
        keys.delete(key)
            ? await msg.reply(`✓ Revoked: \`${key}\``)
            : await msg.reply(`❌ Not found: \`${key}\``);
    }

    if (cmd === "!listkeys") {
        if (keys.size === 0) return msg.reply("No keys in store.");
        let out = "**Keys:**\n";
        for (const [k, d] of keys.entries()) {
            out += `\`${k}\` → <@${d.userId}> [${d.used ? "✓ used" : "○ unused"}]\n`;
        }
        await msg.reply(out.slice(0, 2000));
    }

    if (cmd === "!stats") {
        const total = keys.size;
        const used  = [...keys.values()].filter(d => d.used).length;
        await msg.reply(`**Stats**\nTotal: ${total} | Used: ${used} | Unused: ${total - used}`);
    }
});

// ══════════════════════════════════════════════
//  EXPRESS API
// ══════════════════════════════════════════════
const app = express();
app.use(express.json());

app.use((req, res, next) => {
    if (CONFIG.API_SECRET) {
        if (req.headers["x-api-key"] !== CONFIG.API_SECRET) {
            return res.status(401).json({ valid: false, message: "Unauthorized" });
        }
    }
    next();
});

app.get("/validate", (req, res) => {
    const key = (req.query.key || "").toUpperCase().trim();

    if (!key)                  return res.json({ valid: false, message: "No key provided" });
    if (!verifyKeyHmac(key))   return res.json({ valid: false, message: "Invalid key format" });

    const data = keys.get(key);
    if (!data)                 return res.json({ valid: false, message: "Key not found" });
    if (CONFIG.ONE_TIME_USE && data.used) return res.json({ valid: false, message: "Key already used" });
    if (CONFIG.KEY_TTL_MS > 0 && Date.now() - data.createdAt > CONFIG.KEY_TTL_MS) {
        keys.delete(key);
        return res.json({ valid: false, message: "Key expired" });
    }

    if (CONFIG.ONE_TIME_USE) {
        data.used   = true;
        data.usedAt = Date.now();
        keys.set(key, data);
    }

    console.log(`[VoidKey] ✓ Validated: ${key} (user ${data.userId})`);
    return res.json({ valid: true, message: "Access granted", userId: data.userId });
});

app.get("/", (req, res) => {
    res.json({ status: "ok", keys: keys.size });
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

client.login(CONFIG.TOKEN).catch((err) => {
    console.error("[VoidKey] LOGIN FAILED:", err.message);
    console.error("[VoidKey] Check your BOT_TOKEN in Render Environment tab.");
    process.exit(1);
});
