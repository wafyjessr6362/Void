/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║             V O I D   K E Y   S Y S T E M  —  v6.0                    ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║  FLOW (no approve/deny — instant):                                     ║
 * ║  1. User types ?getkey → bot says "Check your DMs!" (auto-del 2s)     ║
 * ║  2. 5-minute cooldown applied instantly                                ║
 * ║  3. DM: pick 1–10 steps (each step = exactly +24h, never multiplied)  ║
 * ║  4. Each checkpoint page requires:                                     ║
 * ║     a) Ad-block HARD wall — page locked until disabled                ║
 * ║     b) 3 server-verified challenges in a row                          ║
 * ║        Wrong answer = new challenge generated, never auto-passes       ║
 * ║     c) Hold-the-button 5s human check                                 ║
 * ║     d) Watch N ads sequentially (10-30s each, skip after 5s)         ║
 * ║     e) POST /checkpoint/complete — server checks allSolved flag       ║
 * ║  5. After all steps → key DM'd immediately                            ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║  ENV: BOT_TOKEN  GUILD_ID  GET_KEY_CHANNEL_ID                         ║
 * ║       KEY_SECRET  BASE_URL  API_SECRET  ADS                           ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║  ADMIN DM COMMANDS:                                                    ║
 * ║  !help  !stats  !listkeys  !pending  !revoke <key>                    ║
 * ║  !reset <userId>  !unblock <ip>  !remove <userId>                     ║
 * ║  IN CHANNEL: ?getkey  ?removekey @User                                ║
 * ║  SLASH: /removemessage <link>  /rm <link>                             ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
"use strict";

const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder,
        ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
        StringSelectMenuOptionBuilder, SlashCommandBuilder, REST, Routes,
        Events, PermissionFlagsBits } = require("discord.js");
const express = require("express");
const crypto  = require("crypto");
const https   = require("https");
const http    = require("http");

// ════════════════════════════════════════════════════════════════════
//  CONFIG
// ════════════════════════════════════════════════════════════════════
const CFG = {
    TOKEN:      process.env.BOT_TOKEN,
    GUILD_ID:   process.env.GUILD_ID,
    KEY_CH:     process.env.GET_KEY_CHANNEL_ID,
    KEY_SECRET: process.env.KEY_SECRET  || "void_CHANGE_ME_2026",
    API_SECRET: process.env.API_SECRET  || "",
    PORT:       process.env.PORT        || 3000,
    BASE_URL:   process.env.BASE_URL    || "https://void-r3co.onrender.com",
    ADS:        Math.min(5, Math.max(1, parseInt(process.env.ADS || "1"))),
    CH_DEL:     2_000,
    COOLDOWN:   5 * 60_000,
    TOKEN_TTL:  15 * 60_000,
    CLEANUP:    60 * 60_000,
    KEEPALIVE:  10 * 60_000,
    MAX_FAILS:  5,
    FAIL_WIN:   10 * 60_000,
    BLOCK_DUR:  60 * 60_000,
    H_PER_STEP: 24,
    MAX_STEPS:  10,
};

// ════════════════════════════════════════════════════════════════════
//  STARTUP
// ════════════════════════════════════════════════════════════════════
console.log("╔═════════════════════════════════════════╗");
console.log("║  VOID KEY SYSTEM  v6.0  STARTING  ◈    ║");
console.log("╚═════════════════════════════════════════╝");
console.log("  BOT_TOKEN            " + (CFG.TOKEN    ? "✓" : "✗ MISSING"));
console.log("  GUILD_ID             " + (CFG.GUILD_ID ? "✓" : "✗ MISSING"));
console.log("  GET_KEY_CHANNEL_ID   " + (CFG.KEY_CH   ? "✓" : "✗ MISSING"));
console.log("  ADS per checkpoint    " + CFG.ADS);
console.log("  BASE_URL             " + CFG.BASE_URL + "\n");
if (!CFG.TOKEN)    { console.error("[VOID] FATAL: BOT_TOKEN missing");          process.exit(1); }
if (!CFG.GUILD_ID) { console.error("[VOID] FATAL: GUILD_ID missing");           process.exit(1); }
if (!CFG.KEY_CH)   { console.error("[VOID] FATAL: GET_KEY_CHANNEL_ID missing"); process.exit(1); }

// ════════════════════════════════════════════════════════════════════
//  STORES
// ════════════════════════════════════════════════════════════════════
const keys       = new Map(); // keyStr  -> {userId,createdAt,totalSteps,stepsCompleted,expiresAt,blocked}
const pending    = new Map(); // userId  -> {totalSteps,currentStep,keyStr,createdAt}
const vtokens    = new Map(); // token   -> {userId,step,createdAt,used}
const challenges = new Map(); // token   -> {stages:[],stageIdx,allSolved}
const cooldowns  = new Map(); // userId  -> timestamp
const failLog    = new Map(); // ip      -> {count,firstFail,blockedUntil}
const dmHistory  = new Map(); // userId  -> Set<msgId>

// ════════════════════════════════════════════════════════════════════
//  KEY CRYPTO
// ════════════════════════════════════════════════════════════════════
function makeKey() {
    const cs = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const segs = Array.from({length:3}, () => Array.from({length:4}, () => cs[Math.floor(Math.random()*cs.length)]).join(""));
    const raw = "VOID-" + segs.join("-");
    const chk = crypto.createHmac("sha256", CFG.KEY_SECRET).update(raw).digest("hex").slice(0,4).toUpperCase();
    return raw + "-" + chk;
}
function validKey(key) {
    const parts = key.split("-");
    if (parts.length < 5) return false;
    const chk = parts.at(-1);
    const raw  = parts.slice(0,-1).join("-");
    const exp  = crypto.createHmac("sha256", CFG.KEY_SECRET).update(raw).digest("hex").slice(0,4).toUpperCase();
    return chk === exp;
}
function makeToken(userId, step) {
    const t = crypto.randomBytes(32).toString("hex");
    vtokens.set(t, {userId, step, createdAt:Date.now(), used:false});
    return t;
}

