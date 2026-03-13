/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║        V O I D   K E Y   S Y S T E M  —  v8.0 ULTIMATE            ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  FLOW:                                                              ║
 * ║  1. ?getkey in channel → "✓ Check your DMs!" (deletes in 2s)       ║
 * ║  2. 5-minute cooldown on that user                                  ║
 * ║  3. DM: pick 1–10 steps (each = exactly +24h)                      ║
 * ║  4. Each checkpoint page:                                           ║
 * ║     a) Ad-blocker must be OFF (probe /ads/ads.js)                   ║
 * ║     b) 3 rounds of challenges — ALL server-verified                 ║
 * ║        • Wrong answer = new challenge + retry, NEVER auto-passes    ║
 * ║        • Types: math, color, word, count, sequence, grid, rotations ║
 * ║     c) N simulated video ads (10–30s each, animated like real ads)  ║
 * ║        • Must watch 5s before Skip unlocks                         ║
 * ║        • Sequential if ADS > 1                                      ║
 * ║     d) Complete → server checks solvedCount === 3                   ║
 * ║  5. All steps → key sent via DM                                     ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  ENV VARS:                                                          ║
 * ║  BOT_TOKEN            Discord bot token                             ║
 * ║  GUILD_ID             Server ID                                     ║
 * ║  GET_KEY_CHANNEL_ID   Channel for ?getkey                           ║
 * ║  KEY_SECRET           HMAC signing secret                           ║
 * ║  BASE_URL             https://your-service.onrender.com             ║
 * ║  API_SECRET           Optional /validate auth header                ║
 * ║  ADS                  Ads per checkpoint (default 1, max 5)         ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  COMMANDS:                                                          ║
 * ║  #get-key : ?getkey  ·  ?removekey @User                           ║
 * ║  Owner DM : !help  !stats  !listkeys  !revoke  !reset              ║
 * ║             !remove <userId>  !unblock <ip>                         ║
 * ║  Slash    : /removemessage <link>  ·  /rm <link>                   ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

"use strict";

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

// ═══════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════
const CFG = {
    TOKEN:       process.env.BOT_TOKEN,
    GUILD_ID:    process.env.GUILD_ID,
    KEY_CHANNEL: process.env.GET_KEY_CHANNEL_ID,
    KEY_SECRET:  process.env.KEY_SECRET  || "void_change_this_secret",
    API_SECRET:  process.env.API_SECRET  || "",
    PORT:        process.env.PORT        || 3000,
    BASE_URL:    (process.env.BASE_URL   || "https://void-r3co.onrender.com").replace(/\/$/, ""),
    ADS:         Math.min(5, Math.max(1, parseInt(process.env.ADS || "1"))),

    KEY_PREFIX:  "VOID",
    KEY_SEGS:    3,
    KEY_SEG_LEN: 4,

    CH_DELETE_MS:    2_000,
    COOLDOWN_MS:     5 * 60_000,
    TOKEN_TTL_MS:    15 * 60_000,
    CLEANUP_MS:      60 * 60_000,
    KEEPALIVE_MS:    10 * 60_000,

    MAX_FAILS:       5,
    FAIL_WIN_MS:     10 * 60_000,
    BLOCK_MS:        60 * 60_000,

    HOURS_STEP:      24,
    MAX_STEPS:       10,
    ROUNDS_NEEDED:   3,
};

// ═══════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════
console.log("\n╔══════════════════════════════════════════════════╗");
console.log("║    V O I D  K E Y  S Y S T E M  v8.0  ULTIMATE  ║");
console.log("╚══════════════════════════════════════════════════╝");
for (const k of ["BOT_TOKEN","GUILD_ID","GET_KEY_CHANNEL_ID"])
    console.log(`  ${k.padEnd(26)} ${process.env[k] ? "✓" : "✗ MISSING"}`);
console.log(`  ${"ADS per checkpoint".padEnd(26)} ${CFG.ADS}`);
console.log(`  ${"BASE_URL".padEnd(26)} ${CFG.BASE_URL}\n`);

if (!CFG.TOKEN)       { console.error("[VOID] FATAL: BOT_TOKEN missing");          process.exit(1); }
if (!CFG.GUILD_ID)    { console.error("[VOID] FATAL: GUILD_ID missing");           process.exit(1); }
if (!CFG.KEY_CHANNEL) { console.error("[VOID] FATAL: GET_KEY_CHANNEL_ID missing"); process.exit(1); }

// ═══════════════════════════════════════════════════════════════
//  STORES
// ═══════════════════════════════════════════════════════════════
const keys       = new Map();
const pending    = new Map();
const vtokens    = new Map();
const challenges = new Map();
const cooldowns  = new Map();
const failLog    = new Map();
const botDmLog   = new Map(); // userId → [msgId, ...]

function logDm(uid, mid) {
    if (!botDmLog.has(uid)) botDmLog.set(uid, []);
    botDmLog.get(uid).push(mid);
}

// ═══════════════════════════════════════════════════════════════
//  CRYPTO
// ═══════════════════════════════════════════════════════════════
function makeKey() {
    const cs  = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const seg = () => Array.from({ length: CFG.KEY_SEG_LEN },
        () => cs[Math.floor(Math.random() * cs.length)]).join("");
    const raw = `${CFG.KEY_PREFIX}-${Array.from({ length: CFG.KEY_SEGS }, seg).join("-")}`;
    const chk = crypto.createHmac("sha256", CFG.KEY_SECRET).update(raw).digest("hex")
        .slice(0, CFG.KEY_SEG_LEN).toUpperCase();
    return `${raw}-${chk}`;
}

function validHmac(key) {
    const p = key.split("-");
    if (p.length < CFG.KEY_SEGS + 2) return false;
    const raw = p.slice(0, -1).join("-");
    return p.at(-1) === crypto.createHmac("sha256", CFG.KEY_SECRET).update(raw).digest("hex")
        .slice(0, CFG.KEY_SEG_LEN).toUpperCase();
}

function makeToken(userId, step) {
    const t = crypto.randomBytes(32).toString("hex");
    vtokens.set(t, { userId, step, createdAt: Date.now(), used: false });
    return t;
}

