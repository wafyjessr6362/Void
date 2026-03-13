--[[
╔═══════════════════════════════════════════════════════════════════════╗
║        V O I D L I B  ✦  v10.0  C E L E S T I A L  E D I T I O N   ║
╠═══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  USAGE:                                                              ║
║                                                                      ║
║  local VoidLib = loadstring(game:HttpGet(                            ║
║    "https://raw.githubusercontent.com/wafyjessr6362/" ..             ║
║    "Void/refs/heads/main/VoidLib.lua", true                          ║
║  ))()                                                                ║
║                                                                      ║
║  local window = VoidLib.new({                                        ║
║    -- REQUIRED                                                       ║
║    Title       = "MY SCRIPT",                                        ║
║    ApiUrl      = "https://void-r3co.onrender.com/validate",          ║
║                                                                      ║
║    -- STEPS  (cosmetic — matches your bot config)                    ║
║    Steps       = 1,          -- 1, 2, or 3                          ║
║    ShowSteps   = true,                                               ║
║                                                                      ║
║    -- COLOUR CYCLING                                                 ║
║    ColorChange = 3,          -- seconds between colour changes       ║
║                              -- set 0 to lock on first colour        ║
║    Colors = {                -- your colour cycle (any length)       ║
║      Color3.fromRGB(109, 40, 217),                                   ║
║      Color3.fromRGB(30,  120, 220),                                  ║
║      Color3.fromRGB(200, 50,  130),                                  ║
║      Color3.fromRGB(20,  190, 140),                                  ║
║    },                                                                ║
║                                                                      ║
║    -- APPEARANCE                                                     ║
║    Subtitle    = "Authentication",                                   ║
║    Version     = "v1.0",                                             ║
║    Discord     = "discord.gg/yourserver",  -- "" to hide            ║
║    BlurBG      = true,                                               ║
║    Stars       = true,       -- animated star particles              ║
║    Particles   = true,       -- floating orb particles               ║
║    GlowPulse   = true,       -- window glow heartbeat                ║
║    TypewriterTitle = true,   -- title types itself on open           ║
║                                                                      ║
║    -- BEHAVIOUR                                                      ║
║    ToggleKey   = Enum.KeyCode.RightAlt,                              ║
║    RememberKey = true,                                               ║
║    AutoClose   = true,                                               ║
║                                                                      ║
║    -- CALLBACKS                                                      ║
║    OnSuccess   = function(data) end,  -- data = API response         ║
║    OnFail      = function(key, reason) end,                          ║
║    OnClose     = function() end,                                     ║
║    OnOpen      = function() end,                                     ║
║  })                                                                  ║
║                                                                      ║
║  -- Methods:                                                         ║
║  window:Show()    window:Hide()    window:Destroy()                  ║
║  window:SetTitle(str)   window:SetStatus(str, color)                 ║
╚═══════════════════════════════════════════════════════════════════════╝
--]]

local VoidLib   = {}
VoidLib.__index = VoidLib

-- ════════════════════════════════════════════════════════════════════
--  SERVICES
-- ════════════════════════════════════════════════════════════════════
local Players    = game:GetService("Players")
local TweenSvc   = game:GetService("TweenService")
local UIS        = game:GetService("UserInputService")
local RunSvc     = game:GetService("RunService")
local HttpSvc    = game:GetService("HttpService")
local Lighting   = game:GetService("Lighting")
local LP         = Players.LocalPlayer
local PGui       = LP:WaitForChild("PlayerGui")

-- ════════════════════════════════════════════════════════════════════
--  DEFAULT COLOUR PALETTE
-- ════════════════════════════════════════════════════════════════════
local DEFAULT_COLORS = {
    Color3.fromRGB(109, 40,  217),   -- violet
    Color3.fromRGB(30,  120, 220),   -- sapphire
    Color3.fromRGB(200, 50,  130),   -- rose
    Color3.fromRGB(20,  190, 140),   -- teal
    Color3.fromRGB(230, 120,  20),   -- amber
    Color3.fromRGB(80,  200, 240),   -- sky
}

-- ════════════════════════════════════════════════════════════════════
--  DEFAULTS
-- ════════════════════════════════════════════════════════════════════
local DEFAULTS = {
    Title            = "VOID",
    Subtitle         = "Authentication",
    Version          = "v1.0",
    Discord          = "",
    ApiUrl           = "https://void-r3co.onrender.com/validate",
    Steps            = 1,
    ShowSteps        = true,
    ColorChange      = 3,
    Colors           = DEFAULT_COLORS,
    BlurBG           = true,
    Stars            = true,
    Particles        = true,
    GlowPulse        = true,
    TypewriterTitle  = true,
    ToggleKey        = Enum.KeyCode.RightAlt,
    RememberKey      = true,
    AutoClose        = true,
    OnSuccess        = function() end,
    OnFail           = function() end,
    OnClose          = function() end,
    OnOpen           = function() end,
}

-- ════════════════════════════════════════════════════════════════════
--  BASE PALETTE  (never changes)
-- ════════════════════════════════════════════════════════════════════
local COL = {
    BG         = Color3.fromRGB(4,   3,   10),
    BG2        = Color3.fromRGB(9,   7,   19),
    BG3        = Color3.fromRGB(14,  11,  26),
    BG4        = Color3.fromRGB(20,  16,  36),
    BORDER     = Color3.fromRGB(38,  28,  62),
    BORDER2    = Color3.fromRGB(58,  44,  94),
    TEXT       = Color3.fromRGB(160, 148, 190),
    TEXT_HI    = Color3.fromRGB(224, 215, 244),
    TEXT_DIM   = Color3.fromRGB(52,  40,  80),
    TEXT_FAINT = Color3.fromRGB(30,  22,  50),
    GREEN      = Color3.fromRGB(52,  211, 111),
    GREEN_DK   = Color3.fromRGB(16,  100,  46),
    RED        = Color3.fromRGB(248,  72,  72),
    RED_DK     = Color3.fromRGB(100,  18,  18),
    YELLOW     = Color3.fromRGB(251, 191,  36),
    WHITE      = Color3.fromRGB(240, 232, 255),
    STAR       = Color3.fromRGB(200, 188, 230),
}

-- ════════════════════════════════════════════════════════════════════
--  HELPERS
-- ════════════════════════════════════════════════════════════════════
local function tw(obj, props, t, style, dir)
    if not obj or not obj.Parent then return end
    TweenSvc:Create(obj,
        TweenInfo.new(t or 0.2,
            style or Enum.EasingStyle.Quart,
            dir   or Enum.EasingDirection.Out),
        props
    ):Play()
end

local function twSync(obj, props, t, style, dir)
    if not obj or not obj.Parent then return end
    local tween = TweenSvc:Create(obj,
        TweenInfo.new(t or 0.2,
            style or Enum.EasingStyle.Quart,
            dir   or Enum.EasingDirection.Out),
        props
    )
    tween:Play()
    return tween
end

local function make(cls, props, parent)
    local o = Instance.new(cls)
    for k, v in pairs(props or {}) do
        if k ~= "Parent" then
            pcall(function() o[k] = v end)
        end
    end
    if parent then o.Parent = parent end
    return o