// ════════════════════════════════════════════════════════════════════
//  CHALLENGE ENGINE  —  3 stages per checkpoint
// ════════════════════════════════════════════════════════════════════
function makeStage() {
    const pick = a => a[Math.floor(Math.random()*a.length)];
    const ri   = (lo,hi) => Math.floor(Math.random()*(hi-lo+1))+lo;
    const type = pick(["math","color","word","count","sequence","grid"]);

    if (type === "math") {
        const op = pick(["+","-","*"]);
        const a  = ri(2,25), b = ri(2,15);
        const ans = op==="+"?a+b : op==="-"?a-b : a*b;
        return {type, answer:String(ans), clientData:{},
            question:"Solve: <strong class=cq>"+a+" "+op+" "+b+" = ?</strong>"};
    }
    if (type === "color") {
        const all = ["red","blue","green","yellow","purple","orange","pink","cyan","white","lime"];
        const tgt = pick(all);
        const opts = [tgt];
        while(opts.length<4){const c=pick(all);if(!opts.includes(c))opts.push(c);}
        opts.sort(()=>Math.random()-0.5);
        return {type, answer:tgt, clientData:{opts},
            question:"Click the color: <strong class=cq style='color:"+tgt+"'>"+tgt.toUpperCase()+"</strong>"};
    }
    if (type === "word") {
        const words = ["VOID","ACCESS","SECURE","TOKEN","SHIELD","VAULT","CIPHER","GHOST","NEXUS","PORTAL"];
        const tgt   = pick(words);
        const jum   = tgt.split("").sort(()=>Math.random()-0.5).join("");
        return {type, answer:tgt, clientData:{},
            question:"Unscramble: <strong class=cq style='letter-spacing:5px'>"+jum+"</strong>"};
    }
    if (type === "count") {
        const emojis = ["⭐","🔵","🟣","🔷","💎","🌀","🔺","🟡","🔴","🟢"];
        const emoji  = pick(emojis);
        const n      = ri(4,11);
        return {type, answer:String(n), clientData:{},
            question:"Count all <strong class=cq>"+emoji+"</strong>:<br><div style='font-size:20px;line-height:2;margin-top:8px'>"+emoji.repeat(n)+"</div>"};
    }
    if (type === "sequence") {
        const start = ri(1,10), step = ri(2,6);
        const seq   = [start,start+step,start+step*2,start+step*3];
        return {type, answer:String(start+step*4), clientData:{},
            question:"What comes next?<br><strong class=cq style='font-size:20px;letter-spacing:4px'>"+seq.join("  →  ")+"  →  ?</strong>"};
    }
    // grid
    const size=9, target=ri(0,8);
    const cells = Array.from({length:size},(_,i)=>
        "<div style='background:"+(i===target?"#fff":"#1a1030")+";border-radius:5px;width:34px;height:34px'></div>").join("");
    return {type:"grid", answer:String(target+1), clientData:{},
        question:"Which position is white? (1–9)<br><div style='display:grid;grid-template-columns:repeat(3,1fr);gap:5px;width:114px;margin:12px auto'>"+cells+"</div>"};
}

function makeChallengeSession(token) {
    const stages = [makeStage(), makeStage(), makeStage()];
    challenges.set(token, {stages, stageIdx:0, allSolved:false});
    const s = stages[0];
    return {ok:true, stage:1, totalStages:3, type:s.type, question:s.question, data:s.clientData};
}

// ════════════════════════════════════════════════════════════════════
//  UTILITY
// ════════════════════════════════════════════════════════════════════
const fmtMs = ms => {
    if(ms<=0) return "expired";
    const h=Math.floor(ms/3600000), m=Math.floor((ms%3600000)/60000);
    return h?h+"h "+m+"m":m+"m";
};
const bar = (done,total) =>
    Array.from({length:total},(_,i)=>i<done?"🟣":"⚫").join(" ")+"  ("+done+"/"+total+")";
const getKey = uid => { for(const[k,d]of keys)if(d.userId===uid&&!d.blocked)return{key:k,data:d}; return null; };
const onCD   = uid => { const t=cooldowns.get(uid); return t&&Date.now()-t<CFG.COOLDOWN; };
const cdLeft = uid => { const t=cooldowns.get(uid); return t?Math.max(0,CFG.COOLDOWN-(Date.now()-t)):0; };
const setCD  = uid => cooldowns.set(uid,Date.now());
const doFail = ip  => {
    const now=Date.now(),r=failLog.get(ip)||{count:0,firstFail:now,blockedUntil:0};
    if(now-r.firstFail>CFG.FAIL_WIN){r.count=0;r.firstFail=now;}
    r.count++;
    if(r.count>=CFG.MAX_FAILS) r.blockedUntil=now+CFG.BLOCK_DUR;
    failLog.set(ip,r);
};
const isBlocked = ip => { const r=failLog.get(ip); return!!(r?.blockedUntil&&Date.now()<r.blockedUntil); };
const parseLnk  = link => { const m=link.match(/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/); return m?{guildId:m[1],channelId:m[2],messageId:m[3]}:null; };
const delMsg    = (msg,ms) => setTimeout(()=>msg.delete().catch(()=>{}),ms);

async function dmUser(user, payload) {
    try {
        const sent = await user.send(payload);
        if(!dmHistory.has(user.id)) dmHistory.set(user.id,new Set());
        dmHistory.get(user.id).add(sent.id);
        return sent;
    } catch(e) { console.warn("[VOID] DM failed to "+user.tag+":",e.message); return null; }
}

// ════════════════════════════════════════════════════════════════════
//  EMBEDS
// ════════════════════════════════════════════════════════════════════
const C = {P:0x6d28d9, G:0x22c55e, R:0xef4444, Y:0xf59e0b};

function stepSelectorPayload(user) {
    const opts = Array.from({length:CFG.MAX_STEPS},(_,i)=>{
        const n=i+1, h=n*CFG.H_PER_STEP;
        const d=Math.floor(h/24), r=h%24;
        const time = d>0?(d+"d"+(r>0?" "+r+"h":"")) : h+"h";
        return new StringSelectMenuOptionBuilder()
            .setLabel(n+" Step"+(n>1?"s":"")+" — "+time)
            .setDescription(n+" checkpoint"+(n>1?"s":"")+" → "+h+"h access")
            .setValue(String(n))
            .setEmoji(["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"][i]);
    });
    return {
        embeds:[new EmbedBuilder().setColor(C.P)
            .setTitle("◈  VOID — Select Verification Steps")
            .setDescription("Choose how many steps to complete.\n**Each step adds exactly `+24h`** — steps never multiply.\n\n> 1 step = 24h  |  5 = 120h  |  10 = 240h")
            .addFields({name:"⚡ Each Checkpoint Requires",value:"• Ad blocker **disabled**\n• **3 server-verified challenges** in sequence\n• 5-second hold verification\n• Watch **"+CFG.ADS+" ad"+(CFG.ADS>1?"s":"")+"** (up to 30s each)\n• Click confirm"})
            .setFooter({text:"VOID Key System · Steps 1–10"}).setTimestamp()],
        components:[new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId("stepsel_"+user.id)
                .setPlaceholder("🔑  Pick your steps (1–10)…")
                .addOptions(opts))],
    };
}

function checkpointPayload(user, step, totalSteps) {
    const token = makeToken(user.id, step);
    const link  = CFG.BASE_URL+"/checkpoint?token="+token;
    return {
        embeds:[new EmbedBuilder().setColor(C.P)
            .setTitle("◈  Checkpoint "+step+" / "+totalSteps)
            .setDescription("Complete the verification below for **+"+CFG.H_PER_STEP+"h** access.")
            .addFields(
                {name:"📍 Progress",   value:bar(step-1,totalSteps)},
                {name:"⏱ Expires",    value:"**15 minutes**",                           inline:true},
                {name:"🎁 After This", value:"**"+(step*CFG.H_PER_STEP)+"h** total",    inline:true},
                {name:"📋 What To Do", value:"1. Click button below\n2. Disable ad blocker\n3. Solve **3 challenges** in a row\n4. Hold button 5 seconds\n5. Watch **"+CFG.ADS+" ad"+(CFG.ADS>1?"s":"")+"**\n6. Hit Complete"},
                {name:"⚠️ Warning",    value:"One-time link. Do not share."})
            .setFooter({text:"VOID Key System · Step "+step+"/"+totalSteps}).setTimestamp()],
        components:[new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel("  Complete Checkpoint "+step).setStyle(ButtonStyle.Link).setURL(link).setEmoji("✅"))],
    };
}