// ═══════════════════════════════════════════════════════════════
//  CHALLENGE ENGINE  — 7 types, answer NEVER sent to client
// ═══════════════════════════════════════════════════════════════
function genChallenge() {
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const ri   = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
    const type = pick(["math","math2","color","word","count","sequence","grid"]);

    // ── Basic math ────────────────────────────────────────────
    if (type === "math") {
        const op  = pick(["+","-","*"]);
        const a   = ri(3, 35), b = ri(2, 18);
        const ans = op==="+" ? a+b : op==="-" ? a-b : a*b;
        return { type, answer: String(ans), clientData: {},
            question: `<span class="math-q">${a} ${op} ${b} = ?</span>` };
    }

    // ── Two-step math ─────────────────────────────────────────
    if (type === "math2") {
        const ops = ["+","-","*"];
        const op1 = pick(ops), op2 = pick(ops);
        const a = ri(2,15), b = ri(2,10), c = ri(2,8);
        const step1 = op1==="+" ? a+b : op1==="-" ? a-b : a*b;
        const ans   = op2==="+" ? step1+c : op2==="-" ? step1-c : step1*c;
        return { type, answer: String(ans), clientData: {},
            question: `<span class="math-q">(${a} ${op1} ${b}) ${op2} ${c} = ?</span>` };
    }

    // ── Color ─────────────────────────────────────────────────
    if (type === "color") {
        const all    = ["red","blue","green","yellow","purple","orange","pink","cyan","white","lime","teal","coral"];
        const target = pick(all);
        const opts   = [target];
        while (opts.length < 5) { const c=pick(all); if(!opts.includes(c)) opts.push(c); }
        opts.sort(() => Math.random() - 0.5);
        return { type, answer: target, clientData: { opts },
            question: `Click the color:<br><strong class="color-target" style="color:${target};text-shadow:0 0 18px ${target}88">${target.toUpperCase()}</strong>` };
    }

    // ── Word unscramble ───────────────────────────────────────
    if (type === "word") {
        const words  = ["VOID","VERIFY","ACCESS","SECURE","TOKEN","SHIELD","VAULT","CIPHER",
                        "GHOST","NEXUS","PRISM","FORGE","DELTA","OMEGA","RECON","PROXY"];
        const target = pick(words);
        let jmb = target.split("").sort(() => Math.random()-0.5).join("");
        while (jmb === target) jmb = target.split("").sort(() => Math.random()-0.5).join("");
        return { type, answer: target, clientData: {},
            question: `Unscramble: <span class="word-q">${jmb.split("").join(" ")}</span>` };
    }

    // ── Count emojis ──────────────────────────────────────────
    if (type === "count") {
        const icons = ["⭐","🔵","🟣","🔷","💎","🌀","🔺","🟡","🔶","🟢","🔸","🔹"];
        const icon  = pick(icons);
        const n     = ri(4, 11);
        // Scatter them with decoys
        const decoy = pick(icons.filter(x => x !== icon));
        const positions = Array.from({ length: n+2 }, (_, i) =>
            `<span class="emoji-item" style="font-size:22px">${i < n ? icon : decoy}</span>`
        ).sort(() => Math.random()-0.5).join("");
        return { type, answer: String(n), clientData: {},
            question: `How many <strong>${icon}</strong> are there?<br><div class="emoji-grid">${positions}</div>` };
    }

    // ── Number sequence ───────────────────────────────────────
    if (type === "sequence") {
        const variants = [
            // arithmetic
            () => { const s=ri(1,12),d=ri(2,8); return { seq:[s,s+d,s+d*2,s+d*3], ans:s+d*4 }; },
            // multiply
            () => { const s=ri(1,5),r=ri(2,4); return { seq:[s,s*r,s*r*r,s*r*r*r], ans:s*r*r*r*r }; },
            // fibonacci-like
            () => { const a=ri(1,6),b=ri(1,6); return { seq:[a,b,a+b,a+b+b], ans:a+b+b+b }; },
        ];
        const { seq, ans } = pick(variants)();
        return { type, answer: String(ans), clientData: {},
            question: `Next number in the sequence?<br><span class="seq-q">${seq.join("  →  ")}  →  ?</span>` };
    }

    // ── Grid — find the odd one out ───────────────────────────
    if (type === "grid") {
        const sets = [
            ["🔴","🟢"],["⬛","⬜"],["🌙","☀️"],["🐱","🐶"],
            ["🍎","🍊"],["🚀","✈️"],["🔑","🔒"],["💎","💍"],
        ];
        const [maj, min] = pick(sets);
        const size = pick([9, 12]); // 3x3 or 4x3
        const cols = size === 9 ? 3 : 4;
        const pos  = ri(0, size-1);
        const cells = Array.from({ length: size }, (_,i) => i===pos ? min : maj);
        const labels = "ABCDEFGHIJKL".slice(0, size);
        const cellsHtml = cells.map((c,i) =>
            `<div class="gcell" data-lbl="${labels[i]}" onclick="pickCell(this,'${labels[i]}')" style="cursor:pointer">` +
            `<div>${c}</div><div class="gcell-lbl">${labels[i]}</div></div>`
        ).join("");
        return { type, answer: labels[pos], clientData: { cols },
            question: `Which cell is the odd one out?<br><div class="grid-wrap" id="gcells" style="--gc:${cols}">${cellsHtml}</div>` };
    }
}

// ═══════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════
const fmtMs = (ms) => {
    if (ms <= 0) return "expired";
    const h = Math.floor(ms/3_600_000), m = Math.floor((ms%3_600_000)/60_000);
    return h ? `${h}h ${m}m` : `${m}m`;
};

const bar = (done, tot) =>
    Array.from({length:tot},(_,i)=>i<done?"🟣":"⚫").join(" ") + `  (${done}/${tot})`;

const getUserKey = (uid) => {
    for (const [k,d] of keys) if (d.userId===uid && !d.blocked) return {key:k,data:d};
    return null;
};

const onCD   = (uid) => { const t=cooldowns.get(uid); return !!(t && Date.now()-t < CFG.COOLDOWN_MS); };
const cdLeft = (uid) => { const t=cooldowns.get(uid); return t ? Math.max(0,CFG.COOLDOWN_MS-(Date.now()-t)) : 0; };
const setCD  = (uid) => cooldowns.set(uid, Date.now());
const delMsg = (m, ms=0) => setTimeout(() => m.delete().catch(()=>{}), ms);
const parseLink = (s) => {
    const m = s.match(/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
    return m ? { guildId:m[1], channelId:m[2], messageId:m[3] } : null;
};

function recordFail(ip) {
    const now=Date.now(), r=failLog.get(ip)||{count:0,firstFail:now,blockedUntil:0};
    if (now-r.firstFail > CFG.FAIL_WIN_MS) { r.count=0; r.firstFail=now; }
    if (++r.count >= CFG.MAX_FAILS) r.blockedUntil = now+CFG.BLOCK_MS;
    failLog.set(ip,r);
}
const ipBlocked = (ip) => { const r=failLog.get(ip); return !!(r?.blockedUntil && Date.now()<r.blockedUntil); };

// ═══════════════════════════════════════════════════════════════
//  DM HELPER
// ═══════════════════════════════════════════════════════════════
async function dm(user, payload) {
    const sent = await user.send(payload);
    logDm(user.id, sent.id);
    return sent;
}

// ═══════════════════════════════════════════════════════════════
//  EMBEDS
// ═══════════════════════════════════════════════════════════════
const PURPLE = 0x6d28d9, GREEN = 0x22c55e, RED = 0xef4444;

function stepSelectorPayload(user) {
    const opts = Array.from({length:CFG.MAX_STEPS},(_,i)=>{
        const n=i+1, h=n*CFG.HOURS_STEP;
        const d=Math.floor(h/24), r=h%24;
        return new StringSelectMenuOptionBuilder()
            .setLabel(`${n} Step${n>1?"s":""} — ${d}d${r>0?` ${r}h`:""}`)
            .setDescription(`Complete ${n} checkpoint${n>1?"s":""} → ${h}h access`)
            .setValue(`${n}`)
            .setEmoji(["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"][i]);
    });
    return {
        embeds: [new EmbedBuilder()
            .setColor(PURPLE)
            .setTitle("◈  VOID — Select Your Steps")
            .setDescription(
                "Choose how many verification steps to complete.\n" +
                "Each step adds exactly **+24h** to your key — they never multiply.\n\n" +
                "> 1 step = 24h &nbsp;·&nbsp; 5 steps = 120h &nbsp;·&nbsp; 10 steps = 240h"
            )
            .addFields({
                name:  "⚡ Each Checkpoint Requires",
                value: `• Ad blocker must be **disabled**\n• Pass **3 server-verified challenges** *(wrong = new challenge, no auto-pass)*\n• Watch **${CFG.ADS}** video ad${CFG.ADS>1?"s":""} in full`,
            })
            .setFooter({text:"VOID Key System · Steps 1–10"})
            .setTimestamp()
        ],
        components:[new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`ss_${user.id}`)
                .setPlaceholder("🔑  Choose your steps…")
                .addOptions(opts)
        )],
    };
}

async function sendCheckpointDM(user, step, total) {
    const token = makeToken(user.id, step);
    const link  = `${CFG.BASE_URL}/checkpoint?token=${token}`;
    await dm(user,{
        embeds:[new EmbedBuilder()
            .setColor(PURPLE)
            .setTitle(`◈  Checkpoint ${step} / ${total}`)
            .setDescription(`Complete 3 challenges + ${CFG.ADS} video ad${CFG.ADS>1?"s":""} to unlock **+${CFG.HOURS_STEP}h**.`)
            .addFields(
                {name:"📍 Progress",    value:bar(step-1,total)},
                {name:"⏱ Link Expires", value:"**15 minutes**",                       inline:true},
                {name:"🎁 After This",  value:`**${step*CFG.HOURS_STEP}h** total`,    inline:true},
                {name:"📋 Instructions",value:`1. Click the button below\n2. Disable your ad blocker\n3. Pass 3 challenges *(server-verified — no shortcuts)*\n4. Watch ${CFG.ADS} video ad${CFG.ADS>1?"s":""}\n5. Click Complete`},
                {name:"⚠️ Warning",     value:"**Do not share this link.** One-time use, tied to your account."}
            )
            .setFooter({text:`VOID Key System · Checkpoint ${step}/${total}`})
            .setTimestamp()
        ],
        components:[new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel(`  Complete Checkpoint ${step}`)
                .setStyle(ButtonStyle.Link)
                .setURL(link)
                .setEmoji("✅")
        )],
    });
}