end

local function corner(r, p)
    local c = Instance.new("UICorner")
    c.CornerRadius = UDim.new(0, r or 8)
    c.Parent = p
    return c
end

local function uiStroke(col, th, p, tr)
    local s = Instance.new("UIStroke")
    s.Color       = col or COL.BORDER
    s.Thickness   = th  or 1
    s.Transparency = tr or 0
    s.Parent      = p
    return s
end

local function gradient(c0, c1, rot, parent)
    local g = Instance.new("UIGradient")
    g.Color    = ColorSequence.new(c0, c1)
    g.Rotation = rot or 90
    g.Parent   = parent
    return g
end

local function darker(c, f)
    f = f or 0.45
    return Color3.new(math.clamp(c.R*f,0,1), math.clamp(c.G*f,0,1), math.clamp(c.B*f,0,1))
end

local function lighter(c, f)
    f = f or 1.35
    return Color3.new(math.clamp(c.R*f,0,1), math.clamp(c.G*f,0,1), math.clamp(c.B*f,0,1))
end

local function lerp(a, b, t)
    return a + (b - a) * t
end

local function lerpColor(a, b, t)
    return Color3.new(
        lerp(a.R, b.R, t),
        lerp(a.G, b.G, t),
        lerp(a.B, b.B, t)
    )
end

local function randomRange(a, b)
    return a + math.random() * (b - a)
end

-- Key persistence
local function saveKey(k)
    pcall(function() if writefile then writefile("_void_key_cache.txt", k) end end)
end

local function loadSavedKey()
    local ok, v = pcall(function()
        return readfile and readfile("_void_key_cache.txt") or ""
    end)
    return (ok and type(v) == "string") and v or ""
end

-- ════════════════════════════════════════════════════════════════════
--  HTTP VALIDATE
-- ════════════════════════════════════════════════════════════════════
local function validateKey(apiUrl, key)
    if not key or key:match("^%s*$") then
        return false, "Please enter your key", nil
    end
    local ok, res = pcall(function()
        return HttpSvc:GetAsync(apiUrl .. "?key=" .. HttpSvc:UrlEncode(key), true)
    end)
    if not ok then
        return false, "Network error — check your connection", nil
    end
    local ok2, parsed = pcall(function() return HttpSvc:JSONDecode(res) end)
    if not ok2 then
        return false, "Invalid server response", nil
    end
    if parsed and parsed.valid then
        return true, parsed.message or "Access granted", parsed
    end
    return false, (parsed and parsed.message) or "Invalid key", nil
end