function finalKeyPayload(key, totalSteps) {
    const h = totalSteps * CFG.H_PER_STEP;
    return {
        embeds:[new EmbedBuilder().setColor(C.G)
            .setTitle("◈  All Checkpoints Done! 🎉")
            .setDescription("**"+totalSteps+" × 24h = "+h+"h** of access unlocked.")
            .addFields(
                {name:"🔑 Your Key",   value:"```\n"+key+"\n```"},
                {name:"📍 Completed",  value:bar(totalSteps,totalSteps)},
                {name:"⏳ Valid For",   value:"**"+h+" hours**",                 inline:true},
                {name:"🔒 Secured",    value:"**"+totalSteps+"-Step Verified**", inline:true},
                {name:"⚠️ Important",  value:"**Never share this key.** It is bound to your Discord account."})
            .setFooter({text:"VOID Key System · Keep this safe!"}).setTimestamp()],
    };
}

// ════════════════════════════════════════════════════════════════════
//  DISCORD CLIENT
// ════════════════════════════════════════════════════════════════════
const client = new Client({
    intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,
             GatewayIntentBits.MessageContent,GatewayIntentBits.DirectMessages],
    partials:[Partials.Channel,Partials.Message],
});
client.once("ready", async () => {
    console.log("[VOID] ✓ Online as "+client.user.tag);
    client.user.setActivity("?getkey",{type:3});
    await registerSlash();
});
client.on("error", e=>console.error("[VOID] Client error:",e.message));

async function registerSlash() {
    const wl = b => b.addStringOption(o=>o.setName("link").setDescription("Full Discord message link").setRequired(true));
    const cmds = [
        wl(new SlashCommandBuilder().setName("removemessage").setDescription("Delete a message by its link").setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)).toJSON(),
        wl(new SlashCommandBuilder().setName("rm").setDescription("Delete a message by link (alias)").setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)).toJSON(),
    ];
    try {
        const rest = new REST({version:"10"}).setToken(CFG.TOKEN);
        await rest.put(Routes.applicationGuildCommands(client.user.id,CFG.GUILD_ID),{body:cmds});
        console.log("[VOID] ✓ Slash commands registered: /removemessage /rm");
    } catch(e) { console.error("[VOID] Slash register error:",e.message); }
}

// ════════════════════════════════════════════════════════════════════
//  ?getkey + ?removekey
// ════════════════════════════════════════════════════════════════════
client.on("messageCreate", async msg => {
    if(msg.author.bot || msg.channelId !== CFG.KEY_CH) return;
    const raw = msg.content.trim().toLowerCase();

    if(raw.startsWith("?removekey")) {
        try{await msg.delete();}catch{}
        const guild = await client.guilds.fetch(CFG.GUILD_ID).catch(()=>null);
        if(!guild||msg.author.id!==guild.ownerId){
            const w=await msg.channel.send("<@"+msg.author.id+"> ❌ Owner only.");
            delMsg(w,4000);return;
        }
        const target = msg.mentions.users.first();
        if(!target){const w=await msg.channel.send("❌ Usage: `?removekey @User`");delMsg(w,4000);return;}
        let n=0;
        for(const[k,d]of keys){if(d.userId===target.id){keys.delete(k);n++;}}
        pending.delete(target.id);cooldowns.delete(target.id);
        const w=await msg.channel.send(n>0?"✓ Removed **"+n+"** key(s) for <@"+target.id+">.":"❌ No keys for <@"+target.id+">.");
        delMsg(w,5000);
        if(n>0){try{await dmUser(target,{embeds:[new EmbedBuilder().setColor(C.R).setTitle("◈  Key Removed").setDescription("Your key was removed.\nType `?getkey` to request a new one.").setTimestamp()]});}catch{}}
        return;
    }

    if(raw!=="?getkey") return;
    try{await msg.delete();}catch{}
    const user=msg.author;

    const found=getKey(user.id);
    if(found?.data.expiresAt>Date.now()){
        const w=await msg.channel.send("<@"+user.id+"> ✓ Check your DMs!");
        delMsg(w,CFG.CH_DEL);
        await dmUser(user,{embeds:[new EmbedBuilder().setColor(C.P).setTitle("◈  You Already Have an Active Key")
            .addFields({name:"🔑 Key",value:"```\n"+found.key+"\n```"},{name:"⏳ Expires",value:"in **"+fmtMs(found.data.expiresAt-Date.now())+"**"})
            .setFooter({text:"Do not share your key."}).setTimestamp()]});
        return;
    }
    if(onCD(user.id)){
        const w=await msg.channel.send("<@"+user.id+"> ⏱ Cooldown — wait **"+fmtMs(cdLeft(user.id))+"**.");
        delMsg(w,CFG.CH_DEL);return;
    }
    setCD(user.id);
    if(pending.has(user.id)){
        const w=await msg.channel.send("<@"+user.id+"> ✓ Check your DMs!");
        delMsg(w,CFG.CH_DEL);
        const p=pending.get(user.id);
        await dmUser(user,checkpointPayload(user,p.currentStep,p.totalSteps));
        return;
    }
    const w=await msg.channel.send("<@"+user.id+"> ✓ Check your DMs!");
    delMsg(w,CFG.CH_DEL);
    await dmUser(user,stepSelectorPayload(user));
    console.log("[VOID] Step selector sent to "+user.tag);
});

// ════════════════════════════════════════════════════════════════════
//  INTERACTIONS
// ════════════════════════════════════════════════════════════════════
client.on(Events.InteractionCreate, async interaction => {
    if(interaction.isChatInputCommand()&&["removemessage","rm"].includes(interaction.commandName)){
        await interaction.deferReply({ephemeral:true});
        const parsed=parseLnk(interaction.options.getString("link")||"");
        if(!parsed) return interaction.editReply("❌ Invalid message link.");
        if(parsed.guildId!==CFG.GUILD_ID) return interaction.editReply("❌ Not from this server.");
        try{
            const ch=await client.channels.fetch(parsed.channelId);
            const m=await ch.messages.fetch(parsed.messageId);
            await m.delete();
            console.log("[VOID] Deleted msg "+parsed.messageId+" by "+interaction.user.tag);
            return interaction.editReply("✓ Deleted.");
        }catch(e){return interaction.editReply("❌ "+e.message);}
    }

    if(interaction.isStringSelectMenu()&&interaction.customId.startsWith("stepsel_")){
        const uid=interaction.customId.replace("stepsel_","");
        if(interaction.user.id!==uid) return interaction.reply({content:"❌ Not for you.",ephemeral:true});
        const steps=parseInt(interaction.values[0]);
        const hours=steps*CFG.H_PER_STEP;
        await interaction.update({
            embeds:[new EmbedBuilder().setColor(C.P).setTitle("◈  Steps Confirmed ✓")
                .setDescription("**"+steps+" step"+(steps>1?"s":"")+"** → **"+steps+" × 24h = "+hours+"h** access.\n\nYour first checkpoint link is on the way. ↓")
                .setFooter({text:"Do not share your checkpoint links."}).setTimestamp()],
            components:[],
        });
        const newKey=makeKey();
        keys.set(newKey,{userId:interaction.user.id,createdAt:Date.now(),totalSteps:steps,stepsCompleted:0,expiresAt:0,blocked:false});
        pending.set(interaction.user.id,{totalSteps:steps,currentStep:1,keyStr:newKey,createdAt:Date.now()});
        console.log("[VOID] "+interaction.user.tag+" → "+steps+" steps, key: "+newKey);
        const cp=checkpointPayload(interaction.user,1,steps);
        const sent=await interaction.user.send(cp).catch(()=>null);
        if(sent){if(!dmHistory.has(interaction.user.id))dmHistory.set(interaction.user.id,new Set());dmHistory.get(interaction.user.id).add(sent.id);}
    }
});