async function sendFinalKeyDM(user, key, total) {
    const h = total*CFG.HOURS_STEP;
    await dm(user,{
        embeds:[new EmbedBuilder()
            .setColor(GREEN)
            .setTitle("◈  All Steps Complete! 🎉")
            .setDescription(`**${total} × 24h = ${h}h** of access is now active.`)
            .addFields(
                {name:"🔑 License Key",  value:`\`\`\`\n${key}\n\`\`\``},
                {name:"📍 Progress",     value:bar(total,total)},
                {name:"⏳ Valid For",     value:`**${h} hours**`,                  inline:true},
                {name:"✅ Steps Done",    value:`**${total}/${CFG.MAX_STEPS}**`,   inline:true},
                {name:"⚠️ Warning",       value:"**Never share this key.** It is permanently tied to your Discord account."}
            )
            .setFooter({text:"VOID Key System · Keep this key safe"})
            .setTimestamp()
        ],
    });
}

// ═══════════════════════════════════════════════════════════════
//  DISCORD BOT
// ═══════════════════════════════════════════════════════════════
const bot = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message],
});

bot.once("ready", async () => {
    console.log(`[VOID] ✓ Online as ${bot.user.tag}`);
    bot.user.setActivity("?getkey", {type:3});
    await registerSlash();
});

bot.on("error", e => console.error("[VOID] Discord error:", e.message));

async function registerSlash() {
    const wl = (b) => b.addStringOption(o =>
        o.setName("link").setDescription("Full Discord message link").setRequired(true));
    const cmds = [
        wl(new SlashCommandBuilder().setName("removemessage").setDescription("Delete a message by link").setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)).toJSON(),
        wl(new SlashCommandBuilder().setName("rm").setDescription("Delete a message by link (alias)").setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)).toJSON(),
    ];
    try {
        await new REST({version:"10"}).setToken(CFG.TOKEN)
            .put(Routes.applicationGuildCommands(bot.user.id, CFG.GUILD_ID), {body:cmds});
        console.log("[VOID] ✓ Slash: /removemessage  /rm");
    } catch(e) { console.error("[VOID] Slash register failed:", e.message); }
}

// ═══════════════════════════════════════════════════════════════
//  ?getkey + ?removekey
// ═══════════════════════════════════════════════════════════════
bot.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;
    if (msg.channelId !== CFG.KEY_CHANNEL) return;
    const raw = msg.content.trim().toLowerCase();

    // ?removekey
    if (raw.startsWith("?removekey")) {
        try { await msg.delete(); } catch {}
        const guild = await bot.guilds.fetch(CFG.GUILD_ID).catch(()=>null);
        if (!guild || msg.author.id !== guild.ownerId) {
            const w = await msg.channel.send(`<@${msg.author.id}> ❌ Owner only.`);
            delMsg(w,4000); return;
        }
        const target = msg.mentions.users.first();
        if (!target) { const w=await msg.channel.send("❌ Usage: `?removekey @User`"); delMsg(w,4000); return; }
        let r=0;
        for (const [k,d] of keys) { if (d.userId===target.id) { keys.delete(k); r++; } }
        pending.delete(target.id); cooldowns.delete(target.id);
        const w = await msg.channel.send(r ? `✓ Removed **${r}** key(s) for <@${target.id}>.` : `❌ No keys for <@${target.id}>.`);
        delMsg(w,5000);
        if (r) {
            try { await dm(target,{embeds:[new EmbedBuilder().setColor(RED).setTitle("◈  Key Removed")
                .setDescription("Your key was removed. Type `?getkey` for a new one.").setTimestamp()]}); }
            catch {}
        }
        return;
    }

    if (raw !== "?getkey") return;
    try { await msg.delete(); } catch {}

    const user  = msg.author;
    const found = getUserKey(user.id);

    if (found && found.data.expiresAt > Date.now()) {
        const w = await msg.channel.send(`<@${user.id}> ✓ Check your DMs!`);
        delMsg(w, CFG.CH_DELETE_MS);
        try { await dm(user,{embeds:[new EmbedBuilder().setColor(PURPLE).setTitle("◈  Active Key")
            .addFields({name:"🔑 Key",value:`\`\`\`\n${found.key}\n\`\`\``},{name:"⏳ Expires",value:`in **${fmtMs(found.data.expiresAt-Date.now())}**`})
            .setFooter({text:"Do not share your key."}).setTimestamp()]}); }
        catch {}
        return;
    }

    if (onCD(user.id)) {
        const w = await msg.channel.send(`<@${user.id}> ⏱ Cooldown — try again in **${fmtMs(cdLeft(user.id))}**.`);
        delMsg(w, CFG.CH_DELETE_MS); return;
    }
    setCD(user.id);

    if (pending.has(user.id)) {
        const w = await msg.channel.send(`<@${user.id}> ✓ Check your DMs!`);
        delMsg(w, CFG.CH_DELETE_MS);
        const p = pending.get(user.id);
        try { await sendCheckpointDM(user, p.currentStep, p.totalSteps); } catch {}
        return;
    }

    try {
        const w = await msg.channel.send(`<@${user.id}> ✓ Check your DMs!`);
        delMsg(w, CFG.CH_DELETE_MS);
        await dm(user, stepSelectorPayload(user));
        console.log(`[VOID] ?getkey → ${user.tag}`);
    } catch(e) { console.error("[VOID] ?getkey error:", e.message); }
});

// ═══════════════════════════════════════════════════════════════
//  INTERACTIONS
// ═══════════════════════════════════════════════════════════════
bot.on(Events.InteractionCreate, async (interaction) => {

    if (interaction.isChatInputCommand() &&
        (interaction.commandName==="removemessage"||interaction.commandName==="rm")) {
        await interaction.deferReply({ephemeral:true});
        const parsed = parseLink(interaction.options.getString("link")||"");
        if (!parsed)                         return interaction.editReply("❌ Invalid link.");
        if (parsed.guildId!==CFG.GUILD_ID)   return interaction.editReply("❌ Wrong server.");
        try {
            const ch = await bot.channels.fetch(parsed.channelId);
            const m  = await ch.messages.fetch(parsed.messageId);
            await m.delete();
            return interaction.editReply("✓ Deleted.");
        } catch(e) { return interaction.editReply(`❌ ${e.message}`); }
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("ss_")) {
        const uid = interaction.customId.slice(3);
        if (interaction.user.id !== uid)
            return interaction.reply({content:"❌ Not for you.",ephemeral:true});

        const steps = parseInt(interaction.values[0]);
        const hours = steps * CFG.HOURS_STEP;

        await interaction.update({
            embeds:[new EmbedBuilder().setColor(PURPLE).setTitle("◈  Steps Locked In")
                .setDescription(`**${steps} step${steps>1?"s":""} → ${steps} × 24h = ${hours}h**\n\nComplete all checkpoints and your key is sent automatically.`)
                .setFooter({text:"Do not share your checkpoint links."}).setTimestamp()],
            components:[],
        });

        const newKey = makeKey();
        keys.set(newKey,{userId:uid,createdAt:Date.now(),totalSteps:steps,stepsCompleted:0,expiresAt:0,blocked:false});
        pending.set(uid,{totalSteps:steps,currentStep:1,keyStr:newKey,createdAt:Date.now()});

        console.log(`[VOID] ${interaction.user.tag} → ${steps} steps  key=${newKey}`);
        try { await sendCheckpointDM(interaction.user,1,steps); }
        catch(e) { console.error("[VOID] Checkpoint DM error:",e.message); }
    }
});

