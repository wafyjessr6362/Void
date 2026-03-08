/**
 * ╔══════════════════════════════════════════════════════╗
 * ║   VoidKey Bot  —  Discord Bot + Key Validation API  ║
 * ╠══════════════════════════════════════════════════════╣
 * ║  SETUP:                                             ║
 * ║   1. npm install discord.js express crypto          ║
 * ║   2. Fill in CONFIG below                           ║
 * ║   3. node KeyBot.js                                 ║
 * ║                                                     ║
 * ║  HOW IT WORKS:                                      ║
 * ║   User types  ?getkey  in your Discord server       ║
 * ║   ↓                                                 ║
 * ║   Bot deletes their message (no one sees it)        ║
 * ║   ↓                                                 ║
 * ║   Bot DMs the user a unique one-time key            ║
 * ║   ↓                                                 ║
 * ║   User pastes key into Roblox script                ║
 * ║   ↓                                                 ║
 * ║   Script hits  GET /validate?key=XXXX               ║
 * ║   ↓                                                 ║
 * ║   Bot returns { valid: true }  and marks used       ║
 * ╚══════════════════════════════════════════════════════╝
 */

const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require("discord.js");
const express  = require("express");
const crypto   = require("crypto");

// ══════════════════════════════════════════════
//  CONFIG  —  fill all of these in
// ══════════════════════════════════════════════
const CONFIG = {
    // Discord bot token (from discord.dev)
    TOKEN: "YOUR_BOT_TOKEN_HERE",

    // The prefix for get-key command
    PREFIX: "?",

    // The ID of the channel where ?getkey is allowed
    GET_KEY_CHANNEL_ID: "YOUR_CHANNEL_ID_HERE",

    // The ID of your Discord server/guild
    GUILD_ID: "YOUR_GUILD_ID_HERE",

    // Secret used to sign keys — keep this private, never share it
    // Change this to any random string (openssl rand -hex 32)
    KEY_SECRET: "change_this_to_a_long_random_secret_string",

    // How many characters in each key segment  (e.g. VOID-XXXX-XXXX-XXXX)
    KEY_PREFIX: "VOID",
    KEY_SEGMENTS: 3,
    KEY_SEG_LEN: 4,

    // Whether a key can only be used once (true = one-time use)
    ONE_TIME_USE: true,

    // How long keys last in milliseconds  (0 = forever)
    // 24 hours = 86400000
    KEY_TTL_MS: 0,

    // Port for the validation API
    API_PORT: 3000,

    // Optional: API secret header for Roblox → server auth
    // Set to "" to disable. If set, Roblox must send header X-Api-Key: VALUE
    API_SECRET: "",
};

// ══════════════════════════════════════════════
//  KEY STORAGE  (in-memory — swap for a DB in production)
//
//  keys = Map<string, {
//      userId:    string,   Discord user ID who owns this key
//      createdAt: number,   timestamp ms
//      used:      boolean,  has it been validated yet
//      usedAt:    number?,  when it was validated
//  }>
// ══════════════════════════════════════════════
const keys = new Map();

// ══════════════════════════════════════════════
//  KEY GENERATION
// ══════════════════════════════════════════════
function generateKey() {
    const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusing chars O,0,1,I
    const segments = [];
    for (let s = 0; s < CONFIG.KEY_SEGMENTS; s++) {
        let seg = "";
        for (let c = 0; c < CONFIG.KEY_SEG_LEN; c++) {
            seg += charset[Math.floor(Math.random() * charset.length)];
        }
        segments.push(seg);
    }
    // Append an HMAC checksum segment so fake keys fail fast
    const raw = CONFIG.KEY_PREFIX + "-" + segments.join("-");
    const hmac = crypto
        .createHmac("sha256", CONFIG.KEY_SECRET)
        .update(raw)
        .digest("hex")
        .slice(0, CONFIG.KEY_SEG_LEN)
        .toUpperCase();
    return raw + "-" + hmac;
}