// ════════════════════════════════════════════════════════════════════
//  ADMIN DM COMMANDS
// ════════════════════════════════════════════════════════════════════
client.on("messageCreate", async msg => {
    if(msg.author.bot||msg.channel.type!==1) return;
    const guild=await client.guilds.fetch(CFG.GUILD_ID).catch(()=>null);
    if(!guild||msg.author.id!==guild.ownerId) return;
    const args=msg.content.trim().split(/\s+/);
    const cmd=args[0]?.toLowerCase();

    if(cmd==="!help") return msg.reply(
        "```\nVOID KEY SYSTEM — ADMIN COMMANDS\n"+"═".repeat(34)+"\n\n"+
        "DM TO BOT:\n"+
        "  !help                 This menu\n"+
        "  !stats                System statistics\n"+
        "  !listkeys             All keys + status\n"+
        "  !pending              Users mid-verification\n"+
        "  !revoke <key>         Revoke a key\n"+
        "  !reset <userId>       Wipe all user data\n"+
        "  !unblock <ip>         Unblock an IP\n"+
        "  !remove <userId>      Delete all bot DM msgs sent to user\n\n"+
        "IN CHANNEL:\n"+
        "  ?getkey               Request a key\n"+
        "  ?removekey @User      Remove user key (owner)\n\n"+
        "SLASH:\n"+
        "  /removemessage <link>\n"+
        "  /rm <link>\n"+
        "```");

    if(cmd==="!stats"){
        const all=[...keys.values()];
        return msg.reply("```\nVOID STATS\n"+"═".repeat(12)+"\n"+
            "Total keys      : "+keys.size+"\n"+
            "Active          : "+all.filter(d=>!d.blocked&&d.expiresAt>Date.now()).length+"\n"+
            "Awaiting steps  : "+all.filter(d=>d.expiresAt===0&&!d.blocked).length+"\n"+
            "Expired         : "+all.filter(d=>d.expiresAt>0&&Date.now()>d.expiresAt).length+"\n"+
            "Revoked         : "+all.filter(d=>d.blocked).length+"\n"+
            "In verification : "+pending.size+"\n"+
            "On cooldown     : "+cooldowns.size+"\n```");
    }

    if(cmd==="!listkeys"){
        if(!keys.size) return msg.reply("No keys.");
        let out="**Keys ("+keys.size+"):**\n";
        for(const[k,d]of keys){
            const st=d.blocked?"🚫 revoked":d.expiresAt===0?"⏸ step "+d.stepsCompleted+"/"+d.totalSteps:Date.now()>d.expiresAt?"💀 expired":"✓ "+fmtMs(d.expiresAt-Date.now())+" left";
            out+="`"+k+"` <@"+d.userId+"> ["+st+"]\n";
        }
        for(const c of(out.match(/[\s\S]{1,1900}/g)||[])) await msg.reply(c);
        return;
    }

    if(cmd==="!pending"){
        if(!pending.size) return msg.reply("No users mid-verification.");
        let out="**Mid-verification ("+pending.size+"):**\n";
        for(const[uid,p]of pending)
            out+="<@"+uid+"> step "+p.currentStep+"/"+p.totalSteps+" — "+fmtMs(Date.now()-p.createdAt)+" ago\n";
        return msg.reply(out.slice(0,2000));
    }

    if(cmd==="!revoke"){
        if(!args[1]) return msg.reply("Usage: `!revoke <key>`");
        const key=args[1].toUpperCase(),data=keys.get(key);
        if(!data) return msg.reply("❌ Not found: `"+key+"`");
        data.blocked=true;keys.set(key,data);
        console.log("[VOID] Revoked: "+key);
        return msg.reply("✓ Revoked `"+key+"`");
    }

    if(cmd==="!reset"){
        if(!args[1]) return msg.reply("Usage: `!reset <userId>`");
        const uid=args[1];let n=0;
        for(const[k,d]of keys){if(d.userId===uid){keys.delete(k);n++;}}
        pending.delete(uid);cooldowns.delete(uid);
        vtokens.forEach((tv,t)=>{if(tv.userId===uid){vtokens.delete(t);challenges.delete(t);}});
        console.log("[VOID] Reset "+uid);
        return msg.reply("✓ Reset <@"+uid+"> — removed "+n+" key(s).");
    }

    if(cmd==="!unblock"){
        if(!args[1]) return msg.reply("Usage: `!unblock <ip>`");
        failLog.delete(args[1]);
        return msg.reply("✓ Unblocked `"+args[1]+"`");
    }

    if(cmd==="!remove"){
        if(!args[1]) return msg.reply("Usage: `!remove <userId>`");
        const uid=args[1];
        await msg.reply("⏳ Deleting bot DM messages for <@"+uid+">…");
        let deleted=0,failed=0;
        try {
            const targetUser=await client.users.fetch(uid);
            const dmChan=await targetUser.createDM();
            // Delete tracked messages
            const tracked=dmHistory.get(uid);
            if(tracked?.size){
                for(const msgId of tracked){
                    try{const m=await dmChan.messages.fetch(msgId).catch(()=>null);if(m&&m.author.id===client.user.id){await m.delete();deleted++;}}
                    catch{failed++;}
                }
                dmHistory.delete(uid);
            }
            // Scan DM channel for any remaining bot messages
            let before=undefined;
            for(let page=0;page<15;page++){
                const opts={limit:100};if(before)opts.before=before;
                const fetched=await dmChan.messages.fetch(opts).catch(()=>null);
                if(!fetched||!fetched.size) break;
                for(const[,m]of fetched){
                    if(m.author.id===client.user.id){
                        try{await m.delete();deleted++;}catch{failed++;}
                    }
                }
                before=fetched.last()?.id;
                if(fetched.size<100) break;
                await new Promise(r=>setTimeout(r,500));
            }
        } catch(e){console.warn("[VOID] !remove error:",e.message);}
        console.log("[VOID] !remove <@"+uid+">: deleted="+deleted+" failed="+failed);
        return msg.reply("✓ Deleted **"+deleted+"** bot message(s) from <@"+uid+">'s DMs."+(failed?" ("+failed+" failed)":""));
    }

    return msg.reply("❓ Unknown command. Type `!help`.");
});

// ════════════════════════════════════════════════════════════════════
//  EXPRESS API
// ════════════════════════════════════════════════════════════════════
const app = express();
app.use(express.json());
app.get("/ads/ads.js",(_,res)=>{res.setHeader("Content-Type","application/javascript");res.send("window.__voidAdOk=true;");});
app.use((req,res,next)=>{
    if(req.path.startsWith("/ads/")) return next();
    if(CFG.API_SECRET&&req.headers["x-api-key"]!==CFG.API_SECRET) return res.status(401).json({valid:false,message:"Unauthorized"});
    next();
});