// ═══════════════════════════════════════════════════════════════
//  ADMIN DM COMMANDS
// ═══════════════════════════════════════════════════════════════
bot.on("messageCreate", async (msg) => {
    if (msg.author.bot||msg.channel.type!==1) return;
    const guild = await bot.guilds.fetch(CFG.GUILD_ID).catch(()=>null);
    if (!guild||msg.author.id!==guild.ownerId) return;

    const args = msg.content.trim().split(/\s+/);
    const cmd  = args[0]?.toLowerCase();

    switch(cmd) {
        case "!help":
            return msg.reply("```\nVOID KEY SYSTEM v8.0 — ADMIN COMMANDS\n" +
                "══════════════════════════════════════\n\n" +
                "IN #get-key:\n" +
                "  ?getkey              Request a key (any user)\n" +
                "  ?removekey @User     Remove user's key (owner)\n\n" +
                "DM TO BOT:\n" +
                "  !help                This menu\n" +
                "  !stats               System statistics\n" +
                "  !listkeys            All keys with status\n" +
                "  !revoke  <key>       Revoke a key permanently\n" +
                "  !reset   <userId>    Wipe all data for a user\n" +
                "  !remove  <userId>    Delete all bot DMs to user\n" +
                "  !unblock <ip>        Unblock a rate-limited IP\n\n" +
                "SLASH:\n" +
                "  /removemessage <link>\n" +
                "  /rm <link>\n" +
                "```");

        case "!stats": {
            const all = [...keys.values()];
            return msg.reply("```\nVOID STATS\n══════════\n" +
                `Total keys      : ${keys.size}\n` +
                `Active          : ${all.filter(d=>!d.blocked&&d.expiresAt>Date.now()).length}\n` +
                `Pending steps   : ${all.filter(d=>d.expiresAt===0&&!d.blocked).length}\n` +
                `Expired         : ${all.filter(d=>d.expiresAt>0&&Date.now()>d.expiresAt).length}\n` +
                `Revoked         : ${all.filter(d=>d.blocked).length}\n` +
                `In verification : ${pending.size}\n` +
                "```");
        }

        case "!listkeys": {
            if (!keys.size) return msg.reply("No keys stored.");
            let out = `**Keys (${keys.size}):**\n`;
            for (const [k,d] of keys) {
                const st = d.blocked?"🚫 revoked":d.expiresAt===0?`⏸ pending (${d.stepsCompleted}/${d.totalSteps})`:Date.now()>d.expiresAt?"💀 expired":`✅ ${fmtMs(d.expiresAt-Date.now())} left`;
                out += `\`${k}\` <@${d.userId}> [${st}]\n`;
            }
            for (const c of out.match(/[\s\S]{1,1900}/g)||[]) await msg.reply(c);
            return;
        }

        case "!revoke": {
            if (!args[1]) return msg.reply("Usage: `!revoke <key>`");
            const d = keys.get(args[1].toUpperCase());
            if (!d) return msg.reply(`❌ Not found: \`${args[1]}\``);
            d.blocked=true; keys.set(args[1].toUpperCase(),d);
            return msg.reply(`✓ Revoked.`);
        }

        case "!reset": {
            if (!args[1]) return msg.reply("Usage: `!reset <userId>`");
            let r=0; for (const [k,d] of keys) { if(d.userId===args[1]) { keys.delete(k); r++; } }
            pending.delete(args[1]); cooldowns.delete(args[1]);
            return msg.reply(`✓ Reset <@${args[1]}> — removed ${r} key(s).`);
        }

        case "!remove": {
            if (!args[1]) return msg.reply("Usage: `!remove <userId>`");
            const mids = botDmLog.get(args[1]);
            if (!mids?.length) return msg.reply(`❌ No tracked DMs for \`${args[1]}\`.`);
            let del=0,skip=0;
            try {
                const u  = await bot.users.fetch(args[1]);
                const ch = await u.createDM();
                for (const mid of mids) {
                    try { const m=await ch.messages.fetch(mid); await m.delete(); del++; }
                    catch { skip++; }
                }
            } catch(e) { return msg.reply(`❌ Could not open DM: ${e.message}`); }
            botDmLog.delete(args[1]);
            return msg.reply(`✓ Deleted **${del}** message(s)${skip?` (${skip} already gone)`:""}.`);
        }

        case "!unblock":
            if (!args[1]) return msg.reply("Usage: `!unblock <ip>`");
            failLog.delete(args[1]);
            return msg.reply(`✓ Unblocked: \`${args[1]}\``);

        default:
            return msg.reply("❓ Unknown. Type `!help`.");
    }
});

// ═══════════════════════════════════════════════════════════════
//  EXPRESS API
// ═══════════════════════════════════════════════════════════════
const app = express();
app.use(express.json());

app.get("/ads/ads.js",(_req,res)=>{
    res.setHeader("Content-Type","application/javascript");
    res.send("window.__adOff=true;");
});

app.use((req,res,next)=>{
    if (req.path.startsWith("/ads/")) return next();
    if (CFG.API_SECRET && req.headers["x-api-key"]!==CFG.API_SECRET)
        return res.status(401).json({valid:false,message:"Unauthorized"});
    next();
});

// ── GET /checkpoint?token= ─────────────────────────────────────
app.get("/checkpoint",(req,res)=>{
    const token = req.query.token||"";
    const fail  = (msg,done=0,cur=1,tot=1) => res.send(errPage(msg,done,cur,tot));

    if (!token) return fail("Missing token.");
    const tv = vtokens.get(token);
    if (!tv)     return fail("This link is invalid or does not exist.");
    if (tv.used) return fail("This link has already been used.", tv.step-1, tv.step, 3);
    if (Date.now()-tv.createdAt > CFG.TOKEN_TTL_MS) {
        vtokens.delete(token);
        return fail("Link expired. Type ?getkey in Discord for a new one.");
    }
    const found = getUserKey(tv.userId);
    const pend  = pending.get(tv.userId);
    if (!found) return fail("No key found. Type ?getkey first.");
    if (!pend)  return fail("Session expired. Type ?getkey again.", 0, tv.step, found.data.totalSteps);
    if (tv.step!==pend.currentStep)
        return fail(`Wrong step — complete Step ${pend.currentStep} first.`, found.data.stepsCompleted, tv.step, found.data.totalSteps);

    return res.send(verifyPage(token, found.data.stepsCompleted, tv.step, found.data.totalSteps));
});

// ── GET /challenge?token= ──────────────────────────────────────
app.get("/challenge",(req,res)=>{
    const token=req.query.token||"";
    const tv=vtokens.get(token);
    if (!tv||tv.used) return res.json({ok:false,msg:"Invalid token"});

    const data = challenges.get(token)||{rounds:[],solvedCount:0};
    if (data.rounds.length >= CFG.ROUNDS_NEEDED)
        return res.json({ok:false,msg:"All challenges already loaded"});

    const ch = genChallenge();
    ch.solved = false;
    data.rounds.push(ch);
    challenges.set(token,data);

    return res.json({ok:true, type:ch.type, question:ch.question, data:ch.clientData, round:data.rounds.length});
});

// ── POST /challenge/verify ────────────────────────────────────
app.post("/challenge/verify",(req,res)=>{
    const {token,answer,round} = req.body||{};
    if (!token) return res.json({ok:false,msg:"Missing token"});
    const tv = vtokens.get(token);
    if (!tv||tv.used) return res.json({ok:false,msg:"Invalid token"});

    const data = challenges.get(token);
    if (!data) return res.json({ok:false,msg:"No challenge — reload the page"});

    const idx = (round||1)-1;
    const ch  = data.rounds[idx];
    if (!ch)      return res.json({ok:false,msg:"Challenge not found — reload"});
    if (ch.solved) return res.json({ok:true,msg:"Already solved",solvedCount:data.solvedCount});

    const correct = String(answer||"").trim().toLowerCase() === String(ch.answer).toLowerCase();

    if (!correct) {
        const fresh = genChallenge(); fresh.solved = false;
        data.rounds[idx] = fresh; challenges.set(token,data);
        return res.json({ok:false,msg:"Wrong — new challenge loaded",
            newQuestion:fresh.question, newType:fresh.type, newData:fresh.clientData});
    }

    ch.solved=true; data.solvedCount++; challenges.set(token,data);
    return res.json({ok:true,msg:"Correct!",solvedCount:data.solvedCount});
});