-- ════════════════════════════════════════════════════════════════════
--  TYPEWRITER EFFECT
-- ════════════════════════════════════════════════════════════════════
local function typewriter(label, text, speed, callback)
    label.Text = ""
    local i = 0
    local conn
    conn = RunSvc.Heartbeat:Connect(function()
        i = i + 1
        if i % math.max(1, math.floor(60 / (speed or 12))) == 0 then
            local len = math.min(#label.Text + 1, #text)
            label.Text = text:sub(1, len)
            if len >= #text then
                conn:Disconnect()
                if callback then callback() end
            end
        end
    end)
    return conn
end

-- ════════════════════════════════════════════════════════════════════
--  BUILD
-- ════════════════════════════════════════════════════════════════════
function VoidLib.new(config)
    -- merge config
    local cfg = {}
    for k, v in pairs(DEFAULTS) do cfg[k] = v end
    for k, v in pairs(config or {}) do cfg[k] = v end

    cfg.Steps       = math.clamp(math.floor(cfg.Steps or 1), 1, 3)
    cfg.ColorChange = type(cfg.ColorChange) == "number" and cfg.ColorChange or 3
    if type(cfg.Colors) ~= "table" or #cfg.Colors == 0 then
        cfg.Colors = DEFAULT_COLORS
    end

    -- kill old
    local old = PGui:FindFirstChild("VoidLibUI_Celestial")
    if old then old:Destroy() end

    -- ── Connections to clean up on destroy ─────────────────────
    local connections = {}
    local function conn(c) table.insert(connections, c) end

    -- ── ScreenGui ──────────────────────────────────────────────
    local gui = make("ScreenGui", {
        Name            = "VoidLibUI_Celestial",
        ResetOnSpawn    = false,
        ZIndexBehavior  = Enum.ZIndexBehavior.Sibling,
        IgnoreGuiInset  = true,
        DisplayOrder    = 999,
    }, (gethui and gethui()) or PGui)

    -- ── Depth blur ──────────────────────────────────────────────
    local blur
    if cfg.BlurBG then
        blur        = Instance.new("BlurEffect")
        blur.Size   = 0
        blur.Parent = Lighting
        tw(blur, { Size = 20 }, 0.5, Enum.EasingStyle.Quint)
    end

    -- ════════════════════════════════════════════
    --  FULL-SCREEN BACKDROP
    -- ════════════════════════════════════════════
    local backdrop = make("Frame", {
        Size                  = UDim2.new(1, 0, 1, 0),
        BackgroundColor3      = Color3.new(0, 0, 0),
        BackgroundTransparency = 0.25,
        BorderSizePixel       = 0,
        ZIndex                = 1,
    }, gui)

    -- ── Star field ─────────────────────────────────────────────
    local starContainer
    if cfg.Stars then
        starContainer = make("Frame", {
            Size                  = UDim2.new(1, 0, 1, 0),
            BackgroundTransparency = 1,
            BorderSizePixel       = 0,
            ZIndex                = 2,
            ClipsDescendants      = false,
        }, backdrop)

        local starCount = 80
        local stars     = {}
        for _ = 1, starCount do
            local s = make("Frame", {
                Size                  = UDim2.new(0, math.random(1,3), 0, math.random(1,3)),
                Position              = UDim2.new(math.random(), 0, math.random(), 0),
                BackgroundColor3      = COL.STAR,
                BackgroundTransparency = randomRange(0.3, 0.85),
                BorderSizePixel       = 0,
                ZIndex                = 2,
            }, starContainer)
            corner(2, s)
            table.insert(stars, { obj = s, speed = randomRange(0.00005, 0.0003), twinkleTimer = math.random() * 4 })
        end

        -- Star twinkle + slow drift
        local starConn = RunSvc.Heartbeat:Connect(function(dt)
            for _, star in ipairs(stars) do
                star.twinkleTimer = star.twinkleTimer + dt
                local brightness  = 0.3 + 0.55 * math.abs(math.sin(star.twinkleTimer * 1.2))
                star.obj.BackgroundTransparency = brightness
                local curPos = star.obj.Position
                local newY   = curPos.Y.Scale + star.speed * dt * 60
                if newY > 1.02 then newY = -0.02 end
                star.obj.Position = UDim2.new(curPos.X.Scale, 0, newY, 0)
            end
        end)
        conn(starConn)
    end

    -- ════════════════════════════════════════════
    --  COLOUR SYSTEM
    -- ════════════════════════════════════════════
    local colorIdx      = 1
    local curAccent     = cfg.Colors[1]
    local targetAccent  = cfg.Colors[1]
    local lerpProgress  = 1.0    -- 0 = start lerp, 1 = done
    local colorTimer    = 0

    -- Registry: { obj, prop, fn(accent, dark, light) → value }
    local accentReg = {}
    local function reg(obj, prop, fn)
        table.insert(accentReg, { obj = obj, prop = prop, fn = fn })
    end

    local function applyAccentInstant(c)
        curAccent = c
        local dark  = darker(c, 0.40)
        local light = lighter(c, 1.30)
        for _, r in ipairs(accentReg) do
            if r.obj and r.obj.Parent then
                pcall(function() r.obj[r.prop] = r.fn(c, dark, light) end)
            end
        end
    end

    -- Smooth colour lerp every frame
    local accentLerpConn
    if cfg.ColorChange > 0 then
        accentLerpConn = RunSvc.Heartbeat:Connect(function(dt)
            colorTimer = colorTimer + dt
            if colorTimer >= cfg.ColorChange then
                colorTimer    = 0
                colorIdx      = (colorIdx % #cfg.Colors) + 1
                targetAccent  = cfg.Colors[colorIdx]
                lerpProgress  = 0
            end

            if lerpProgress < 1 then
                lerpProgress = math.min(1, lerpProgress + dt * 1.8)
                curAccent    = lerpColor(curAccent, targetAccent, lerpProgress)
                local dark   = darker(curAccent,  0.40)
                local light  = lighter(curAccent, 1.30)
                for _, r in ipairs(accentReg) do
                    if r.obj and r.obj.Parent then
                        pcall(function() r.obj[r.prop] = r.fn(curAccent, dark, light) end)
                    end
                end
            end
        end)
        conn(accentLerpConn)
    end

    -- ════════════════════════════════════════════
    --  FLOATING ORB PARTICLES
    -- ════════════════════════════════════════════
    local particleConn
    if cfg.Particles then
        local orbContainer = make("Frame", {
            Size                  = UDim2.new(1, 0, 1, 0),
            BackgroundTransparency = 1,
            BorderSizePixel       = 0,
            ZIndex                = 3,
            ClipsDescendants      = true,
        }, backdrop)

        local orbCount = 14
        local orbs     = {}
        for i = 1, orbCount do
            local sz  = math.random(4, 14)
            local orb = make("Frame", {
                Size                  = UDim2.new(0, sz, 0, sz),
                Position              = UDim2.new(math.random(), 0, 1.05, 0),
                BackgroundColor3      = curAccent,
                BackgroundTransparency = randomRange(0.55, 0.80),
                BorderSizePixel       = 0,
                ZIndex                = 3,
            }, orbContainer)
            corner(sz, orb)
            table.insert(orbs, {
                obj        = orb,
                x          = math.random(),
                y          = 1.0 + math.random() * 0.3,
                speedY     = randomRange(0.00015, 0.00040),
                drift      = randomRange(-0.00008, 0.00008),
                wobble     = math.random() * math.pi * 2,
                wobbleSpd  = randomRange(0.6, 1.4),
            })
        end

        particleConn = RunSvc.Heartbeat:Connect(function(dt)
            for _, p in ipairs(orbs) do
                p.y        = p.y - p.speedY * dt * 60
                p.wobble   = p.wobble + p.wobbleSpd * dt
                p.x        = p.x + p.drift * dt * 60 + math.sin(p.wobble) * 0.0002
                p.obj.BackgroundColor3 = curAccent

                if p.y < -0.06 then
                    p.y  = 1.06
                    p.x  = math.random()
                end
                p.obj.Position = UDim2.new(math.clamp(p.x, 0, 1), 0, p.y, 0)
            end
        end)
        conn(particleConn)
    end

    -- ════════════════════════════════════════════
    --  MAIN WINDOW
    -- ════════════════════════════════════════════
    local discordExtra = cfg.Discord ~= "" and 48 or 0
    local stepsExtra   = (cfg.Steps > 1 and cfg.ShowSteps) and 64 or 0
    local WIN_W        = 380
    local WIN_H        = 444 + stepsExtra + discordExtra

    local win = make("Frame", {
        Name                  = "CelestialWindow",
        Size                  = UDim2.new(0, WIN_W, 0, WIN_H),
        Position              = UDim2.new(0.5, -WIN_W/2, 0.5, -WIN_H/2),
        BackgroundColor3      = COL.BG,
        BorderSizePixel       = 0,
        ZIndex                = 5,
    }, gui)
    corner(20, win)

    -- Window border (accent-tracked)
    local winStroke = uiStroke(COL.BORDER2, 1.4, win)
    reg(winStroke, "Color", function(c) return darker(c, 0.75) end)

    -- Inner subtle gradient
    local winGrad = Instance.new("UIGradient")
    winGrad.Color    = ColorSequence.new({
        ColorSequenceKeypoint.new(0,   Color3.fromRGB(14, 10, 26)),
        ColorSequenceKeypoint.new(0.5, Color3.fromRGB(8,  6,  18)),
        ColorSequenceKeypoint.new(1,   Color3.fromRGB(4,  3,  10)),
    })
    winGrad.Rotation = 135
    winGrad.Parent   = win

    -- Glow shadow frame (behind window)
    local glow = make("Frame", {
        Size                  = UDim2.new(1, 40, 1, 40),
        Position              = UDim2.new(0, -20, 0, -20),
        BackgroundColor3      = curAccent,
        BackgroundTransparency = 0.88,
        BorderSizePixel       = 0,
        ZIndex                = 4,
    }, gui)
    corner(30, glow)
    glow.Position = UDim2.new(
        win.Position.X.Scale, win.Position.X.Offset - 20,
        win.Position.Y.Scale, win.Position.Y.Offset - 20
    )
    reg(glow, "BackgroundColor3", function(c) return c end)

    -- Glow pulse
    if cfg.GlowPulse then
        local glowPulseConn = RunSvc.Heartbeat:Connect((function()
            local t = 0
            return function(dt)
                t = t + dt
                local alpha = 0.86 + 0.07 * math.sin(t * 1.6)
                if glow and glow.Parent then
                    glow.BackgroundTransparency = alpha
                end
            end
        end)())
        conn(glowPulseConn)
    end

    -- Entrance animation
    win.BackgroundTransparency = 1
    win.Size     = UDim2.new(0, WIN_W * 0.88, 0, WIN_H * 0.88)
    win.Position = UDim2.new(0.5, -(WIN_W*0.88)/2, 0.5, -(WIN_H*0.88)/2 + 24)
    tw(win, {
        BackgroundTransparency = 0,
        Size     = UDim2.new(0, WIN_W, 0, WIN_H),
        Position = UDim2.new(0.5, -WIN_W/2, 0.5, -WIN_H/2),
    }, 0.45, Enum.EasingStyle.Back, Enum.EasingDirection.Out)

    -- ── Celestial top banner ────────────────────────────────────
    local BANNER_H = 108
    local banner   = make("Frame", {
        Size             = UDim2.new(1, 0, 0, BANNER_H),
        BackgroundColor3 = COL.BG2,
        BorderSizePixel  = 0,
        ZIndex           = 6,
    }, win)
    corner(20, banner)
    -- flatten bottom
    make("Frame", {
        Size             = UDim2.new(1, 0, 0, 20),
        Position         = UDim2.new(0, 0, 1, -20),
        BackgroundColor3 = COL.BG2,
        BorderSizePixel  = 0,
        ZIndex           = 6,
    }, banner)

    -- Banner nebula background
    local nebula1 = make("Frame", {
        Size                   = UDim2.new(0, 180, 0, 180),
        Position               = UDim2.new(0, -40, 0, -60),
        BackgroundColor3       = curAccent,
        BackgroundTransparency = 0.82,
        BorderSizePixel        = 0,
        ZIndex                 = 6,
    }, banner)
    corner(90, nebula1)
    reg(nebula1, "BackgroundColor3", function(c) return c end)

    local nebula2 = make("Frame", {
        Size                   = UDim2.new(0, 140, 0, 140),
        Position               = UDim2.new(1, -100, 0, -50),
        BackgroundColor3       = curAccent,
        BackgroundTransparency = 0.86,
        BorderSizePixel        = 0,
        ZIndex                 = 6,
    }, banner)
    corner(70, nebula2)
    reg(nebula2, "BackgroundColor3", function(c) return darker(c, 0.7) end)

    -- Nebula animation
    local nebulaConn = RunSvc.Heartbeat:Connect((function()
        local t = 0
        return function(dt)
            t = t + dt * 0.4
            if nebula1 and nebula1.Parent then
                local s  = 180 + 18 * math.sin(t)
                nebula1.Size = UDim2.new(0, s, 0, s)
                nebula1.BackgroundTransparency = 0.80 + 0.06 * math.cos(t * 1.3)
            end
            if nebula2 and nebula2.Parent then
                local s  = 140 + 12 * math.cos(t * 0.9)
                nebula2.Size = UDim2.new(0, s, 0, s)
                nebula2.BackgroundTransparency = 0.83 + 0.06 * math.sin(t * 1.1)
            end
        end
    end)())
    conn(nebulaConn)

    -- Top accent stripe (3px)
    local topStripe = make("Frame", {
        Size             = UDim2.new(1, 0, 0, 3),
        BackgroundColor3 = curAccent,
        BorderSizePixel  = 0,
        ZIndex           = 8,
    }, win)
    corner(3, topStripe)
    local topStripeGrad = gradient(curAccent, darker(curAccent, 0.3), 0, topStripe)
    reg(topStripe, "BackgroundColor3", function(c) return c end)

    -- Stripe shimmer
    local shimmerConn = RunSvc.Heartbeat:Connect((function()
        local t = 0
        return function(dt)
            t = t + dt * 0.8
            if topStripeGrad and topStripeGrad.Parent then
                local c2 = darker(curAccent, 0.2 + 0.15 * math.sin(t))
                topStripeGrad.Color = ColorSequence.new(curAccent, c2)
                topStripe.BackgroundColor3 = curAccent
            end
        end
    end)())
    conn(shimmerConn)

    -- ── Central icon ────────────────────────────────────────────
    local iconOuter = make("Frame", {
        Size             = UDim2.new(0, 52, 0, 52),
        Position         = UDim2.new(0.5, -26, 0, 10),
        BackgroundColor3 = darker(curAccent, 0.30),
        BorderSizePixel  = 0,
        ZIndex           = 8,
    }, banner)
    corner(14, iconOuter)
    local iconOuterStroke = uiStroke(curAccent, 1.8, iconOuter)
    reg(iconOuter,       "BackgroundColor3", function(_,dark)  return dark         end)
    reg(iconOuterStroke, "Color",            function(c)       return c            end)

    -- Inner icon ring
    local iconInner = make("Frame", {
        Size             = UDim2.new(0, 38, 0, 38),
        Position         = UDim2.new(0.5, -19, 0.5, -19),
        BackgroundColor3 = darker(curAccent, 0.18),
        BorderSizePixel  = 0,
        ZIndex           = 9,
    }, iconOuter)
    corner(10, iconInner)
    local iconInnerStroke = uiStroke(lighter(curAccent, 1.1), 1, iconInner, 0.3)
    reg(iconInner,       "BackgroundColor3", function(c)       return darker(c, 0.18) end)
    reg(iconInnerStroke, "Color",            function(c)       return lighter(c, 1.1) end)

    local iconLabel = make("TextLabel", {
        Size                  = UDim2.new(1, 0, 1, 0),
        BackgroundTransparency = 1,
        Text                  = "✦",
        TextColor3            = lighter(curAccent, 1.4),
        Font                  = Enum.Font.GothamBold,
        TextSize              = 22,
        ZIndex                = 10,
    }, iconInner)
    reg(iconLabel, "TextColor3", function(c) return lighter(c, 1.4) end)

    -- Icon pulse + rotation simulation (scale)
    local iconPulseConn = RunSvc.Heartbeat:Connect((function()
        local t = 0
        return function(dt)
            t = t + dt
            if not iconOuter or not iconOuter.Parent then return end
            local s = 52 + 3 * math.sin(t * 1.8)
            iconOuter.Size = UDim2.new(0, s, 0, s)
            iconOuter.Position = UDim2.new(0.5, -s/2, 0, 10)
            iconOuterStroke.Transparency = 0.1 + 0.2 * math.cos(t * 2.2)
        end
    end)())
    conn(iconPulseConn)

    -- ── Title ───────────────────────────────────────────────────
    local titleLbl = make("TextLabel", {
        Size                  = UDim2.new(1, -20, 0, 24),
        Position              = UDim2.new(0, 10, 0, 66),
        BackgroundTransparency = 1,
        Text                  = "",
        TextColor3            = COL.TEXT_HI,
        Font                  = Enum.Font.GothamBold,
        TextSize              = 18,
        ZIndex                = 8,
    }, banner)

    -- Subtitle
    local subLbl = make("TextLabel", {
        Size                  = UDim2.new(1, -20, 0, 12),
        Position              = UDim2.new(0, 10, 0, 90),
        BackgroundTransparency = 1,
        Text                  = "",
        TextColor3            = COL.TEXT_DIM,
        Font                  = Enum.Font.GothamBold,
        TextSize              = 8,
        ZIndex                = 8,
    }, banner)

    -- Version badge
    local verFrame = make("Frame", {
        Size             = UDim2.new(0, 40, 0, 18),
        Position         = UDim2.new(1, -48, 0, 10),
        BackgroundColor3 = darker(curAccent, 0.30),
        BorderSizePixel  = 0,
        ZIndex           = 9,
    }, banner)
    corner(6, verFrame)
    uiStroke(curAccent, 1, verFrame, 0.3)
    reg(verFrame, "BackgroundColor3", function(_,dark) return dark end)

    local verLbl = make("TextLabel", {
        Size                  = UDim2.new(1, 0, 1, 0),
        BackgroundTransparency = 1,
        Text                  = cfg.Version,
        TextColor3            = lighter(curAccent, 1.3),
        Font                  = Enum.Font.GothamBold,
        TextSize              = 8,
        ZIndex                = 10,
    }, verFrame)
    reg(verLbl, "TextColor3", function(c) return lighter(c, 1.3) end)

    -- ── Scrollable content ──────────────────────────────────────
    local scrollFrame = make("ScrollingFrame", {
        Size                  = UDim2.new(1, -28, 1, -BANNER_H - 36),
        Position              = UDim2.new(0, 14, 0, BANNER_H + 8),
        BackgroundTransparency = 1,
        BorderSizePixel       = 0,
        ScrollBarThickness    = 2,
        ScrollBarImageColor3  = COL.BORDER2,
        CanvasSize            = UDim2.new(0, 0, 0, 0),
        AutomaticCanvasSize   = Enum.AutomaticSize.Y,
        ZIndex                = 6,
    }, win)

    local listLayout = make("UIListLayout", {
        SortOrder = Enum.SortOrder.LayoutOrder,
        Padding   = UDim.new(0, 8),
    }, scrollFrame)

    local order = 0
    local function addItem(f)
        order = order + 1
        f.LayoutOrder = order
        f.Parent = scrollFrame
    end

    -- ════════════════════════════════════════════
    --  STEPS INDICATOR
    -- ════════════════════════════════════════════
    if cfg.Steps > 1 and cfg.ShowSteps then
        local sf = make("Frame", {
            Size             = UDim2.new(1, 0, 0, 56),
            BackgroundColor3 = COL.BG3,
            BorderSizePixel  = 0,
            ZIndex           = 7,
        })
        corner(12, sf)
        uiStroke(COL.BORDER, 1, sf)

        local stepW = 1 / cfg.Steps
        for i = 1, cfg.Steps do
            if i > 1 then
                -- connector
                local ln = make("Frame", {
                    Size             = UDim2.new(stepW * 0.34, 0, 0, 2),
                    Position         = UDim2.new((i-1)*stepW - stepW*0.17, 0, 0.5, -1),
                    BackgroundColor3 = COL.BORDER,
                    BorderSizePixel  = 0,
                    ZIndex           = 7,
                }, sf)
                if i == 2 then reg(ln, "BackgroundColor3", function(c) return darker(c, 0.65) end) end
            end

            local isFirst = i == 1
            local dotFrame = make("Frame", {
                Size             = UDim2.new(0, 32, 0, 32),
                Position         = UDim2.new((i-0.5)*stepW, -16, 0.5, -16),
                BackgroundColor3 = isFirst and curAccent or COL.BG4,
                BorderSizePixel  = 0,
                ZIndex           = 8,
            }, sf)
            corner(16, dotFrame)
            local dotStroke = uiStroke(isFirst and curAccent or COL.BORDER, 1.5, dotFrame, isFirst and 0.2 or 0)
            if isFirst then
                reg(dotFrame,  "BackgroundColor3", function(c) return c end)
                reg(dotStroke, "Color",            function(c) return c end)
            end

            make("TextLabel", {
                Size                  = UDim2.new(1, 0, 1, 0),
                BackgroundTransparency = 1,
                Text                  = tostring(i),
                TextColor3            = isFirst and COL.WHITE or COL.TEXT_DIM,
                Font                  = Enum.Font.GothamBold,
                TextSize              = 13,
                ZIndex                = 9,
            }, dotFrame)

            local stepLabel = make("TextLabel", {
                Size                  = UDim2.new(0, 44, 0, 10),
                Position              = UDim2.new(0.5, -22, 1, 5),
                BackgroundTransparency = 1,
                Text                  = "Step " .. i,
                TextColor3            = isFirst and lighter(curAccent, 1.2) or COL.TEXT_FAINT,
                Font                  = Enum.Font.GothamBold,
                TextSize              = 7,
                ZIndex                = 8,
            }, sf)
            if isFirst then reg(stepLabel, "TextColor3", function(c) return lighter(c, 1.2) end) end
        end
        addItem(sf)
    end

    -- ════════════════════════════════════════════
    --  KEY INPUT PANEL
    -- ════════════════════════════════════════════
    local inputPanel = make("Frame", {
        Size             = UDim2.new(1, 0, 0, 72),
        BackgroundColor3 = COL.BG2,
        BorderSizePixel  = 0,
        ZIndex           = 7,
    })
    corner(14, inputPanel)
    local inputPanelStroke = uiStroke(COL.BORDER, 1.2, inputPanel)

    -- KEY label
    local keyFieldLabel = make("TextLabel", {
        Size                  = UDim2.new(1, -16, 0, 13),
        Position              = UDim2.new(0, 12, 0, 9),
        BackgroundTransparency = 1,
        Text                  = "LICENSE KEY",
        TextColor3            = COL.TEXT_DIM,
        Font                  = Enum.Font.GothamBold,
        TextSize              = 8,
        TextXAlignment        = Enum.TextXAlignment.Left,
        ZIndex                = 8,
    }, inputPanel)

    -- Input box
    local keyBox = make("TextBox", {
        Size                  = UDim2.new(1, -40, 0, 28),
        Position              = UDim2.new(0, 12, 0, 34),
        BackgroundTransparency = 1,
        PlaceholderText       = "VOID-XXXX-XXXX-XXXX-XXXX",
        PlaceholderColor3     = COL.TEXT_FAINT,
        Text                  = "",
        TextColor3            = COL.TEXT_HI,
        Font                  = Enum.Font.Code,
        TextSize              = 12,
        TextXAlignment        = Enum.TextXAlignment.Left,
        ClearTextOnFocus      = false,
        ZIndex                = 8,
    }, inputPanel)

    -- Clear button
    local clearBtn = make("TextButton", {
        Size                  = UDim2.new(0, 22, 0, 22),
        Position              = UDim2.new(1, -30, 0.5, -11),
        BackgroundColor3      = COL.BG4,
        BorderSizePixel       = 0,
        Text                  = "✕",
        TextColor3            = COL.TEXT_DIM,
        Font                  = Enum.Font.GothamBold,
        TextSize              = 9,
        ZIndex                = 9,
    }, inputPanel)
    corner(6, clearBtn)
    clearBtn.MouseButton1Click:Connect(function()
        keyBox.Text = ""
        keyBox:CaptureFocus()
    end)
    clearBtn.MouseEnter:Connect(function() tw(clearBtn, {TextColor3 = COL.RED}, 0.12) end)
    clearBtn.MouseLeave:Connect(function() tw(clearBtn, {TextColor3 = COL.TEXT_DIM}, 0.12) end)

    -- Focus effects
    conn(keyBox.Focused:Connect(function()
        tw(inputPanelStroke, {Color = curAccent, Thickness = 1.6}, 0.15)
        tw(inputPanel, {BackgroundColor3 = COL.BG3}, 0.15)
    end))
    conn(keyBox.FocusLost:Connect(function()
        tw(inputPanelStroke, {Color = COL.BORDER, Thickness = 1.2}, 0.15)
        tw(inputPanel, {BackgroundColor3 = COL.BG2}, 0.15)
    end))

    if cfg.RememberKey then
        local saved = loadSavedKey()
        if saved ~= "" then keyBox.Text = saved end
    end
    addItem(inputPanel)

    -- ════════════════════════════════════════════
    --  STATUS BAR
    -- ════════════════════════════════════════════
    local statusPanel = make("Frame", {
        Size             = UDim2.new(1, 0, 0, 40),
        BackgroundColor3 = COL.BG3,
        BorderSizePixel  = 0,
        ZIndex           = 7,
    })
    corner(12, statusPanel)
    uiStroke(COL.BORDER, 1, statusPanel)

    -- Animated status indicator dot
    local sDot = make("Frame", {
        Size             = UDim2.new(0, 8, 0, 8),
        Position         = UDim2.new(0, 12, 0.5, -4),
        BackgroundColor3 = COL.TEXT_FAINT,
        BorderSizePixel  = 0,
        ZIndex           = 8,
    }, statusPanel)
    corner(4, sDot)

    local sDotRing = make("Frame", {
        Size             = UDim2.new(0, 16, 0, 16),
        Position         = UDim2.new(0, 8, 0.5, -8),
        BackgroundColor3 = COL.TEXT_FAINT,
        BackgroundTransparency = 0.7,
        BorderSizePixel  = 0,
        ZIndex           = 7,
    }, statusPanel)
    corner(8, sDotRing)

    local sTxt = make("TextLabel", {
        Size                  = UDim2.new(1, -38, 1, 0),
        Position              = UDim2.new(0, 30, 0, 0),
        BackgroundTransparency = 1,
        Text                  = "Enter your key to continue",
        TextColor3            = COL.TEXT,
        Font                  = Enum.Font.Gotham,
        TextSize              = 11,
        TextXAlignment        = Enum.TextXAlignment.Left,
        ZIndex                = 8,
    }, statusPanel)

    -- Dot idle pulse
    local dotPulseConn = RunSvc.Heartbeat:Connect((function()
        local t = 0
        return function(dt)
            t = t + dt
            if sDotRing and sDotRing.Parent then
                sDotRing.BackgroundTransparency = 0.60 + 0.30 * math.sin(t * 2.5)
                local s = 16 + 4 * math.abs(math.sin(t * 2.5))
                sDotRing.Size = UDim2.new(0, s, 0, s)
                sDotRing.Position = UDim2.new(0, 8 - (s-8)/2, 0.5, -s/2)
            end
        end
    end)())
    conn(dotPulseConn)

    local function setStatus(text, col, dotCol, ring)
        if sTxt and sTxt.Parent then
            sTxt.Text       = text
            sTxt.TextColor3 = col or COL.TEXT
        end
        if sDot and sDot.Parent then
            tw(sDot,     {BackgroundColor3 = dotCol or COL.TEXT_FAINT}, 0.2)
            tw(sDotRing, {BackgroundColor3 = ring   or COL.TEXT_FAINT}, 0.2)
        end
    end
    addItem(statusPanel)

    -- ════════════════════════════════════════════
    --  DISCORD BUTTON
    -- ════════════════════════════════════════════
    if cfg.Discord ~= "" then
        local dPanel = make("Frame", {
            Size             = UDim2.new(1, 0, 0, 38),
            BackgroundColor3 = Color3.fromRGB(30, 33, 84),
            BorderSizePixel  = 0,
            ZIndex           = 7,
        })
        corner(12, dPanel)
        uiStroke(Color3.fromRGB(88, 101, 242), 1, dPanel, 0.4)

        local dIcon = make("TextLabel", {
            Size                  = UDim2.new(0, 20, 1, 0),
            Position              = UDim2.new(0, 10, 0, 0),
            BackgroundTransparency = 1,
            Text                  = "🔗",
            TextSize              = 13,
            ZIndex                = 8,
        }, dPanel)

        local dText = make("TextLabel", {
            Size                  = UDim2.new(1, -70, 1, 0),
            Position              = UDim2.new(0, 32, 0, 0),
            BackgroundTransparency = 1,
            Text                  = cfg.Discord,
            TextColor3            = Color3.fromRGB(180, 188, 255),
            Font                  = Enum.Font.GothamBold,
            TextSize              = 11,
            TextXAlignment        = Enum.TextXAlignment.Left,
            ZIndex                = 8,
        }, dPanel)

        local dArrow = make("TextLabel", {
            Size                  = UDim2.new(0, 50, 1, 0),
            Position              = UDim2.new(1, -58, 0, 0),
            BackgroundTransparency = 1,
            Text                  = "Copy ›",
            TextColor3            = Color3.fromRGB(130, 140, 210),
            Font                  = Enum.Font.GothamBold,
            TextSize              = 9,
            ZIndex                = 8,
        }, dPanel)

        -- Hover effect
        local dBtn = make("TextButton", {
            Size                  = UDim2.new(1, 0, 1, 0),
            BackgroundTransparency = 1,
            Text                  = "",
            ZIndex                = 9,
        }, dPanel)
        dBtn.MouseEnter:Connect(function()
            tw(dPanel, {BackgroundColor3 = Color3.fromRGB(40, 45, 100)}, 0.15)
        end)
        dBtn.MouseLeave:Connect(function()
            tw(dPanel, {BackgroundColor3 = Color3.fromRGB(30, 33, 84)}, 0.15)
        end)
        dBtn.MouseButton1Click:Connect(function()
            if setclipboard then setclipboard(cfg.Discord) end
            dArrow.Text = "Copied!"
            tw(dPanel, {BackgroundColor3 = Color3.fromRGB(30, 60, 40)}, 0.15)
            task.delay(1.5, function()
                if dArrow and dArrow.Parent then dArrow.Text = "Copy ›" end
                if dPanel and dPanel.Parent then tw(dPanel, {BackgroundColor3 = Color3.fromRGB(30,33,84)}, 0.2) end
            end)
            setStatus("Discord link copied!", Color3.fromRGB(100, 120, 255), Color3.fromRGB(88,101,242), Color3.fromRGB(88,101,242))
        end)
        addItem(dPanel)
    end

    -- ════════════════════════════════════════════
    --  VERIFY BUTTON  (celestial style)
    -- ════════════════════════════════════════════
    local vPanel = make("Frame", {
        Size             = UDim2.new(1, 0, 0, 46),
        BackgroundColor3 = curAccent,
        BorderSizePixel  = 0,
        ZIndex           = 7,
    })
    corner(14, vPanel)
    local vPanelGrad = gradient(curAccent, darker(curAccent, 0.45), 135, vPanel)
    reg(vPanel, "BackgroundColor3", function(c) return c end)

    -- Shimmer overlay
    local vShimmer = make("Frame", {
        Size                  = UDim2.new(0.4, 0, 1, 0),
        Position              = UDim2.new(-0.4, 0, 0, 0),
        BackgroundColor3      = Color3.new(1, 1, 1),
        BackgroundTransparency = 0.88,
        BorderSizePixel       = 0,
        ZIndex                = 8,
    }, vPanel)
    corner(14, vShimmer)
    local vShimmerGrad = Instance.new("UIGradient")
    vShimmerGrad.Color    = ColorSequence.new({
        ColorSequenceKeypoint.new(0, Color3.new(1,1,1)),
        ColorSequenceKeypoint.new(0.5, Color3.new(1,1,1)),
        ColorSequenceKeypoint.new(1, Color3.fromRGB(200,200,200)),
    })
    vShimmerGrad.Rotation = 0
    vShimmerGrad.Parent   = vShimmer

    -- Shimmer loop
    local shimmerRunning = true
    task.spawn(function()
        task.wait(1)
        while shimmerRunning and vShimmer and vShimmer.Parent do
            tw(vShimmer, {Position = UDim2.new(1.4, 0, 0, 0)}, 0.6, Enum.EasingStyle.Quad, Enum.EasingDirection.In)
            task.wait(0.7)
            vShimmer.Position = UDim2.new(-0.4, 0, 0, 0)
            task.wait(2.8)
        end
    end)

    local vBtn = make("TextButton", {
        Size                  = UDim2.new(1, 0, 1, 0),
        BackgroundTransparency = 1,
        Text                  = "",
        ZIndex                = 9,
    }, vPanel)

    local vLabel = make("TextLabel", {
        Size                  = UDim2.new(1, 0, 1, 0),
        BackgroundTransparency = 1,
        Text                  = "✦  VERIFY KEY",
        TextColor3            = COL.WHITE,
        Font                  = Enum.Font.GothamBold,
        TextSize              = 12,
        ZIndex                = 9,
    }, vPanel)

    vBtn.MouseEnter:Connect(function()
        tw(vPanel, {BackgroundColor3 = lighter(curAccent, 1.12)}, 0.15)
        tw(vPanel, {Size = UDim2.new(1, 0, 0, 48)}, 0.12)
    end)
    vBtn.MouseLeave:Connect(function()
        tw(vPanel, {BackgroundColor3 = curAccent}, 0.15)
        tw(vPanel, {Size = UDim2.new(1, 0, 0, 46)}, 0.12)
    end)
    addItem(vPanel)

    -- ── Spinner ─────────────────────────────────────────────────
    local spinFrames = { "✦  VERIFYING  ●○○", "✦  VERIFYING  ○●○", "✦  VERIFYING  ○○●", "✦  VERIFYING  ○●○" }
    local spinIdx, spinConn = 0, nil

    local function startSpin()
        vLabel.Text = spinFrames[1]
        spinConn = RunSvc.Heartbeat:Connect((function()
            local t = 0
            return function(dt)
                t = t + dt
                if t > 0.18 then
                    t = 0
                    spinIdx = (spinIdx % #spinFrames) + 1
                    if vLabel and vLabel.Parent then
                        vLabel.Text = spinFrames[spinIdx]
                    end
                end
            end
        end)())
    end

    local function stopSpin()
        if spinConn then spinConn:Disconnect(); spinConn = nil end
        if vLabel and vLabel.Parent then vLabel.Text = "✦  VERIFY KEY" end
    end

    -- ════════════════════════════════════════════
    --  VERIFY LOGIC
    -- ════════════════════════════════════════════
    local busy = false

    local function shakeInput()
        local basePos = inputPanel.Position
        local shakes  = {{-8,0},{8,0},{-5,0},{5,0},{-2,0},{0,0}}
        local idx = 1
        local function doShake()
            if idx > #shakes or not inputPanel or not inputPanel.Parent then return end
            local s = shakes[idx]
            inputPanel.Position = UDim2.new(basePos.X.Scale, basePos.X.Offset + s[1], basePos.Y.Scale, basePos.Y.Offset + s[2])
            idx = idx + 1
            task.delay(0.045, doShake)
        end
        doShake()
    end

    conn(vBtn.MouseButton1Click:Connect(function()
        if busy then return end
        local key = keyBox.Text:match("^%s*(.-)%s*$") or ""

        if key == "" then
            setStatus("Please enter your key first.", COL.RED, COL.RED, COL.RED)
            tw(inputPanelStroke, {Color = COL.RED, Thickness = 1.6}, 0.12)
            shakeInput()
            task.delay(1.2, function()
                if inputPanelStroke and inputPanelStroke.Parent then
                    tw(inputPanelStroke, {Color = COL.BORDER, Thickness = 1.2}, 0.2)
                end
                setStatus("Enter your key to continue", COL.TEXT, COL.TEXT_FAINT, COL.TEXT_FAINT)
            end)
            return
        end

        busy = true
        vBtn.Active = false
        startSpin()
        setStatus("Connecting to VOID servers…", COL.TEXT, curAccent, curAccent)
        tw(vPanel, {BackgroundColor3 = darker(curAccent, 0.70)}, 0.2)

        task.spawn(function()
            local ok, msg, data = validateKey(cfg.ApiUrl, key)
            stopSpin()
            busy      = false
            vBtn.Active = true

            if ok then
                -- ✓ Success
                shimmerRunning = false
                setStatus("✓  " .. (msg or "Access granted"), COL.GREEN, COL.GREEN, COL.GREEN)
                tw(inputPanelStroke, {Color = COL.GREEN, Thickness = 1.8}, 0.2)
                tw(vPanel, {BackgroundColor3 = COL.GREEN_DK}, 0.25)
                vLabel.Text = "✦  ACCESS GRANTED"
                vLabel.TextColor3 = COL.GREEN

                -- Success particle burst
                for i = 1, 8 do
                    task.spawn(function()
                        local p = make("Frame", {
                            Size                  = UDim2.new(0, math.random(4,10), 0, math.random(4,10)),
                            Position              = UDim2.new(0.5, math.random(-80,80), 0.5, math.random(-40,40)),
                            BackgroundColor3      = COL.GREEN,
                            BackgroundTransparency = 0.3,
                            BorderSizePixel       = 0,
                            ZIndex                = 15,
                        }, gui)
                        corner(5, p)
                        tw(p, {
                            Position              = UDim2.new(0.5, math.random(-140,140), 0.5, math.random(-90,90)),
                            BackgroundTransparency = 1,
                            Size                  = UDim2.new(0, 2, 0, 2),
                        }, 0.6, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)
                        task.delay(0.65, function() if p and p.Parent then p:Destroy() end end)
                    end)
                    task.wait(0.03)
                end

                if cfg.RememberKey then saveKey(key) end

                task.delay(0.6, function()
                    shimmerRunning = false
                    if cfg.AutoClose then
                        tw(win,      {BackgroundTransparency = 1, Size = UDim2.new(0, WIN_W*0.9, 0, WIN_H*0.9)}, 0.35, Enum.EasingStyle.Quint)
                        tw(backdrop, {BackgroundTransparency = 1}, 0.35)
                        tw(glow,     {BackgroundTransparency = 1}, 0.35)
                        if blur then tw(blur, {Size = 0}, 0.35) end
                        task.delay(0.4, function()
                            for _, c in ipairs(connections) do pcall(function() c:Disconnect() end) end
                            if gui and gui.Parent then gui:Destroy() end
                            if blur and blur.Parent then blur:Destroy() end
                        end)
                    end
                    cfg.OnSuccess(data)
                end)
            else
                -- ✗ Fail
                setStatus("✗  " .. (msg or "Invalid key"), COL.RED, COL.RED, COL.RED)
                tw(inputPanelStroke, {Color = COL.RED, Thickness = 1.8}, 0.12)
                tw(vPanel, {BackgroundColor3 = COL.RED_DK}, 0.2)
                vLabel.Text = "✦  TRY AGAIN"

                task.delay(1.6, function()
                    if inputPanelStroke and inputPanelStroke.Parent then
                        tw(inputPanelStroke, {Color = COL.BORDER, Thickness = 1.2}, 0.2)
                    end
                    if vPanel and vPanel.Parent then
                        tw(vPanel, {BackgroundColor3 = curAccent}, 0.2)
                    end
                    if vLabel and vLabel.Parent then
                        vLabel.Text = "✦  VERIFY KEY"
                        vLabel.TextColor3 = COL.WHITE
                    end
                end)

                cfg.OnFail(key, msg)
            end
        end)
    end))

    -- ── Footer ──────────────────────────────────────────────────
    local footerLbl = make("TextLabel", {
        Size                  = UDim2.new(1, -28, 0, 22),
        Position              = UDim2.new(0, 14, 1, -26),
        BackgroundTransparency = 1,
        Text                  = "VOID  ✦  CELESTIAL  ✦  " .. cfg.Version .. "  ✦  " .. tostring(cfg.ToggleKey) .. " to toggle",
        TextColor3            = COL.TEXT_FAINT,
        Font                  = Enum.Font.Gotham,
        TextSize              = 8,
        ZIndex                = 6,
    }, win)

    -- Animate footer text color
    local footerConn = RunSvc.Heartbeat:Connect((function()
        local t = 0
        return function(dt)
            t = t + dt * 0.5
            if footerLbl and footerLbl.Parent then
                local alpha = 0.5 + 0.3 * math.sin(t)
                footerLbl.TextColor3 = Color3.new(
                    COL.TEXT_FAINT.R * (1 + alpha * 0.5),
                    COL.TEXT_FAINT.G * (1 + alpha * 0.5),
                    COL.TEXT_FAINT.B * (1 + alpha * 0.5)
                )
            end
        end
    end)())
    conn(footerConn)

    -- ════════════════════════════════════════════
    --  DRAG
    -- ════════════════════════════════════════════
    local dragging, dStart, wStart
    conn(banner.InputBegan:Connect(function(i)
        if i.UserInputType == Enum.UserInputType.MouseButton1 then
            dragging = true; dStart = i.Position; wStart = win.Position
        end
    end))
    conn(banner.InputEnded:Connect(function(i)
        if i.UserInputType == Enum.UserInputType.MouseButton1 then dragging = false end
    end))
    conn(UIS.InputChanged:Connect(function(i)
        if dragging and i.UserInputType == Enum.UserInputType.MouseMovement then
            local d = i.Position - dStart
            win.Position = UDim2.new(wStart.X.Scale, wStart.X.Offset + d.X, wStart.Y.Scale, wStart.Y.Offset + d.Y)
            -- Move glow with window
            if glow and glow.Parent then
                glow.Position = UDim2.new(win.Position.X.Scale, win.Position.X.Offset - 20, win.Position.Y.Scale, win.Position.Y.Offset - 20)
            end
        end
    end))

    -- ════════════════════════════════════════════
    --  TOGGLE VISIBILITY
    -- ════════════════════════════════════════════
    local shown = true
    conn(UIS.InputBegan:Connect(function(i, gp)
        if gp or i.KeyCode ~= cfg.ToggleKey then return end
        shown = not shown
        if shown then
            win.Visible     = true
            backdrop.Visible = true
            tw(win,      {BackgroundTransparency = 0},    0.22)
            tw(backdrop, {BackgroundTransparency = 0.25}, 0.22)
            tw(glow,     {BackgroundTransparency = 0.88}, 0.22)
            if blur then tw(blur, {Size = 20}, 0.22) end
            cfg.OnOpen()
        else
            tw(win,      {BackgroundTransparency = 1}, 0.22)
            tw(backdrop, {BackgroundTransparency = 1}, 0.22)
            tw(glow,     {BackgroundTransparency = 1}, 0.22)
            if blur then tw(blur, {Size = 0}, 0.22) end
            task.delay(0.25, function()
                if not shown then
                    if win      then win.Visible     = false end
                    if backdrop then backdrop.Visible = false end
                end
            end)
            cfg.OnClose()
        end
    end))

    -- ════════════════════════════════════════════
    --  TYPEWRITER TITLE ANIMATION
    -- ════════════════════════════════════════════
    local subStr = cfg.Subtitle
    if cfg.ShowSteps and cfg.Steps > 1 then
        subStr = subStr .. "  ✦  " .. cfg.Steps .. "-Step"
    end

    if cfg.TypewriterTitle then
        task.delay(0.3, function()
            typewriter(titleLbl, cfg.Title:upper(), 14, function()
                task.delay(0.1, function()
                    typewriter(subLbl, subStr:upper(), 18)
                end)
            end)
        end)
    else
        titleLbl.Text = cfg.Title:upper()
        subLbl.Text   = subStr:upper()
    end

    -- Apply initial accent
    applyAccentInstant(cfg.Colors[1])

    -- ════════════════════════════════════════════
    --  RETURN INSTANCE
    -- ════════════════════════════════════════════
    local inst = setmetatable({
        _gui         = gui,
        _blur        = blur,
        _win         = win,
        _connections = connections,
        _cfg         = cfg,
        _titleLbl    = titleLbl,
        _statusTxt   = sTxt,
        _statusDot   = sDot,
        _shimmer     = function() shimmerRunning = false end,
    }, VoidLib)

    return inst
end

-- ════════════════════════════════════════════════════════════════════
--  PUBLIC METHODS
-- ════════════════════════════════════════════════════════════════════

function VoidLib:Destroy()
    for _, c in ipairs(self._connections or {}) do
        pcall(function() c:Disconnect() end)
    end
    if self._gui  and self._gui.Parent  then self._gui:Destroy()  end
    if self._blur and self._blur.Parent then self._blur:Destroy() end
end

function VoidLib:Hide()
    if self._win and self._win.Parent then
        self._win.Visible = false
    end
end

function VoidLib:Show()
    if self._win and self._win.Parent then
        self._win.Visible = true
        tw(self._win, {BackgroundTransparency = 0}, 0.2)
    end
end

function VoidLib:SetTitle(text)
    if self._titleLbl and self._titleLbl.Parent then
        self._titleLbl.Text = (text or ""):upper()
    end
end

function VoidLib:SetStatus(text, color)
    if self._statusTxt and self._statusTxt.Parent then
        self._statusTxt.Text       = text or ""
        self._statusTxt.TextColor3 = color or Color3.fromRGB(160, 148, 190)
    end
end

return VoidLib