function verifyKeyHmac(key) {
    // Split off the last segment (checksum)
    const parts = key.split("-");
    if (parts.length < CONFIG.KEY_SEGMENTS + 2) return false; // prefix + segments + checksum
    const checksum = parts[parts.length - 1];
    const raw = parts.slice(0, parts.length - 1).join("-");
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
    partials: [Partials.Channel], // needed for DMs
});

client.once("ready", () => {
    console.log(`[VoidKey] Bot online as ${client.user.tag}`);
    console.log(`[VoidKey] API running on port ${CONFIG.API_PORT}`);
    client.user.setActivity("?getkey", { type: 3 }); // "Watching ?getkey"
});

client.on("messageCreate", async (message) => {
    // Ignore bots
    if (message.author.bot) return;

    // Only handle in the designated channel
    if (message.channelId !== CONFIG.GET_KEY_CHANNEL_ID) return;

    // Only handle ?getkey
    if (message.content.trim().toLowerCase() !== `${CONFIG.PREFIX}getkey`) return;

    // Delete their message immediately so others can't see the request
    try {
        await message.delete();
    } catch (e) {
        console.warn("[VoidKey] Could not delete message:", e.message);
    }

    const user = message.author;

    // Check if this user already has an unused key
    for (const [existingKey, data] of keys.entries()) {
        if (data.userId === user.id && !data.used) {
            // Key TTL check
            const expired =
                CONFIG.KEY_TTL_MS > 0 &&
                Date.now() - data.createdAt > CONFIG.KEY_TTL_MS;

            if (!expired) {
                // Already have a valid key — DM them the existing one
                try {
                    const embed = new EmbedBuilder()
                        .setColor(0x5c2da0)
                        .setTitle("◈  Your Existing Key")
                        .setDescription(
                            "You already have an active key.\n" +
                            "It has not been used yet."
                        )
                        .addFields({
                            name: "Key",
                            value: `\`\`\`${existingKey}\`\`\``,
                        })
                        .setFooter({ text: "Do not share this key with anyone." })
                        .setTimestamp();

                    await user.send({ embeds: [embed] });
                } catch (e) {
                    console.warn("[VoidKey] Could not DM user:", e.message);
                    // Fallback: send ephemeral-like message in channel (auto-deletes after 8s)
                    const fallback = await message.channel.send(
                        `<@${user.id}> I couldn't DM you. Please enable DMs from server members, then try again.`
                    );
                    setTimeout(() => fallback.delete().catch(() => {}), 8000);
                }
                return;
            } else {
                // Expired — remove it and generate a new one
                keys.delete(existingKey);
            }
        }
    }

    // Generate a fresh key
    const newKey = generateKey();
    keys.set(newKey, {
        userId:    user.id,
        createdAt: Date.now(),
        used:      false,
        usedAt:    null,
    });

    console.log(`[VoidKey] Generated key for ${user.tag}: ${newKey}`);

    // DM the user their key — fully private
    try {
        const embed = new EmbedBuilder()
            .setColor(0x5c2da0)
            .setTitle("◈  Your License Key")
            .setDescription(
                "Your unique key has been generated.\n" +
                "Paste it into the script when prompted."
            )
            .addFields(
                { name: "Key",      value: `\`\`\`${newKey}\`\`\`` },
                { name: "⚠ Warning", value: "**Never share this key.** It is tied to your account." }
            )
            .setFooter({ text: "One-time use · Do not share" })
            .setTimestamp();

        await user.send({ embeds: [embed] });

        // Quietly acknowledge in the channel (auto-deletes after 5 seconds)
        const ack = await message.channel.send(
            `✓  <@${user.id}> Your key has been sent via DM!`
        );
        setTimeout(() => ack.delete().catch(() => {}), 5000);

    } catch (e) {
        console.warn("[VoidKey] Could not DM user:", e.message);
        const err = await message.channel.send(
            `<@${user.id}> ❌ I couldn't DM you. Enable DMs from server members and try again.`
        );
        setTimeout(() => err.delete().catch(() => {}), 8000);
        // Remove the key since they couldn't receive it
        keys.delete(newKey);
    }
});