// ── POST /checkpoint/complete ─────────────────────────────────
app.post("/checkpoint/complete",async(req,res)=>{
    const {token}=req.body||{};
    if (!token) return res.json({ok:false,msg:"Missing token"});

    const tv=vtokens.get(token);
    if (!tv||tv.used)           return res.json({ok:false,msg:"Invalid or used token"});
    if (Date.now()-tv.createdAt>CFG.TOKEN_TTL_MS){vtokens.delete(token);return res.json({ok:false,msg:"Token expired"});}

    const data=challenges.get(token);
    if (!data)                              return res.json({ok:false,msg:"No challenge record — reload"});
    if (data.solvedCount<CFG.ROUNDS_NEEDED) return res.json({ok:false,msg:`Complete all ${CFG.ROUNDS_NEEDED} challenges first (${data.solvedCount}/${CFG.ROUNDS_NEEDED} done)`});

    const found=getUserKey(tv.userId);
    const pend=pending.get(tv.userId);
    if (!found||!pend)          return res.json({ok:false,msg:"Session lost — type ?getkey again"});
    if (tv.step!==pend.currentStep) return res.json({ok:false,msg:"Wrong step"});

    tv.used=true; vtokens.set(token,tv);
    challenges.delete(token);
    found.data.stepsCompleted++;
    keys.set(found.key,found.data);

    console.log(`[VOID] ✓ Step ${found.data.stepsCompleted}/${found.data.totalSteps}  user=${tv.userId}`);

    if (found.data.stepsCompleted>=found.data.totalSteps) {
        found.data.expiresAt=Date.now()+found.data.totalSteps*CFG.HOURS_STEP*3_600_000;
        keys.set(found.key,found.data); pending.delete(tv.userId);
        try {
            const user=await bot.users.fetch(tv.userId);
            await sendFinalKeyDM(user,found.key,found.data.totalSteps);
            console.log(`[VOID] 🔑 Key delivered to ${user.tag}  key=${found.key}`);
        } catch(e) { console.error("[VOID] Final key DM error:",e.message); }
        return res.json({ok:true,done:true,
            msg:`All ${found.data.totalSteps} step${found.data.totalSteps>1?"s":""} complete! 🎉<br>Your key has been sent to your <strong>Discord DMs</strong>.`});
    }

    pend.currentStep++; pending.set(tv.userId,pend);
    try {
        const user=await bot.users.fetch(tv.userId);
        await sendCheckpointDM(user,pend.currentStep,found.data.totalSteps);
    } catch(e) { console.error("[VOID] Next checkpoint DM:",e.message); }

    return res.json({ok:true,done:false,
        msg:`Step ${found.data.stepsCompleted} done ✓<br>Check your <strong>Discord DMs</strong> for the next checkpoint.`});
});

// ── GET /validate ─────────────────────────────────────────────
app.get("/validate",(req,res)=>{
    const ip =(req.headers["x-forwarded-for"]||req.socket.remoteAddress||"?").split(",")[0].trim();
    const key=(req.query.key||"").toUpperCase().trim();
    if (ipBlocked(ip))           return res.json({valid:false,message:"Rate limited"});
    if (!key)                    {recordFail(ip);return res.json({valid:false,message:"No key provided"});}
    if (!validHmac(key))         {recordFail(ip);return res.json({valid:false,message:"Invalid key format"});}
    const d=keys.get(key);
    if (!d)                      {recordFail(ip);return res.json({valid:false,message:"Key not found"});}
    if (d.blocked)               return res.json({valid:false,message:"Key revoked"});
    if (d.expiresAt===0)         return res.json({valid:false,message:"Key not activated yet — complete your checkpoints"});
    if (Date.now()>d.expiresAt)  return res.json({valid:false,message:"Key expired — type ?getkey in Discord"});
    const left=fmtMs(d.expiresAt-Date.now());
    console.log(`[VOID] ✓ Validated ${key} (${left} left)`);
    return res.json({valid:true,message:"Access granted",userId:d.userId,expiresIn:left,expiresAt:d.expiresAt,steps:d.totalSteps});
});

app.get("/",(_req,res)=>res.json({status:"ok",keys:keys.size,active:[...keys.values()].filter(d=>!d.blocked&&d.expiresAt>Date.now()).length}));

// ═══════════════════════════════════════════════════════════════
//  PAGE BUILDERS
// ═══════════════════════════════════════════════════════════════
function circles(done,cur,tot) {
    return Array.from({length:tot},(_,i)=>{
        const n=i+1,cls=n<cur?"done":n===cur?"active":"locked";
        return `<div class="step ${cls}"><div class="sc">${cls==="done"?"✓":n}</div>
        <div class="sl">Step ${n}<br><span>${n*24}h</span></div></div>${n<tot?'<div class="ln"></div>':""}`;
    }).join("");
}