app.get("/checkpoint", async(req,res)=>{
    const t=req.query.token||"";
    const E=(msg,d=0,c=1,tot=1)=>res.send(buildPage({state:"error",msg,done:d,cur:c,tot,token:t}));
    if(!t) return E("Missing token.");
    const tv=vtokens.get(t);
    if(!tv) return E("Invalid or expired link.");
    if(tv.used) return E("This link was already used.",tv.step-1,tv.step,3);
    if(Date.now()-tv.createdAt>CFG.TOKEN_TTL){vtokens.delete(t);return E("Link expired. Type ?getkey in Discord.");}
    const found=getKey(tv.userId);
    const pend=pending.get(tv.userId);
    if(!found) return E("No key found. Type ?getkey first.");
    if(!pend)  return E("Session expired. Type ?getkey again.",0,tv.step,found.data.totalSteps);
    if(tv.step!==pend.currentStep) return E("Wrong step. Complete Step "+pend.currentStep+" first.",found.data.stepsCompleted,tv.step,found.data.totalSteps);
    return res.send(buildPage({state:"verify",msg:"",done:found.data.stepsCompleted,cur:tv.step,tot:found.data.totalSteps,token:t}));
});

app.get("/challenge",(req,res)=>{
    const t=req.query.token||"";
    const tv=vtokens.get(t);
    if(!tv||tv.used) return res.json({ok:false,msg:"Invalid token"});
    const data=makeChallengeSession(t);
    return res.json(data);
});

app.post("/challenge/answer",(req,res)=>{
    const{token,answer}=req.body||{};
    if(!token) return res.json({ok:false,msg:"Missing token"});
    const tv=vtokens.get(token);
    if(!tv||tv.used) return res.json({ok:false,msg:"Invalid token"});
    const sess=challenges.get(token);
    if(!sess) return res.json({ok:false,msg:"No challenge session — reload the page"});
    if(sess.allSolved) return res.json({ok:true,done:true,msg:"All challenges already solved!"});
    const stage=sess.stages[sess.stageIdx];
    const correct=String(answer||"").trim().toLowerCase()===String(stage.answer).trim().toLowerCase();
    if(!correct){
        sess.stages[sess.stageIdx]=makeStage();
        challenges.set(token,sess);
        const fresh=sess.stages[sess.stageIdx];
        return res.json({ok:false,msg:"Wrong answer — new challenge generated",newQuestion:fresh.question,newType:fresh.type,newData:fresh.clientData});
    }
    sess.stageIdx++;
    const finished=sess.stageIdx>=sess.stages.length;
    if(finished) sess.allSolved=true;
    challenges.set(token,sess);
    if(!finished){
        const next=sess.stages[sess.stageIdx];
        return res.json({ok:true,done:false,stage:sess.stageIdx+1,totalStages:sess.stages.length,newQuestion:next.question,newType:next.type,newData:next.clientData,msg:"✓ Challenge "+(sess.stageIdx)+"/3 passed!"});
    }
    return res.json({ok:true,done:true,msg:"✓ All 3 challenges passed!"});
});

app.post("/checkpoint/complete", async(req,res)=>{
    const{token}=req.body||{};
    if(!token) return res.json({ok:false,msg:"Missing token"});
    const tv=vtokens.get(token);
    if(!tv||tv.used) return res.json({ok:false,msg:"Invalid or already-used token"});
    if(Date.now()-tv.createdAt>CFG.TOKEN_TTL){vtokens.delete(token);return res.json({ok:false,msg:"Token expired"});}
    const sess=challenges.get(token);
    if(!sess)         return res.json({ok:false,msg:"No challenge session — reload the page"});
    if(!sess.allSolved) return res.json({ok:false,msg:"Complete all 3 challenges first"});
    const found=getKey(tv.userId);
    const pend=pending.get(tv.userId);
    if(!found||!pend) return res.json({ok:false,msg:"Session lost — type ?getkey again"});
    if(tv.step!==pend.currentStep) return res.json({ok:false,msg:"Wrong step"});
    tv.used=true;vtokens.set(token,tv);challenges.delete(token);
    const{key,data}=found;
    data.stepsCompleted++;keys.set(key,data);
    console.log("[VOID] ✓ Step "+data.stepsCompleted+"/"+data.totalSteps+" for "+tv.userId);
    if(data.stepsCompleted>=data.totalSteps){
        data.expiresAt=Date.now()+data.totalSteps*CFG.H_PER_STEP*3600000;
        keys.set(key,data);pending.delete(tv.userId);
        try{const u=await client.users.fetch(tv.userId);await dmUser(u,finalKeyPayload(key,data.totalSteps));console.log("[VOID] 🔑 Key sent to "+u.tag+": "+key);}
        catch(e){console.error("[VOID] Final key DM error:",e.message);}
        return res.json({ok:true,done:true,msg:"All "+data.totalSteps+" steps complete! 🎉 Key sent to your Discord DMs."});
    }
    pend.currentStep++;pending.set(tv.userId,pend);
    try{const u=await client.users.fetch(tv.userId);await dmUser(u,checkpointPayload(u,pend.currentStep,data.totalSteps));}
    catch(e){console.error("[VOID] Next checkpoint DM error:",e.message);}
    return res.json({ok:true,done:false,msg:"Step "+data.stepsCompleted+" done ✓ Check your Discord DMs for Checkpoint "+pend.currentStep+"."});
});

app.get("/validate",(req,res)=>{
    const ip=(req.headers["x-forwarded-for"]||req.socket.remoteAddress||"?").split(",")[0].trim();
    const key=(req.query.key||"").toUpperCase().trim();
    if(isBlocked(ip)) return res.json({valid:false,message:"Rate limited"});
    if(!key){doFail(ip);return res.json({valid:false,message:"No key provided"});}
    if(!validKey(key)){doFail(ip);return res.json({valid:false,message:"Invalid key format"});}
    const d=keys.get(key);
    if(!d){doFail(ip);return res.json({valid:false,message:"Key not found"});}
    if(d.blocked) return res.json({valid:false,message:"Key revoked"});
    if(d.expiresAt===0) return res.json({valid:false,message:"Key not activated yet — complete checkpoints first"});
    if(Date.now()>d.expiresAt) return res.json({valid:false,message:"Key expired — type ?getkey in Discord"});
    const left=fmtMs(d.expiresAt-Date.now());
    console.log("[VOID] ✓ Validated: "+key+" ("+left+" left)");
    return res.json({valid:true,message:"Access granted",userId:d.userId,expiresIn:left,expiresAt:d.expiresAt,steps:d.totalSteps});
});

app.get("/",(_, res)=>res.json({status:"ok",keys:keys.size,active:[...keys.values()].filter(d=>!d.blocked&&d.expiresAt>Date.now()).length,pending:pending.size}));