// ══════════════════════════════════════════════
//  VALIDATION API
//  GET /validate?key=VOID-XXXX-XXXX-XXXX-XXXX
// ══════════════════════════════════════════════
const app = express();
app.use(express.json());

// Optional API secret middleware
app.use((req, res, next) => {
    if (CONFIG.API_SECRET && CONFIG.API_SECRET !== "") {
        const header = req.headers["x-api-key"];
        if (header !== CONFIG.API_SECRET) {
            return res.status(401).json({ valid: false, message: "Unauthorized" });
        }
    }
    next();
});

app.get("/validate", (req, res) => {
    const key = (req.query.key || "").toUpperCase().trim();

    if (!key) {
        return res.json({ valid: false, message: "No key provided" });
    }

    // 1. HMAC signature check — catches any hand-crafted fake keys instantly
    if (!verifyKeyHmac(key)) {
        return res.json({ valid: false, message: "Invalid key format" });
    }

    // 2. Check key exists in our store
    const data = keys.get(key);
    if (!data) {
        return res.json({ valid: false, message: "Key not found" });
    }

    // 3. Already used?
    if (CONFIG.ONE_TIME_USE && data.used) {
        return res.json({ valid: false, message: "Key has already been used" });
    }

    // 4. TTL expired?
    if (CONFIG.KEY_TTL_MS > 0 && Date.now() - data.createdAt > CONFIG.KEY_TTL_MS) {
        keys.delete(key);
        return res.json({ valid: false, message: "Key has expired" });
    }

    // 5. Valid — mark as used
    if (CONFIG.ONE_TIME_USE) {
        data.used   = true;
        data.usedAt = Date.now();
        keys.set(key, data);
    }

    console.log(`[VoidKey] Key validated: ${key} (user ${data.userId})`);

    return res.json({
        valid:   true,
        message: "Access granted",
        userId:  data.userId,
    });
});

// Health check
app.get("/", (req, res) => {
    res.json({ status: "ok", keys: keys.size });
});

// ══════════════════════════════════════════════
//  ADMIN COMMANDS  (bot DMs only)
//  DM the bot:  !revoke <key>
//               !listkeys
//               !stats
// ══════════════════════════════════════════════
client.on("messageCreate", async (msg) => {
    if (!msg.author.bot && msg.channel.type === 1) { // DM channel
        // Only allow the bot owner (first guild owner) to use admin commands
        const guild = await client.guilds.fetch(CONFIG.GUILD_ID).catch(() => null);
        if (!guild) return;
        if (msg.author.id !== guild.ownerId) return;

        const args = msg.content.trim().split(/\s+/);
        const cmd  = args[0].toLowerCase();

        if (cmd === "!revoke" && args[1]) {
            const key = args[1].toUpperCase();
            if (keys.delete(key)) {
                await msg.reply(`✓ Key revoked: \`${key}\``);
            } else {
                await msg.reply(`❌ Key not found: \`${key}\``);
            }
        }

        if (cmd === "!listkeys") {
            if (keys.size === 0) {
                await msg.reply("No keys in the store.");
                return;
            }
            let out = "**Active Keys:**\n";
            for (const [k, d] of keys.entries()) {
                const status = d.used ? "✓ used" : "○ unused";
                out += `\`${k}\`  →  <@${d.userId}>  [${status}]\n`;
            }
            await msg.reply(out.slice(0, 2000));
        }

        if (cmd === "!stats") {
            const total  = keys.size;
            const used   = [...keys.values()].filter(d => d.used).length;
            const unused = total - used;
            await msg.reply(`**Key Stats**\nTotal: ${total}  |  Used: ${used}  |  Unused: ${unused}`);
        }
    }
});

// ══════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════
app.listen(CONFIG.API_PORT, () => {
    console.log(`[VoidKey] API listening on http://localhost:${CONFIG.API_PORT}`);
});

client.login(CONFIG.TOKEN);