function errPage(msg,done,cur,tot){
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VOID — Checkpoint</title><style>${baseCSS()}</style></head><body>
<div class="card"><div class="logo">◈</div><h1>VOID</h1>
<p class="sub">CHECKPOINT ${cur} / ${tot}</p>
<div class="steps">${circles(done,cur,tot)}</div>
<div class="msg" style="color:#ef4444;border-color:#ef444428;background:#ef44440c">${msg}</div>
<a href="javascript:window.close()" class="btn">Close Window</a>
<p class="footer">VOID KEY SYSTEM · DO NOT SHARE YOUR LINKS</p>
</div></body></html>`;
}

function verifyPage(token, done, cur, tot) {
    const ADS_N = CFG.ADS, BASE = CFG.BASE_URL;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VOID — Checkpoint ${cur}/${tot}</title>
<style>
${baseCSS()}
/* ─── Stages ─────────────────────────────────── */
.stage{display:none}.stage.on{display:block}
/* ─── Boxes ─────────────────────────────────── */
.box{background:#07051a;border:1px solid #231b3a;border-radius:14px;padding:20px 18px;margin:10px 0}
.lbl{color:#3d2f60;font-size:9px;letter-spacing:3px;text-transform:uppercase;margin-bottom:12px;font-weight:bold;display:flex;align-items:center;gap:8px}
.lbl-dot{width:6px;height:6px;border-radius:50%;background:#6d28d9}
/* ─── Challenge ───────────────────────────────── */
.qtext{color:#c4b5fd;font-size:14px;line-height:1.9;margin-bottom:16px;text-align:center}
.math-q{font-size:28px;font-weight:900;letter-spacing:4px;color:#e2d9f3;display:block;margin:8px 0}
.color-target{font-size:26px;display:block;margin:8px 0;font-weight:900;letter-spacing:6px}
.word-q{font-size:26px;letter-spacing:10px;color:#e2d9f3;font-weight:900;display:block;margin:8px 0}
.seq-q{font-size:20px;letter-spacing:3px;color:#e2d9f3;font-weight:800;display:block;margin:8px 0}
.emoji-grid{display:flex;flex-wrap:wrap;gap:4px;justify-content:center;margin-top:10px;max-width:280px;margin-left:auto;margin-right:auto}
.emoji-item{width:36px;height:36px;display:flex;align-items:center;justify-content:center}
.inp{width:100%;background:#0e0b1e;border:1px solid #231b3a;border-radius:9px;color:#e2d9f3;
     padding:10px 14px;font-size:14px;outline:none;transition:.2s}
.inp:focus{border-color:#7c3aed;box-shadow:0 0 0 2px #7c3aed1a}
.cbts{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:8px}
.cbt{padding:9px 18px;border-radius:8px;border:1px solid #231b3a;background:#0e0b1e;
     color:#a89dc0;cursor:pointer;font-size:13px;font-weight:bold;transition:.2s;min-width:70px}
.cbt:hover{border-color:#7c3aed;background:#1c1638;color:#c4b5fd}
.cbt.sel{border-color:#a855f7;background:#2d1a60;color:#f3e8ff}
/* Grid challenge */
.grid-wrap{display:inline-grid;gap:6px;margin-top:12px;grid-template-columns:repeat(var(--gc,3),1fr)}
.gcell{background:#0e0b1e;border:1px solid #231b3a;border-radius:10px;padding:10px 8px;
       text-align:center;transition:.2s;user-select:none}
.gcell:hover{border-color:#7c3aed;background:#1c1638}
.gcell.sel{border-color:#a855f7;background:#2d1a60}
.gcell-lbl{font-size:9px;color:#3d2f60;margin-top:4px;font-weight:bold}
/* Round dots */
.rounds{display:flex;gap:12px;justify-content:center;margin-bottom:16px}
.rdot{width:36px;height:36px;border-radius:50%;border:2px solid #1e1535;background:#0e0b1e;
      display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;
      color:#2e2248;transition:.3s;flex-direction:column;gap:1px}
.rdot.done{border-color:#22c55e;background:#0d2010;color:#22c55e;box-shadow:0 0 10px #22c55e30}
.rdot.active{border-color:#a855f7;background:#2d1a60;color:#f3e8ff;box-shadow:0 0 14px #a855f750}
.rdot-sub{font-size:7px;color:#3d2f60;margin-top:-1px}
.rdot.active .rdot-sub,.rdot.done .rdot-sub{color:inherit;opacity:0.6}
/* Status text */
.ok{color:#22c55e;font-size:12px;margin-top:8px;text-align:center}
.er{color:#ef4444;font-size:12px;margin-top:8px;text-align:center}
.in{color:#a855f7;font-size:12px;margin-top:8px;text-align:center}
/* Ad-block warning */
.abwarn{background:#1c0809;border:1px solid #7f1d1d;border-radius:12px;padding:14px 16px;
        color:#f87171;font-size:12px;line-height:1.8;margin-bottom:12px;display:none}
/* ─── VIDEO AD PLAYER ───────────────────────────── */
.vplayer{position:relative;width:100%;border-radius:14px;overflow:hidden;background:#000;
         border:1px solid #1a1030;margin-bottom:12px}
.vscreen{width:100%;height:200px;display:flex;align-items:center;justify-content:center;
         position:relative;overflow:hidden;transition:background 1s ease}
/* Animated "video" scenery layers */
.vscene{position:absolute;inset:0;overflow:hidden}
.vscene-bg{position:absolute;inset:0;transition:opacity 0.8s}
.vscene-layer{position:absolute;border-radius:50%;filter:blur(40px);opacity:0.25;
              animation:pulse 3s ease-in-out infinite alternate}
@keyframes pulse{from{transform:scale(0.9) translate(-5px,-5px)}to{transform:scale(1.1) translate(5px,5px)}}
.vscene-layer2{animation-delay:-1.5s;animation-duration:4s}
.vscene-layer3{animation-delay:-0.7s;animation-duration:2.5s}
/* Ad content overlay */
.vad-content{position:relative;z-index:2;text-align:center;padding:10px;pointer-events:none}
.vad-brand{font-size:11px;letter-spacing:6px;font-weight:900;color:rgba(255,255,255,0.5);margin-bottom:8px;text-transform:uppercase}
.vad-title{font-size:20px;font-weight:900;letter-spacing:3px;color:#fff;margin-bottom:6px;
           text-shadow:0 2px 20px rgba(0,0,0,0.8)}
.vad-sub{font-size:11px;color:rgba(255,255,255,0.6);letter-spacing:2px}
/* Top-right ad badge */
.vad-badge{position:absolute;top:10px;left:10px;background:rgba(0,0,0,0.7);
           border-radius:5px;padding:3px 8px;font-size:9px;color:rgba(255,255,255,0.5);
           letter-spacing:1px;z-index:3}
/* Countdown circle */
.vcountdown{position:absolute;top:10px;right:10px;width:36px;height:36px;z-index:3}
.vcountdown svg{transform:rotate(-90deg)}
.vcountdown-bg{fill:none;stroke:rgba(255,255,255,0.1);stroke-width:3}
.vcountdown-fg{fill:none;stroke:rgba(255,255,255,0.7);stroke-width:3;
               stroke-dasharray:100;stroke-dashoffset:0;transition:stroke-dashoffset 1s linear}
.vcountdown-num{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
                font-size:11px;font-weight:bold;color:rgba(255,255,255,0.8)}
/* Bottom bar */
.vbottom{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#070512}
.vprogress{flex:1;height:3px;background:#1a1030;border-radius:2px;overflow:hidden}
.vpfill{height:100%;background:linear-gradient(90deg,#7c3aed,#a855f7);width:0%;transition:width .5s linear}
.vskip{background:#1a1030;border:1px solid #2a1f45;color:#3d2f60;padding:5px 14px;
       border-radius:6px;font-size:10px;font-weight:bold;cursor:not-allowed;transition:.2s;letter-spacing:1px;white-space:nowrap}
.vskip.rdy{background:#4c1d95;border-color:#7c3aed;color:#e2d9f3;cursor:pointer;letter-spacing:2px}
.vskip.rdy:hover{background:#5b21b6}
.vadnum{font-size:10px;color:#3d2f60;white-space:nowrap}
/* Visit site fake btn */
.vvisit{position:absolute;bottom:52px;right:12px;background:rgba(255,255,255,0.15);
        border:1px solid rgba(255,255,255,0.25);color:rgba(255,255,255,0.7);
        padding:5px 12px;border-radius:6px;font-size:10px;cursor:pointer;z-index:3;
        backdrop-filter:blur(4px);transition:.2s}
.vvisit:hover{background:rgba(255,255,255,0.22)}
</style>
</head>
<body>
<div class="card" style="max-width:500px">
  <div class="logo">◈</div>
  <h1>VOID</h1>
  <p class="sub">CHECKPOINT ${cur} / ${tot}</p>
  <div class="steps">${circles(done,cur,tot)}</div>

  <div class="abwarn" id="abw">
    🚫 <strong>Ad blocker detected!</strong><br>
    Disable it, then <a href="" style="color:#f87171;text-decoration:underline">refresh this page</a>.
  </div>

  <!-- Stage 1: Challenges -->
  <div class="stage on" id="s1">
    <div class="box">
      <div class="lbl"><div class="lbl-dot"></div>Stage 1 of 3 &nbsp;—&nbsp; Challenges</div>
      <div class="rounds">
        <div class="rdot active" id="rd0"><span>1</span><span class="rdot-sub">Round</span></div>
        <div class="rdot"        id="rd1"><span>2</span><span class="rdot-sub">Round</span></div>
        <div class="rdot"        id="rd2"><span>3</span><span class="rdot-sub">Round</span></div>
      </div>
      <div class="qtext" id="qt">Loading challenge…</div>
      <div id="qi"></div>
      <div id="qst" class="in"></div>
    </div>
    <button class="btn" id="chkBtn" onclick="submitAnswer()" disabled>Verify Answer</button>
  </div>

  <!-- Stage 2: Video Ads -->
  <div class="stage" id="s2">
    <div class="box">
      <div class="lbl"><div class="lbl-dot"></div>Stage 2 of 3 &nbsp;—&nbsp; Advertisement</div>
      <div class="vplayer">
        <div class="vscreen" id="vscreen">
          <div class="vscene" id="vscene">
            <div class="vscene-layer"  id="vlayer1"></div>
            <div class="vscene-layer vscene-layer2" id="vlayer2"></div>
            <div class="vscene-layer vscene-layer3" id="vlayer3"></div>
          </div>
          <div class="vad-content">
            <div class="vad-brand"  id="vbrand">VOID MEDIA</div>
            <div class="vad-title"  id="vtitle">LOADING AD</div>
            <div class="vad-sub"    id="vsub">Please wait…</div>
          </div>
          <div class="vad-badge">AD</div>
          <div class="vcountdown" id="vcd">
            <svg viewBox="0 0 36 36" width="36" height="36">
              <circle class="vcountdown-bg" cx="18" cy="18" r="15.9"/>
              <circle class="vcountdown-fg" id="vcdring" cx="18" cy="18" r="15.9"/>
            </svg>
            <div class="vcountdown-num" id="vcdnum">…</div>
          </div>
          <button class="vvisit" id="vvisit" onclick="void(0)">Visit Site ↗</button>
        </div>
        <div class="vbottom">
          <div class="vadnum" id="vadnum">Ad 1 of ${ADS_N}</div>
          <div class="vprogress"><div class="vpfill" id="vpfill"></div></div>
          <button class="vskip" id="vskip" onclick="skipAd()">Skip Ad ›</button>
        </div>
      </div>
      <div id="adst" class="in">Preparing advertisement…</div>
    </div>
  </div>

  <!-- Stage 3: Confirm -->
  <div class="stage" id="s3">
    <div class="box">
      <div class="lbl"><div class="lbl-dot" style="background:#22c55e"></div>Stage 3 of 3 &nbsp;—&nbsp; Complete</div>
      <p style="color:#a89dc0;font-size:13px;line-height:2.1;margin-bottom:8px">
        ✅ &nbsp;All 3 challenges passed<br>
        ✅ &nbsp;All ads watched<br><br>
        Click to complete Checkpoint <strong style="color:#c4b5fd">${cur}</strong>.
      </p>
      <div id="cst" class="in"></div>
    </div>
    <button class="btn" id="cmpBtn" onclick="complete()">Complete Checkpoint ${cur}</button>
  </div>

  <!-- Stage 4: Done -->
  <div class="stage" id="s4">
    <div class="box" style="text-align:center;padding:30px 20px">
      <div style="font-size:48px;margin-bottom:14px">🎉</div>
      <div id="doneMsg" style="color:#22c55e;font-size:14px;line-height:1.9"></div>
    </div>
    <a href="javascript:window.close()" class="btn">Close Window</a>
  </div>

  <p class="footer">VOID KEY SYSTEM · DO NOT SHARE YOUR LINKS</p>
</div>

<script>
(function(){
"use strict";
const TOKEN = ${JSON.stringify(token)};
const ADS   = ${ADS_N};
const BASE  = ${JSON.stringify(BASE)};

let curAns   = "";
let curRound = 0;
let solved   = 0;
let curAd    = 1;
let adInt    = null;
let skipRdy  = false;

// helpers
const $ = id => document.getElementById(id);
const show = (from, to) => { $(from).classList.remove("on"); $(to).classList.add("on"); };

// ── ad-block probe ─────────────────────────────────────────────
async function checkAdBlock(){
    return new Promise(r=>{
        const s=document.createElement("script");
        s.src=BASE+"/ads/ads.js?_="+Date.now();
        s.onload=()=>r(false); s.onerror=()=>r(true);
        document.head.appendChild(s);
        setTimeout(()=>r(!window.__adOff),2800);
    });
}

async function boot(){
    if(await checkAdBlock()){
        $("abw").style.display="block";
        $("s1").classList.remove("on"); return;
    }
    await loadChallenge();
}

// ── challenges ─────────────────────────────────────────────────
async function loadChallenge(rep){
    $("qt").innerHTML="Loading…"; $("qi").innerHTML=""; $("qst").textContent="";
    $("chkBtn").disabled=true; $("chkBtn").textContent="Verify Answer"; curAns="";

    let r=rep;
    if(!r){
        try{r=await fetch(BASE+"/challenge?token="+TOKEN).then(x=>x.json());}
        catch{$("qt").innerHTML="Network error — reload.";return;}
    }
    if(!r||!r.ok){$("qt").innerHTML=r?.msg||"Failed to load.";return;}

    curRound=(r.round||1)-1;
    updateDots();
    $("qt").innerHTML=r.question;

    // wire grid clicks if present
    setTimeout(()=>{
        document.querySelectorAll(".gcell").forEach(el=>{
            el.onclick=()=>{
                document.querySelectorAll(".gcell").forEach(x=>x.classList.remove("sel"));
                el.classList.add("sel");
                curAns=el.dataset.lbl||"";
                $("chkBtn").disabled=false;
            };
        });
    },60);

    const wrap=$("qi");
    if(r.type==="color"){
        const d=document.createElement("div"); d.className="cbts";
        (r.data.opts||[]).forEach(opt=>{
            const b=document.createElement("button"); b.className="cbt"; b.textContent=opt.toUpperCase();
            b.onclick=()=>{wrap.querySelectorAll(".cbt").forEach(x=>x.classList.remove("sel"));b.classList.add("sel");curAns=opt;$("chkBtn").disabled=false;};
            d.appendChild(b);
        });
        wrap.appendChild(d);
    } else if(r.type!=="grid"){
        const inp=document.createElement("input"); inp.className="inp";
        inp.placeholder=r.type==="math"||r.type==="math2"?"Enter the number":r.type==="word"?"Type the unscrambled word":r.type==="count"?"Count and enter":"Your answer";
        inp.oninput=()=>{curAns=inp.value;$("chkBtn").disabled=inp.value.trim()==="";};
        inp.onkeydown=e=>{if(e.key==="Enter"&&curAns.trim())submitAnswer();};
        wrap.appendChild(inp); setTimeout(()=>inp.focus(),80);
    }
}

function updateDots(){
    for(let i=0;i<3;i++){
        const el=$("rd"+i);
        const sp=el.querySelector("span");
        const sub=el.querySelector(".rdot-sub");
        if(i<curRound){el.className="rdot done";sp.textContent="✓";}
        else if(i===curRound){el.className="rdot active";sp.textContent=String(i+1);}
        else{el.className="rdot";sp.textContent=String(i+1);}
        if(sub) sub.textContent="Round";
    }
}

async function submitAnswer(){
    if(!curAns.trim()) return;
    const btn=$("chkBtn"),st=$("qst");
    btn.disabled=true; btn.textContent="Checking…"; st.textContent=""; st.className="in";

    let r;
    try{r=await fetch(BASE+"/challenge/verify",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({token:TOKEN,answer:curAns.trim(),round:curRound+1}),
    }).then(x=>x.json());}
    catch{st.textContent="❌ Network error.";st.className="er";btn.disabled=false;btn.textContent="Try Again";return;}

    if(!r.ok){
        st.textContent="❌ "+r.msg; st.className="er";
        btn.disabled=false; btn.textContent="Try Again";
        if(r.newQuestion) setTimeout(()=>loadChallenge({ok:true,type:r.newType,question:r.newQuestion,data:r.newData,round:curRound+1}),600);
        return;
    }

    solved=r.solvedCount;
    const dot=$("rd"+curRound);
    dot.className="rdot done"; dot.querySelector("span").textContent="✓";

    if(solved>=3){
        st.textContent="✓ All 3 challenges passed!"; st.className="ok";
        btn.textContent="✓ Done";
        setTimeout(()=>{show("s1","s2");playAd(1);},900);
    } else {
        st.textContent="✓ Round "+solved+" correct! Loading next…"; st.className="ok";
        setTimeout(()=>loadChallenge(),700);
    }
}

// global so onclick works
window.pickCell=function(el,lbl){
    document.querySelectorAll(".gcell").forEach(x=>x.classList.remove("sel"));
    el.classList.add("sel"); curAns=lbl; $("chkBtn").disabled=false;
};

// ── VIDEO ADS ──────────────────────────────────────────────────
// Each ad has animated scenes that look like a real video ad
const ADS_DATA=[
    {brand:"VOID PREMIUM",title:"Unlock Everything",sub:"Premium access — no limits",
     colors:["#4c1d95","#7c3aed","#a855f7"],scenes:["#0d0020","#140030","#0d0a30"]},
    {brand:"VOID SECURITY",title:"Military-Grade Protection",sub:"Your scripts. Protected.",
     colors:["#1e3a5f","#2563eb","#60a5fa"],scenes:["#000d20","#001030","#000820"]},
    {brand:"VOID ELITE",title:"Exclusive Access",sub:"Members only — join today",
     colors:["#7c1d3a","#dc2626","#f87171"],scenes:["#200010","#300014","#200008"]},
    {brand:"VOID SPEED",title:"Zero Latency",sub:"Execute at the speed of light",
     colors:["#1a3d1a","#16a34a","#4ade80"],scenes:["#001a00","#002800","#001200"]},
    {brand:"VOID NETWORK",title:"Global Reach",sub:"Connect from anywhere",
     colors:["#1a3030","#0d9488","#2dd4bf"],scenes:["#001a1a","#002828","#001a14"]},
    {brand:"VOID KEYS",title:"Secure Key System",sub:"One key, all access",
     colors:["#3d1a00","#d97706","#fbbf24"],scenes:["#1a0d00","#281400","#1a0a00"]},
];

let sceneInt=null, sceneIdx=0;

function setScene(ad, idx){
    const bg=ad.scenes[idx%ad.scenes.length];
    const c=ad.colors;
    $("vscreen").style.background=bg;
    $("vlayer1").style.cssText=\`width:200px;height:200px;top:-40px;left:-40px;background:\${c[0]}\`;
    $("vlayer2").style.cssText=\`width:160px;height:160px;top:40px;right:-30px;background:\${c[1]}\`;
    $("vlayer3").style.cssText=\`width:120px;height:120px;bottom:-20px;left:40%;background:\${c[2]}\`;
}

function playAd(n){
    curAd=n; skipRdy=false;
    const len=Math.floor(Math.random()*21)+10; // 10-30s
    let sec=len;
    const adData=ADS_DATA[(n-1)%ADS_DATA.length];
    sceneIdx=0;

    // Fill ad content
    $("vbrand").textContent=adData.brand;
    $("vtitle").textContent=adData.title;
    $("vsub").textContent=adData.sub;
    $("vadnum").textContent="Ad "+n+" of "+ADS;
    $("vpfill").style.width="0%";
    $("vskip").className="vskip";
    $("vskip").textContent="Skip Ad ›";
    $("adst").textContent="Watch this ad — skip unlocks after 5s";
    $("adst").className="in";

    // Initial scene
    setScene(adData,0);

    // Animate scene changes every 3s
    if(sceneInt) clearInterval(sceneInt);
    sceneInt=setInterval(()=>{
        sceneIdx++;
        setScene(adData, sceneIdx);
    },3000);

    // Countdown ring circumference ~100
    const circ=100;
    $("vcdring").style.strokeDashoffset="0";

    if(adInt) clearInterval(adInt);
    adInt=setInterval(()=>{
        sec--;
        const elapsed=len-sec;
        const pct=(elapsed/len)*100;
        const ringOff=circ*(1-(sec/len));

        $("vpfill").style.width=pct+"%";
        $("vcdnum").textContent=sec;
        $("vcdring").style.strokeDashoffset=String(ringOff);

        const canSkip=elapsed>=5;
        if(canSkip&&!skipRdy){
            skipRdy=true;
            $("vskip").className="vskip rdy";
            $("vskip").textContent="Skip Ad ›";
            $("adst").textContent="You can skip now, or keep watching";
        } else if(!canSkip){
            const remaining=5-elapsed;
            $("adst").textContent="Skip unlocks in "+remaining+"s";
        }

        if(sec<=0){clearInterval(adInt);if(sceneInt)clearInterval(sceneInt);onAdEnd();}
    },1000);
}

function skipAd(){if(!skipRdy)return;clearInterval(adInt);if(sceneInt)clearInterval(sceneInt);onAdEnd();}

function onAdEnd(){
    $("adst").textContent="✓ Ad "+curAd+" complete";
    $("adst").className="ok";
    if(curAd<ADS){setTimeout(()=>playAd(curAd+1),1200);}
    else{setTimeout(()=>show("s2","s3"),900);}
}

// ── complete ───────────────────────────────────────────────────
async function complete(){
    const btn=$("cmpBtn"),st=$("cst");
    btn.disabled=true; btn.textContent="Submitting…"; st.textContent=""; st.className="in";
    let r;
    try{r=await fetch(BASE+"/checkpoint/complete",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({token:TOKEN}),
    }).then(x=>x.json());}
    catch{st.textContent="❌ Network error.";st.className="er";btn.disabled=false;btn.textContent="Complete Checkpoint ${cur}";return;}
    if(!r.ok){st.textContent="❌ "+r.msg;st.className="er";btn.disabled=false;btn.textContent="Complete Checkpoint ${cur}";return;}
    show("s3","s4"); $("doneMsg").innerHTML=r.msg;
}

window.submitAnswer=submitAnswer;
window.skipAd=skipAd;
window.complete=complete;
window.addEventListener("DOMContentLoaded",boot);
})();
</script>
</body></html>`;
}