// ════════════════════════════════════════════════════════════════════
//  PAGE BUILDER
// ════════════════════════════════════════════════════════════════════
function buildPage({state,msg,done,cur,tot,token}) {
    const circles=Array.from({length:tot},(_,i)=>{
        const n=i+1;
        const cls=(n<cur||(n===cur&&state!=="verify"))?"done":n===cur?"active":"locked";
        return "<div class='step "+cls+"'><div class='sc'>"+(cls==="done"?"✓":n)+"</div><div class='sl'>Step "+n+"<br><span>"+(n*24)+"h</span></div></div>"+(n<tot?"<div class='ln'></div>":"");
    }).join("");

    if(state!=="verify"){
        const col=state==="complete"?"#22c55e":"#ef4444";
        return "<!DOCTYPE html><html lang=en><head><meta charset=UTF-8><meta name=viewport content='width=device-width,initial-scale=1'><title>VOID</title><style>"+CSS()+"</style></head><body><div class=card><div class=logo>◈</div><h1>VOID</h1><p class=sub>CHECKPOINT "+cur+" / "+tot+"</p><div class=steps>"+circles+"</div><div class=msg style='color:"+col+";border-color:"+col+"20;background:"+col+"0a'>"+msg+"</div><a href='javascript:window.close()' class=btn>Close</a><p class=footer>VOID KEY SYSTEM · DO NOT SHARE YOUR LINKS</p></div></body></html>";
    }

    const ADS_COUNT = CFG.ADS;
    const BASE_URL  = CFG.BASE_URL;
    const TOKEN_VAL = token;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VOID — Checkpoint ${cur}/${tot}</title>
<style>
${CSS()}
.stage{display:none}.stage.on{display:block}
.box{background:#07051a;border:1px solid #2a1f45;border-radius:14px;padding:22px 20px;margin:12px 0;text-align:left}
.lbl{color:#3d2f60;font-size:9px;letter-spacing:3px;text-transform:uppercase;margin-bottom:12px;display:block}
.qt{color:#c4b5fd;font-size:14px;line-height:1.8;margin-bottom:14px}
.cq{color:#f3e8ff;font-size:18px}
.inp{width:100%;background:#0d0b20;border:1px solid #2a1f45;border-radius:9px;color:#e2d9f3;padding:10px 14px;font-size:14px;outline:none;transition:.2s;margin-top:4px}
.inp:focus{border-color:#7c3aed;box-shadow:0 0 0 2px #7c3aed20}
.cbts{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:8px}
.cbt{padding:10px 18px;border-radius:8px;border:1px solid #2a1f45;background:#0d0b20;color:#a89dc0;cursor:pointer;font-size:12px;font-weight:bold;transition:.2s}
.cbt:hover{border-color:#7c3aed;color:#c4b5fd;background:#1a1030}
.cbt.sel{border-color:#a855f7;background:#2d1a60;color:#f3e8ff}
.ok{color:#22c55e;font-size:12px;margin-top:8px;font-weight:bold;display:block}
.er{color:#ef4444;font-size:12px;margin-top:8px;display:block}
.inf{color:#a855f7;font-size:12px;margin-top:8px;display:block}
.prog{display:flex;gap:5px;justify-content:center;margin-bottom:14px}
.pd{width:28px;height:5px;border-radius:3px;background:#1a1030;transition:.35s}
.pd.done{background:#7c3aed;box-shadow:0 0 8px #7c3aed70}
.pd.active{background:#a855f7;box-shadow:0 0 10px #a855f780}
.hbar{width:100%;height:8px;background:#1a1030;border-radius:4px;overflow:hidden;margin-top:12px}
.hfill{height:100%;width:0%;background:linear-gradient(90deg,#5b21b6,#a855f7);border-radius:4px;transition:width .1s linear}
.ascreen{width:100%;height:150px;background:#000;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;margin-bottom:10px;border:1px solid #1a1030;position:relative;overflow:hidden}
.atimer{position:absolute;top:8px;right:10px;background:#00000095;color:#fff;font-size:11px;padding:3px 8px;border-radius:5px;font-weight:bold}
.abar{width:100%;height:3px;background:#1a1030;border-radius:2px;overflow:hidden;margin:6px 0}
.afill{height:100%;background:linear-gradient(90deg,#7c3aed,#a855f7);transition:width .5s linear}
.skipbtn{background:#1a1030;border:1px solid #2a1f45;color:#2a1f45;padding:8px 22px;border-radius:8px;font-size:11px;cursor:default;transition:.25s;margin-top:6px}
.skipbtn.rdy{background:#5b21b6;border-color:#7c3aed;color:#f3e8ff;cursor:pointer}
.skipbtn.rdy:hover{background:#7c3aed}
.abwall{background:#1a0505;border:1px solid #7f1d1d;border-radius:12px;padding:16px 18px;color:#f87171;font-size:13px;line-height:1.8;margin-bottom:12px;display:none}
</style>
</head>
<body>
<div class="card" style="max-width:500px">
<div class="logo">◈</div><h1>VOID</h1>
<p class="sub">CHECKPOINT ${cur} / ${tot}</p>
<div class="steps">${circles}</div>

<div class="abwall" id="abwall">
  🚫 <strong>Ad blocker detected.</strong><br>
  Disable your ad blocker then <a href="" style="color:#f87171;text-decoration:underline">refresh this page</a>.
</div>

<!-- S1: Challenges -->
<div class="stage on" id="s1">
  <div class="box">
    <span class="lbl">Challenge <span id="cnum">1</span> / 3</span>
    <div class="prog"><div class="pd active" id="pd0"></div><div class="pd" id="pd1"></div><div class="pd" id="pd2"></div></div>
    <div class="qt" id="qtext">Loading…</div>
    <div id="qinput"></div>
    <span id="qst" class="inf"></span>
  </div>
  <button class="btn" id="chkBtn" onclick="submitAnswer()" disabled>Submit Answer</button>
</div>

<!-- S2: Hold -->
<div class="stage" id="s2">
  <div class="box">
    <span class="lbl">Human Verification</span>
    <p style="color:#a89dc0;font-size:13px;line-height:1.7;margin-bottom:12px">Hold the button below for <strong style="color:#c4b5fd">5 seconds</strong> without releasing.</p>
    <div class="hbar"><div class="hfill" id="hfill"></div></div>
    <span id="hst" class="inf"></span>
  </div>
  <button class="btn" id="hbtn" onmousedown="startHold()" onmouseup="stopHold()" ontouchstart="startHold(event)" ontouchend="stopHold()">
    Hold Me (5 seconds)
  </button>
</div>

<!-- S3: Ads -->
<div class="stage" id="s3">
  <div class="box">
    <span class="lbl">Ad <span id="adN">1</span> / ${ADS_COUNT}</span>
    <div class="ascreen">
      <div id="adviz" style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px"></div>
      <div class="atimer" id="atimer">…</div>
    </div>
    <div class="abar"><div class="afill" id="afill" style="width:0%"></div></div>
    <span id="adst" class="inf">Preparing…</span><br>
    <button class="skipbtn" id="skipbtn" onclick="skipAd()">Skip ›</button>
  </div>
</div>

<!-- S4: Confirm -->
<div class="stage" id="s4">
  <div class="box" style="text-align:center">
    <span class="lbl" style="display:block;text-align:center">Final Step</span>
    <p style="color:#a89dc0;font-size:13px;line-height:1.8">
      ✓ 3 Challenges &nbsp;|&nbsp; ✓ Hold passed &nbsp;|&nbsp; ✓ Ads watched<br><br>
      Click to complete <strong>Checkpoint ${cur}</strong>.
    </p>
    <span id="cst" class="inf"></span>
  </div>
  <button class="btn" id="cmpbtn" onclick="doComplete()">Complete Checkpoint ${cur}</button>
</div>

<!-- S5: Done -->
<div class="stage" id="s5">
  <div class="box" style="text-align:center;padding:28px 20px">
    <div style="font-size:40px;margin-bottom:12px">🎉</div>
    <div id="donemsg" style="color:#22c55e;font-size:13px;line-height:1.8"></div>
  </div>
  <a href="javascript:window.close()" class="btn">Close Window</a>
</div>

<p class="footer">VOID KEY SYSTEM &nbsp;·&nbsp; DO NOT SHARE YOUR LINKS</p>
</div>

<script>
const TOKEN="${TOKEN_VAL}",ADS=${ADS_COUNT},BASE="${BASE_URL}";
let curAns="",stageNum=1,chkDone=false,holdDone=false,adsDone=false;
let curAd=1,adInt=null,skipRdy=false,holdInt=null,holdProg=0;

// Ad-block detection
async function checkAdBlock(){
  return new Promise(res=>{
    const s=document.createElement("script");
    s.src=BASE+"/ads/ads.js?_="+Date.now();
    s.onload=()=>res(false); s.onerror=()=>res(true);
    document.head.appendChild(s);
    setTimeout(()=>res(!window.__voidAdOk),3000);
  });
}
async function boot(){
  if(await checkAdBlock()){
    document.getElementById("abwall").style.display="block";
    document.getElementById("s1").classList.remove("on");
    return;
  }
  await loadChallenge();
}

// Challenges
async function loadChallenge(override){
  const btn=document.getElementById("chkBtn");
  btn.disabled=true;btn.textContent="Submit Answer";
  curAns="";
  document.getElementById("qst").textContent="";document.getElementById("qst").className="inf";
  let r=override;
  if(!r){
    r=await fetch(BASE+"/challenge?token="+TOKEN).then(x=>x.json()).catch(()=>null);
    if(!r?.ok){document.getElementById("qtext").innerHTML="Failed to load. <a href='' style='color:#a855f7'>Reload</a>.";return;}
    stageNum=1;
  }
  // update dots
  for(let i=0;i<3;i++){
    const d=document.getElementById("pd"+i);
    d.className="pd"+(i<stageNum-1?" done":i===stageNum-1?" active":"");
  }
  document.getElementById("cnum").textContent=stageNum;
  document.getElementById("qtext").innerHTML=r.question||r.newQuestion;
  const wrap=document.getElementById("qinput");wrap.innerHTML="";
  const type=r.type||r.newType;const data=r.data||r.newData||{};
  if(type==="color"){
    const dv=document.createElement("div");dv.className="cbts";
    (data.opts||[]).forEach(o=>{
      const b=document.createElement("button");b.className="cbt";b.textContent=o.toUpperCase();
      b.onclick=()=>{document.querySelectorAll(".cbt").forEach(x=>x.classList.remove("sel"));b.classList.add("sel");curAns=o;document.getElementById("chkBtn").disabled=false;};
      dv.appendChild(b);
    });wrap.appendChild(dv);
  } else {
    const inp=document.createElement("input");inp.className="inp";
    inp.placeholder=type==="math"?"Enter number":type==="word"?"Type the word":"Your answer";
    inp.oninput=()=>{curAns=inp.value;document.getElementById("chkBtn").disabled=inp.value.trim()==="";};
    inp.onkeydown=e=>{if(e.key==="Enter"&&curAns.trim())submitAnswer();};
    wrap.appendChild(inp);setTimeout(()=>inp.focus(),80);
  }
}

async function submitAnswer(){
  const btn=document.getElementById("chkBtn"),st=document.getElementById("qst");
  btn.disabled=true;btn.textContent="Checking…";st.textContent="";
  if(!curAns.trim()){st.textContent="Please enter an answer.";st.className="er";btn.disabled=false;btn.textContent="Submit Answer";return;}
  let r=null;
  try{r=await fetch(BASE+"/challenge/answer",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:TOKEN,answer:curAns.trim()})}).then(x=>x.json());}
  catch{st.textContent="❌ Network error.";st.className="er";btn.disabled=false;btn.textContent="Submit Answer";return;}
  if(!r.ok){
    st.textContent="❌ "+r.msg;st.className="er";
    btn.disabled=false;btn.textContent="Submit Answer";
    if(r.newQuestion)await loadChallenge(r);
    return;
  }
  if(!r.done){
    stageNum=r.stage;st.textContent="✓ "+r.msg;st.className="ok";
    setTimeout(()=>loadChallenge(r),600);return;
  }
  chkDone=true;st.textContent="✓ All 3 challenges passed!";st.className="ok";
  for(let i=0;i<3;i++)document.getElementById("pd"+i).className="pd done";
  btn.textContent="✓ Done";
  setTimeout(()=>{document.getElementById("s1").classList.remove("on");document.getElementById("s2").classList.add("on");},700);
}

// Hold
function startHold(e){if(e)e.preventDefault();
  const fill=document.getElementById("hfill"),st=document.getElementById("hst"),btn=document.getElementById("hbtn");
  holdProg=0;st.textContent="Hold…";st.className="inf";
  holdInt=setInterval(()=>{
    holdProg+=0.1;fill.style.width=Math.min(100,(holdProg/5)*100)+"%";
    if(holdProg>=5){clearInterval(holdInt);holdInt=null;holdDone=true;
      fill.style.width="100%";fill.style.background="#22c55e";
      st.textContent="✓ Verified!";st.className="ok";btn.textContent="✓ Held";btn.disabled=true;
      setTimeout(()=>{document.getElementById("s2").classList.remove("on");document.getElementById("s3").classList.add("on");playAd(1);},600);}
  },100);
}
function stopHold(){
  if(!holdDone&&holdInt){clearInterval(holdInt);holdInt=null;holdProg=0;
    document.getElementById("hfill").style.width="0%";
    document.getElementById("hst").textContent="Released too soon — try again.";
    document.getElementById("hst").className="er";}
}

// Ads
const themes=[
  {bg:"linear-gradient(135deg,#0d0820,#1a0a38)",icon:"🚀",name:"VOID PREMIUM",tag:"Upgrade your access"},
  {bg:"linear-gradient(135deg,#0a140d,#142010)",icon:"🛡️",name:"VOID SECURITY",tag:"Military-grade protection"},
  {bg:"linear-gradient(135deg,#140a20,#200a30)",icon:"💎",name:"VOID ELITE",tag:"Exclusive script access"},
  {bg:"linear-gradient(135deg,#141400,#201e00)",icon:"⚡",name:"VOID SPEED",tag:"Zero-lag execution"},
  {bg:"linear-gradient(135deg,#001414,#00201e)",icon:"🔑",name:"VOID KEYS",tag:"Secure key distribution"},
  {bg:"linear-gradient(135deg,#140000,#200800)",icon:"🌐",name:"VOID NETWORK",tag:"Global script network"},
];
function playAd(n){
  curAd=n;skipRdy=false;
  const len=Math.floor(Math.random()*21)+10;let secs=len;
  const t=themes[Math.floor(Math.random()*themes.length)];
  document.getElementById("adN").textContent=n;
  document.getElementById("afill").style.width="0%";
  document.getElementById("skipbtn").className="skipbtn";
  document.getElementById("skipbtn").textContent="Skip ›";
  document.getElementById("adst").textContent="Ad "+n+" of "+ADS+" — watch 5s before skipping";
  const viz=document.getElementById("adviz");
  viz.style.background=t.bg;
  viz.innerHTML="<span style='font-size:36px'>"+t.icon+"</span><div style='color:#e2d9f3;font-size:14px;font-weight:900;letter-spacing:5px'>"+t.name+"</div><div style='color:#8b7aaa;font-size:10px;margin-top:2px'>"+t.tag+"</div>";
  if(adInt)clearInterval(adInt);
  adInt=setInterval(()=>{
    secs--;
    const pct=((len-secs)/len)*100;
    document.getElementById("atimer").textContent=secs+"s";
    document.getElementById("afill").style.width=pct+"%";
    if(len-secs>=5&&!skipRdy){skipRdy=true;const sb=document.getElementById("skipbtn");sb.classList.add("rdy");sb.textContent="Skip Ad ›";}
    if(secs<=0){clearInterval(adInt);finishAd();}
  },1000);
}
function skipAd(){if(!skipRdy)return;clearInterval(adInt);finishAd();}
function finishAd(){
  document.getElementById("adst").textContent="✓ Ad "+curAd+" complete";
  if(curAd<ADS){setTimeout(()=>playAd(curAd+1),900);}
  else{adsDone=true;setTimeout(()=>{document.getElementById("s3").classList.remove("on");document.getElementById("s4").classList.add("on");},700);}
}

// Complete
async function doComplete(){
  const btn=document.getElementById("cmpbtn"),st=document.getElementById("cst");
  btn.disabled=true;btn.textContent="Submitting…";st.textContent="";st.className="inf";
  let r=null;
  try{r=await fetch(BASE+"/checkpoint/complete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:TOKEN})}).then(x=>x.json());}
  catch{st.textContent="❌ Network error.";st.className="er";btn.disabled=false;btn.textContent="Complete Checkpoint ${cur}";return;}
  if(!r.ok){st.textContent="❌ "+r.msg;st.className="er";btn.disabled=false;btn.textContent="Complete Checkpoint ${cur}";return;}
  document.getElementById("s4").classList.remove("on");
  document.getElementById("s5").classList.add("on");
  document.getElementById("donemsg").innerHTML=r.msg;
}

window.addEventListener("DOMContentLoaded",boot);
</script>
</body></html>`;
}

function CSS(){return `*{margin:0;padding:0;box-sizing:border-box}body{background:#03020a;color:#a89dc0;font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;background-image:radial-gradient(ellipse at 50% 0%,#1a0a3012 0%,transparent 65%)}.card{background:linear-gradient(145deg,#0e0b1c,#060412);border:1px solid #2a1f45;border-radius:22px;padding:38px 32px;max-width:480px;width:100%;text-align:center;box-shadow:0 0 80px #6d28d90d,0 0 30px #00000055;position:relative;overflow:hidden}.card::before{content:'';position:absolute;top:0;left:10%;right:10%;height:1px;background:linear-gradient(90deg,transparent,#7c3aed40,transparent)}.logo{font-size:44px;color:#7c3aed;margin-bottom:10px;filter:drop-shadow(0 0 12px #7c3aed50)}h1{color:#e2d9f3;font-size:20px;letter-spacing:10px;font-weight:900;margin-bottom:4px}.sub{color:#3d2f60;font-size:10px;letter-spacing:4px;margin-bottom:24px}.steps{display:flex;align-items:center;justify-content:center;margin-bottom:20px;flex-wrap:wrap}.step{display:flex;flex-direction:column;align-items:center;gap:7px}.ln{width:20px;height:2px;background:#1a1030;margin-bottom:20px}.step.done+.ln{background:#7c3aed55}.sc{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;border:2px solid #1a1030;background:#0d0b1e;color:#2a1d45}.step.done .sc{background:#2d1a60;border-color:#7c3aed;color:#c4b5fd;box-shadow:0 0 12px #7c3aed35}.step.active .sc{background:#3a1f6e;border-color:#a855f7;color:#f3e8ff;box-shadow:0 0 16px #a855f755}.sl{font-size:9px;color:#2a1d45;text-align:center;line-height:1.5}.sl span{color:#5b21b6;font-weight:bold}.step.done .sl,.step.active .sl{color:#7a6896}.step.done .sl span,.step.active .sl span{color:#a855f7}.msg{padding:16px 18px;border-radius:12px;font-size:13px;line-height:1.7;margin-bottom:20px;border:1px solid}.btn{display:block;background:linear-gradient(135deg,#5b21b6,#7c3aed);color:#f3e8ff;border:none;border-radius:12px;padding:14px 28px;font-size:11px;font-weight:800;letter-spacing:3px;cursor:pointer;text-decoration:none;transition:.18s;width:100%;margin-top:8px;box-shadow:0 4px 18px #7c3aed22}.btn:hover:not(:disabled){background:linear-gradient(135deg,#6d28d9,#9333ea);transform:translateY(-1px)}.btn:disabled{opacity:.4;cursor:not-allowed;transform:none}.footer{margin-top:20px;font-size:9px;color:#1a1030;letter-spacing:2px}`;}

// ════════════════════════════════════════════════════════════════════
//  CLEANUP + KEEP-ALIVE + START
// ════════════════════════════════════════════════════════════════════
setInterval(()=>{
    const now=Date.now();let k=0,t=0;
    for(const[id,d]of keys)if(!d.blocked&&d.expiresAt>0&&now>d.expiresAt+3600000){keys.delete(id);k++;}
    for(const[id,tv]of vtokens)if(tv.used||now-tv.createdAt>CFG.TOKEN_TTL*2){vtokens.delete(id);t++;}
    for(const[id]of challenges)if(!vtokens.has(id))challenges.delete(id);
    for(const[id,ts]of cooldowns)if(now-ts>CFG.COOLDOWN*20)cooldowns.delete(id);
    for(const[id,p]of pending)if(now-p.createdAt>3*3600000)pending.delete(id);
    for(const[ip,r]of failLog)if(r.blockedUntil&&now>r.blockedUntil+3600000)failLog.delete(ip);
    console.log("[VOID] 🧹 Cleanup — keys:"+k+" tokens:"+t);
},CFG.CLEANUP);

if(CFG.BASE_URL&&!CFG.BASE_URL.includes("localhost")){
    setInterval(()=>{
        const mod=CFG.BASE_URL.startsWith("https")?https:http;
        const req=mod.get(CFG.BASE_URL,r=>console.log("[VOID] 💓 "+r.statusCode));
        req.on("error",e=>console.warn("[VOID] Keep-alive:",e.message));req.end();
    },CFG.KEEPALIVE);
    console.log("[VOID] 💓 Keep-alive started");
}

app.listen(CFG.PORT,()=>console.log("[VOID] ✓ API on port "+CFG.PORT));
process.on("unhandledRejection",e=>console.error("[VOID] Unhandled:",e?.message||e));
process.on("uncaughtException", e=>console.error("[VOID] Uncaught:", e?.message||e));
client.login(CFG.TOKEN).catch(e=>{console.error("[VOID] LOGIN FAILED:",e.message);process.exit(1);});