function baseCSS(){
    return `
*{margin:0;padding:0;box-sizing:border-box}
body{background:#04030a;color:#a89dc0;font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh;
     display:flex;align-items:center;justify-content:center;padding:20px;
     background-image:radial-gradient(ellipse at 50% 0%,#1a0a3010 0%,transparent 70%)}
.card{background:linear-gradient(160deg,#0e0b1c,#060410);border:1px solid #231b3a;
      border-radius:22px;padding:34px 30px;max-width:480px;width:100%;text-align:center;
      box-shadow:0 0 60px #6d28d90a,0 0 30px #00000060;position:relative;overflow:hidden}
.card::before{content:'';position:absolute;top:0;left:8%;right:8%;height:1px;
              background:linear-gradient(90deg,transparent,#7c3aed38,transparent)}
.logo{font-size:42px;color:#7c3aed;margin-bottom:10px;filter:drop-shadow(0 0 12px #7c3aed42)}
h1{color:#e2d9f3;font-size:19px;letter-spacing:10px;font-weight:900;margin-bottom:4px}
.sub{color:#3d2f60;font-size:10px;letter-spacing:4px;margin-bottom:22px}
.steps{display:flex;align-items:center;justify-content:center;margin-bottom:18px;flex-wrap:wrap}
.step{display:flex;flex-direction:column;align-items:center;gap:7px}
.ln{width:18px;height:2px;background:#1e1535;margin-bottom:16px}
.step.done+.ln{background:#7c3aed45}
.sc{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;
    font-size:13px;font-weight:800;border:2px solid #1e1535;background:#0e0b1e;color:#2e2248}
.step.done  .sc{background:#2d1a60;border-color:#7c3aed;color:#c4b5fd;box-shadow:0 0 10px #7c3aed30}
.step.active .sc{background:#3b1f70;border-color:#a855f7;color:#f3e8ff;box-shadow:0 0 16px #a855f748}
.sl{font-size:9px;color:#2e2248;text-align:center;line-height:1.4}
.sl span{color:#6d28d9;font-weight:bold}
.step.done .sl,.step.active .sl{color:#8b7aaa}
.step.done .sl span,.step.active .sl span{color:#a855f7}
.msg{padding:14px 16px;border-radius:12px;font-size:13px;line-height:1.7;margin-bottom:18px;border:1px solid}
.btn{display:block;background:linear-gradient(135deg,#5b21b6,#7c3aed);color:#f3e8ff;border:none;
     border-radius:12px;padding:13px 24px;font-size:11px;font-weight:800;letter-spacing:3px;
     cursor:pointer;text-decoration:none;transition:.18s;width:100%;margin-top:8px;
     box-shadow:0 4px 16px #7c3aed1e}
.btn:hover:not(:disabled){background:linear-gradient(135deg,#6d28d9,#9333ea);transform:translateY(-1px)}
.btn:disabled{opacity:.4;cursor:not-allowed}
.footer{margin-top:18px;font-size:9px;color:#1e1535;letter-spacing:2px}`;
}

// ═══════════════════════════════════════════════════════════════
//  CLEANUP + KEEPALIVE
// ═══════════════════════════════════════════════════════════════
setInterval(()=>{
    const now=Date.now(); let k=0,t=0;
    for(const[id,d] of keys)     if(!d.blocked&&d.expiresAt>0&&now>d.expiresAt+3_600_000){keys.delete(id);k++;}
    for(const[id,tv] of vtokens) if(tv.used||now-tv.createdAt>CFG.TOKEN_TTL_MS*2){vtokens.delete(id);t++;}
    for(const[id] of challenges) if(!vtokens.has(id)) challenges.delete(id);
    for(const[id,ts] of cooldowns) if(now-ts>CFG.COOLDOWN_MS*15) cooldowns.delete(id);
    for(const[id,p] of pending)  if(now-p.createdAt>4*3_600_000) pending.delete(id);
    for(const[ip,r] of failLog)  if(r.blockedUntil&&now>r.blockedUntil+3_600_000) failLog.delete(ip);
    console.log(`[VOID] 🧹 Cleanup — keys:${k} tokens:${t}`);
}, CFG.CLEANUP_MS);

(function keepAlive(){
    const url=CFG.BASE_URL;
    if(!url||url.includes("localhost")) return;
    setInterval(()=>{
        const mod=url.startsWith("https")?https:http;
        const req=mod.get(url,r=>console.log(`[VOID] 💓 ${r.statusCode}`));
        req.on("error",e=>console.warn("[VOID] keep-alive:",e.message));
        req.end();
    }, CFG.KEEPALIVE_MS);
    console.log("[VOID] 💓 Keep-alive started");
})();

// ═══════════════════════════════════════════════════════════════
//  LAUNCH
// ═══════════════════════════════════════════════════════════════
app.listen(CFG.PORT,()=>console.log(`[VOID] ✓ API on port ${CFG.PORT}`));

process.on("unhandledRejection",e=>console.error("[VOID] Rejection:",e?.message||e));
process.on("uncaughtException", e=>console.error("[VOID] Exception:", e?.message||e));

bot.login(CFG.TOKEN).catch(e=>{
    console.error("[VOID] LOGIN FAILED:",e.message); process.exit(1);
});
