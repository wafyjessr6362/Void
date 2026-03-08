--[[
╔══════════════════════════════════════════════════════════╗
║            VoidKeyLib  —  Key System Library             ║
║   ModuleScript  ·  ReplicatedStorage / require()        ║
╠══════════════════════════════════════════════════════════╣
║  QUICK START:                                            ║
║                                                          ║
║   local VoidKey = loadstring(game:HttpGet(              ║
║       "https://raw.githubusercontent.com/.../VoidKeyLib.lua"
║   ))()                                                   ║
║                                                          ║
║   VoidKey.new({                                          ║
║       Title      = "MYSCRIPT",                           ║
║       Subtitle   = "Authentication",                     ║
║       Version    = "v1.0",                               ║
║       Discord    = "discord.gg/yourserver",              ║
║       ApiUrl     = "https://yourserver.com/validate",   ║
║       ToggleKey  = Enum.KeyCode.RightAlt,                ║
║       OnSuccess  = function() loadstring(...)() end,     ║
║       OnFail     = function(key) print("Bad:", key) end, ║
║   })                                                     ║
║                                                          ║
║  KEY VALIDATION:                                         ║
║   GET  {ApiUrl}?key=VOID-XXXX-XXXX-XXXX                  ║
║   Response JSON: { "valid": true/false }                 ║
╚══════════════════════════════════════════════════════════╝
]]

local VoidKeyLib = {}
VoidKeyLib.__index = VoidKeyLib

-- ══════════════════════════════════════════════
--  SERVICES
-- ══════════════════════════════════════════════
local Players          = game:GetService("Players")
local TweenService     = game:GetService("TweenService")
local RunService       = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local HttpService      = game:GetService("HttpService")

-- ══════════════════════════════════════════════
--  PALETTE  (all dark)
-- ══════════════════════════════════════════════
local C = {
    BgDeep   = Color3.fromRGB(4,   3,   9),
    BgPanel  = Color3.fromRGB(10,  8,  17),
    Glass    = Color3.fromRGB(18,  14,  30),
    GlassMid = Color3.fromRGB(26,  20,  42),
    Stroke   = Color3.fromRGB(52,  40,  74),
    StrokeLo = Color3.fromRGB(30,  22,  48),
    Purple   = Color3.fromRGB(90,  50, 155),
    PurpHi   = Color3.fromRGB(115, 68, 185),
    Crimson  = Color3.fromRGB(115, 22,  45),
    DimPurp  = Color3.fromRGB(55,  35,  90),
    DimCrim  = Color3.fromRGB(70,  16,  30),
    TextHi   = Color3.fromRGB(165, 150, 192),
    TextMid  = Color3.fromRGB(105,  96, 130),
    TextLo   = Color3.fromRGB(58,   52,  78),
    OkDark   = Color3.fromRGB(36,  82,  55),
    OkMid    = Color3.fromRGB(50, 105,  68),
    ErrDark  = Color3.fromRGB(105, 25,  40),
    ErrMid   = Color3.fromRGB(135, 35,  50),
    Shine    = Color3.fromRGB(120, 105, 160),
}

-- ══════════════════════════════════════════════
--  INTERNAL HELPERS
-- ══════════════════════════════════════════════
local function tw(obj, props, t, style, dir)
    local tween = TweenService:Create(obj,
        TweenInfo.new(t or .3,
            style or Enum.EasingStyle.Quart,
            dir   or Enum.EasingDirection.Out),
        props)
    tween:Play()
    return tween
end

local function corner(p, r)
    local u = Instance.new("UICorner")
    u.CornerRadius = UDim.new(0, r or 10)
    u.Parent = p
    return u
end

local function mkstroke(p, col, thick, trans)
    local s = Instance.new("UIStroke")
    s.Color           = col   or C.Stroke
    s.Thickness       = thick or 1
    s.Transparency    = trans or .3
    s.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
    s.Parent          = p
    return s
end

local function grad(p, rot, c0, c1)
    local g = Instance.new("UIGradient")
    g.Rotation = rot or 90
    g.Color = ColorSequence.new({
        ColorSequenceKeypoint.new(0, c0 or C.Glass),
        ColorSequenceKeypoint.new(1, c1 or C.BgPanel),
    })
    g.Parent = p
    return g
end

local function shineLine(parent, trans)
    local s = Instance.new("Frame")
    s.Size               = UDim2.new(1, 0, 0, 1)
    s.BackgroundColor3   = C.Shine
    s.BackgroundTransparency = trans or .72
    s.BorderSizePixel    = 0
    s.ZIndex             = parent.ZIndex + 1
    corner(s, 99)
    grad(s, 0, C.Shine, C.Purple)
    s.Parent = parent
    return s
end

local function mkframe(parent, size, pos, bg, trans, zi)
    local f = Instance.new("Frame")
    f.Size                    = size
    f.Position                = pos or UDim2.new(0,0,0,0)
    f.BackgroundColor3        = bg   or C.Glass
    f.BackgroundTransparency  = trans or 0
    f.BorderSizePixel         = 0
    f.ZIndex                  = zi   or 10
    f.Parent                  = parent
    return f
end

local function mklbl(parent, text, size, font, color, xa, zi)
    local l = Instance.new("TextLabel")
    l.BackgroundTransparency = 1
    l.Text           = text
    l.TextSize       = size  or 12
    l.Font           = font  or Enum.Font.Gotham
    l.TextColor3     = color or C.TextMid
    l.TextXAlignment = xa    or Enum.TextXAlignment.Left
    l.ZIndex         = zi    or 12
    l.Parent         = parent
    return l
end

local function mkbtn(parent, size, pos, bg, trans, text, tsize, tcolor, zi)
    local b = Instance.new("TextButton")
    b.Size                   = size
    b.Position               = pos or UDim2.new(0,0,0,0)
    b.BackgroundColor3       = bg    or C.DimPurp
    b.BackgroundTransparency = trans or .3
    b.BorderSizePixel        = 0
    b.Text                   = text  or ""
    b.TextSize               = tsize or 11
    b.Font                   = Enum.Font.GothamBold
    b.TextColor3             = tcolor or C.TextHi
    b.AutoButtonColor        = false
    b.ZIndex                 = zi    or 13
    corner(b, 8)
    b.Parent = parent
    return b
end

-- ══════════════════════════════════════════════
--  HTTP KEY VALIDATION
--  Tries syn.request → http.request → fallback
-- ══════════════════════════════════════════════
local function httpGet(url)
    local body = nil
    -- executor http (syn/krnl/fluxus etc.)
    if syn and syn.request then
        local ok, res = pcall(syn.request, {Url=url, Method="GET"})
        if ok and res then body = res.Body end
    elseif http and http.request then
        local ok, res = pcall(http.request, {Url=url, Method="GET"})
        if ok and res then body = res.Body end
    elseif request then
        local ok, res = pcall(request, {Url=url, Method="GET"})
        if ok and res then body = res.Body end
    end
    return body
end

local function validateKeyRemote(apiUrl, key)
    if not apiUrl or apiUrl == "" then
        -- no API configured — always fail (developer must configure)
        return false, "No API URL configured"
    end

    local url  = apiUrl .. "?key=" .. key
    local body = httpGet(url)

    if not body then
        return false, "Could not reach validation server"
    end

    local ok, data = pcall(HttpService.JSONDecode, HttpService, body)
    if not ok then
        return false, "Invalid server response"
    end

    if data.valid == true then
        return true, data.message or "Key accepted"
    else
        return false, data.message or "Invalid or expired key"
    end
end

-- ══════════════════════════════════════════════
--  CONSTRUCTOR
-- ══════════════════════════════════════════════
function VoidKeyLib.new(cfg)
    local self  = setmetatable({}, VoidKeyLib)

    -- Merge config with defaults
    self.Title     = cfg.Title     or "VOID"
    self.Subtitle  = cfg.Subtitle  or "Authentication"
    self.Version   = cfg.Version   or "v1.0"
    self.Discord   = cfg.Discord   or "discord.gg/void"
    self.ApiUrl    = cfg.ApiUrl    or ""          -- Your key validation endpoint
    self.ToggleKey = cfg.ToggleKey or Enum.KeyCode.RightAlt
    self.OnSuccess = cfg.OnSuccess or function() end
    self.OnFail    = cfg.OnFail    or function() end

    -- Internal state
    self._gui      = nil
    self._guiOpen  = true
    self._busy     = false
    self._rebinding = false
    self._unloaded = false
    self._connections = {}

    self:_build()
    return self
end

-- ══════════════════════════════════════════════
--  BUILD GUI
-- ══════════════════════════════════════════════
function VoidKeyLib:_build()
    local Player    = Players.LocalPlayer
    local PlayerGui = Player:WaitForChild("PlayerGui")

    -- destroy old
    if PlayerGui:FindFirstChild("VoidKeyGui") then
        PlayerGui.VoidKeyGui:Destroy()
    end

    local GUI = Instance.new("ScreenGui")
    GUI.Name           = "VoidKeyGui"
    GUI.ResetOnSpawn   = false
    GUI.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
    GUI.IgnoreGuiInset = true
    GUI.Parent         = PlayerGui
    self._gui          = GUI

    self:_buildLoadScreen(GUI, function()
        self:_buildWindow(GUI)
    end)
end

-- ══════════════════════════════════════════════
--  LOADING SCREEN
-- ══════════════════════════════════════════════
function VoidKeyLib:_buildLoadScreen(GUI, onDone)
    local LS = mkframe(GUI, UDim2.new(1,0,1,0), UDim2.new(0,0,0,0), C.BgDeep, 0, 100)
    LS.Name = "LoadScreen"

    local vig = Instance.new("ImageLabel")
    vig.Size = UDim2.new(1,0,1,0) ; vig.BackgroundTransparency = 1
    vig.Image = "rbxassetid://6014261993"
    vig.ImageColor3 = Color3.fromRGB(0,0,0) ; vig.ImageTransparency = .28
    vig.ZIndex = 101 ; vig.Parent = LS

    -- drifting orbs
    for i = 1, 6 do
        local orb = mkframe(LS,
            UDim2.new(0,0,0,0),
            UDim2.new(math.random()*0.7+0.15, 0, math.random()*0.5+0.1, 0),
            C.Purple, .91, 101)
        local s = math.random(55, 130)
        orb.Size = UDim2.new(0,s,0,s)
        corner(orb, 99)
        local baseY = orb.Position.Y.Scale
        local spd   = .22 + math.random()*.28
        local off   = math.random() * math.pi * 2
        local conn = RunService.Heartbeat:Connect(function()
            if not orb or not orb.Parent then return end
            orb.Position = UDim2.new(orb.Position.X.Scale, 0,
                baseY + math.sin(tick()*spd+off)*.032, 0)
        end)
        table.insert(self._connections, conn)
    end

    -- logo group
    local LG = mkframe(LS, UDim2.new(0,200,0,170),
        UDim2.new(.5,0,.44,0), C.BgDeep, 1, 102)
    LG.AnchorPoint = Vector2.new(.5,.5)

    local Ring  = mkframe(LG, UDim2.new(0,90,0,90),  UDim2.new(.5,0,0,0),    C.Purple, .84, 102)
    Ring.AnchorPoint = Vector2.new(.5,0)
    corner(Ring,99) ; mkstroke(Ring, C.Purple, 1.5, .45)

    local Ring2 = mkframe(LG, UDim2.new(0,114,0,114), UDim2.new(.5,0,0,-12), C.Purple, .93, 101)
    Ring2.AnchorPoint = Vector2.new(.5,0)
    corner(Ring2,99) ; mkstroke(Ring2, C.DimPurp, 1, .55)

    task.spawn(function()
        while Ring and Ring.Parent do
            tw(Ring,  {BackgroundTransparency=.70, Size=UDim2.new(0,96,0,96)},  1.5, Enum.EasingStyle.Sine)
            tw(Ring2, {BackgroundTransparency=.88, Size=UDim2.new(0,120,0,120)},1.8, Enum.EasingStyle.Sine)
            task.wait(1.8)
            tw(Ring,  {BackgroundTransparency=.88, Size=UDim2.new(0,82,0,82)},  1.5, Enum.EasingStyle.Sine)
            tw(Ring2, {BackgroundTransparency=.95, Size=UDim2.new(0,106,0,106)},1.8, Enum.EasingStyle.Sine)
            task.wait(1.8)
        end
    end)

    local LogoSym  = mklbl(LG, "◈", 48, Enum.Font.GothamBold, C.Purple, Enum.TextXAlignment.Center, 103)
    LogoSym.Size = UDim2.new(0,90,0,90) ; LogoSym.Position = UDim2.new(.5,0,0,0)
    LogoSym.AnchorPoint = Vector2.new(.5,0) ; LogoSym.BackgroundTransparency = 1

    task.spawn(function()
        while LogoSym and LogoSym.Parent do
            tw(LogoSym, {TextColor3=C.PurpHi}, 1.6, Enum.EasingStyle.Sine)
            task.wait(1.6)
            tw(LogoSym, {TextColor3=C.Purple},  1.6, Enum.EasingStyle.Sine)
            task.wait(1.6)
        end
    end)

    local LoadTitle = mklbl(LG, self.Title, 32, Enum.Font.GothamBold, C.TextHi, Enum.TextXAlignment.Center, 103)
    LoadTitle.Size = UDim2.new(1,0,0,36) ; LoadTitle.Position = UDim2.new(0,0,0,98)
    LoadTitle.BackgroundTransparency = 1

    local LoadSub = mklbl(LG, "initializing...", 10, Enum.Font.Gotham, C.TextLo, Enum.TextXAlignment.Center, 103)
    LoadSub.Size = UDim2.new(1,0,0,18) ; LoadSub.Position = UDim2.new(0,0,0,136)
    LoadSub.BackgroundTransparency = 1

    local BarTrack = mkframe(LS, UDim2.new(0,300,0,3), UDim2.new(.5,0,.64,0), C.GlassMid, .3, 102)
    BarTrack.AnchorPoint = Vector2.new(.5,.5) ; corner(BarTrack, 99)

    local BarFill = mkframe(BarTrack, UDim2.new(0,0,1,0), UDim2.new(0,0,0,0), C.Purple, 0, 103)
    corner(BarFill, 99) ; grad(BarFill, 0, C.DimPurp, C.PurpHi)

    local BarPct = mklbl(LS, "0%", 10, Enum.Font.GothamBold, C.TextLo, Enum.TextXAlignment.Right, 103)
    BarPct.Size = UDim2.new(0,300,0,16) ; BarPct.Position = UDim2.new(.5,0,.64,8)
    BarPct.AnchorPoint = Vector2.new(.5,0) ; BarPct.BackgroundTransparency = 1

    local steps = {
        {.18,"loading modules..."},
        {.40,"verifying integrity..."},
        {.60,"building interface..."},
        {.82,"securing connection..."},
        {1.00,"ready."},
    }

    task.spawn(function()
        LogoSym.TextTransparency   = 1
        LoadTitle.TextTransparency = 1
        LoadSub.TextTransparency   = 1
        BarTrack.BackgroundTransparency = 1

        tw(LogoSym,   {TextTransparency=0}, .7, Enum.EasingStyle.Quart)
        task.wait(.25)
        tw(LoadTitle, {TextTransparency=0}, .6, Enum.EasingStyle.Quart)
        task.wait(.18)
        tw(LoadSub,   {TextTransparency=0}, .5, Enum.EasingStyle.Quart)
        tw(BarTrack,  {BackgroundTransparency=.3}, .4)
        task.wait(.25)

        for _, step in ipairs(steps) do
            LoadSub.Text = step[2]
            tw(BarFill, {Size=UDim2.new(step[1],0,1,0)}, .42, Enum.EasingStyle.Quart)
            BarPct.Text  = math.floor(step[1]*100).."%"
            task.wait(.40)
        end
        task.wait(.3)

        tw(LS,        {BackgroundTransparency=1}, .65, Enum.EasingStyle.Quart)
        tw(LogoSym,   {TextTransparency=1}, .4)
        tw(LoadTitle, {TextTransparency=1}, .4)
        tw(LoadSub,   {TextTransparency=1}, .4)
        tw(BarTrack,  {BackgroundTransparency=1}, .3)
        task.wait(.7)
        LS.Visible = false
        if onDone then onDone() end
    end)
end

-- ══════════════════════════════════════════════
--  MAIN WINDOW  560 × 390  (wide/fat)
-- ══════════════════════════════════════════════
function VoidKeyLib:_buildWindow(GUI)
    local W, H = 560, 390

    local Win = mkframe(GUI, UDim2.new(0,W,0,H), UDim2.new(.5,0,.5,0), C.BgPanel, .08, 10)
    Win.Name = "Win" ; Win.AnchorPoint = Vector2.new(.5,.5)
    Win.Visible = false
    corner(Win, 16)
    local WinStk = mkstroke(Win, C.Stroke, 1, .22)
    grad(Win, 128, C.Glass, C.BgDeep)
    shineLine(Win, .64)

    task.spawn(function()
        local h = .72
        while Win and Win.Parent do
            h = (h + .0025) % 1
            WinStk.Color = Color3.fromHSV(h, .55, .6)
            task.wait()
        end
    end)

    -- ─── TITLE BAR ────────────────────────────
    local TBar = mkframe(Win, UDim2.new(1,0,0,50), UDim2.new(0,0,0,0), C.GlassMid, .35, 11)
    corner(TBar, 16) ; grad(TBar, 90, C.GlassMid, C.Glass) ; shineLine(TBar, .68)
    local TBot = mkframe(TBar, UDim2.new(1,0,.5,0), UDim2.new(0,0,.5,0), C.GlassMid, .35, 11)
    grad(TBot, 90, C.GlassMid, C.Glass)

    local IcoWrap = mkframe(TBar, UDim2.new(0,32,0,32), UDim2.new(0,12,.5,0), C.Purple, .28, 12)
    IcoWrap.AnchorPoint = Vector2.new(0,.5)
    corner(IcoWrap, 9) ; mkstroke(IcoWrap, C.Purple, 1, .5) ; grad(IcoWrap, 135, C.DimPurp, C.PurpHi)
    local IcoTxt = mklbl(IcoWrap, "◈", 17, Enum.Font.GothamBold, C.TextHi, Enum.TextXAlignment.Center, 13)
    IcoTxt.Size = UDim2.new(1,0,1,0) ; IcoTxt.BackgroundTransparency = 1

    task.spawn(function()
        while IcoWrap and IcoWrap.Parent do
            tw(IcoWrap, {BackgroundTransparency=.10}, 1.4, Enum.EasingStyle.Sine)
            task.wait(1.4)
            tw(IcoWrap, {BackgroundTransparency=.36}, 1.4, Enum.EasingStyle.Sine)
            task.wait(1.4)
        end
    end)

    local TitleTxt = mklbl(TBar, self.Title, 17, Enum.Font.GothamBold, C.TextHi, Enum.TextXAlignment.Left, 12)
    TitleTxt.Size = UDim2.new(0,140,0,20) ; TitleTxt.Position = UDim2.new(0,52,0,6)
    TitleTxt.BackgroundTransparency = 1

    local SubTxt = mklbl(TBar, self.Subtitle, 9, Enum.Font.Gotham, C.TextLo, Enum.TextXAlignment.Left, 12)
    SubTxt.Size = UDim2.new(0,160,0,14) ; SubTxt.Position = UDim2.new(0,52,0,28)
    SubTxt.BackgroundTransparency = 1

    local VerBdg = mkframe(TBar, UDim2.new(0,42,0,17), UDim2.new(1,-54,.5,0), C.DimPurp, .28, 12)
    VerBdg.AnchorPoint = Vector2.new(0,.5)
    corner(VerBdg, 5) ; mkstroke(VerBdg, C.Purple, 1, .55)
    local VerTxt = mklbl(VerBdg, self.Version, 9, Enum.Font.GothamBold, C.TextMid, Enum.TextXAlignment.Center, 13)
    VerTxt.Size = UDim2.new(1,0,1,0)

    -- ─── TABS ─────────────────────────────────
    local TAB_Y      = 54
    local TAB_H      = 30
    local TAB_PAD    = 4
    local TAB_W      = 116
    local TAB_GAP    = 4
    local TAB_X_KEY  = 12 + TAB_PAD
    local TAB_X_SETT = 12 + TAB_PAD + TAB_W + TAB_GAP

    local TabBar = mkframe(Win, UDim2.new(1,-24,0,TAB_H), UDim2.new(0,12,0,TAB_Y), C.Glass, .38, 11)
    corner(TabBar, 9) ; mkstroke(TabBar, C.StrokeLo, 1, .58) ; grad(TabBar, 90, C.GlassMid, C.Glass)

    local TL = Instance.new("UIListLayout")
    TL.FillDirection     = Enum.FillDirection.Horizontal
    TL.SortOrder         = Enum.SortOrder.LayoutOrder
    TL.Padding           = UDim.new(0, TAB_GAP)
    TL.VerticalAlignment = Enum.VerticalAlignment.Center
    TL.Parent = TabBar
    local TP = Instance.new("UIPadding")
    TP.PaddingLeft  = UDim.new(0, TAB_PAD)
    TP.PaddingRight = UDim.new(0, TAB_PAD)
    TP.Parent = TabBar

    -- Indicator on Win (NOT TabBar) so UIListLayout doesn't control it
    local TabInd = mkframe(Win,
        UDim2.new(0, TAB_W, 0, TAB_H-6),
        UDim2.new(0, TAB_X_KEY, 0, TAB_Y+3),
        C.DimPurp, .28, 12)
    corner(TabInd, 7) ; mkstroke(TabInd, C.Purple, 1, .38)
    grad(TabInd, 90, C.DimPurp, C.Glass) ; shineLine(TabInd, .72)

    task.spawn(function()
        while TabInd and TabInd.Parent do
            tw(TabInd, {BackgroundTransparency=.18}, 1.2, Enum.EasingStyle.Sine)
            task.wait(1.2)
            tw(TabInd, {BackgroundTransparency=.36}, 1.2, Enum.EasingStyle.Sine)
            task.wait(1.2)
        end
    end)

    local function makeTabBtn(name, icon, order)
        local b = Instance.new("TextButton")
        b.Size             = UDim2.new(0, TAB_W, 0, TAB_H-6)
        b.BackgroundTransparency = 1 ; b.BorderSizePixel = 0
        b.Text             = icon.."  "..name
        b.TextSize         = 10 ; b.Font = Enum.Font.GothamBold
        b.TextColor3       = C.TextLo
        b.AutoButtonColor  = false ; b.LayoutOrder = order
        b.ZIndex = 14 ; corner(b, 7) ; b.Parent = TabBar
        return b
    end

    local TabKey  = makeTabBtn("KEY",      "🔑", 1)
    local TabSett = makeTabBtn("SETTINGS", "⚙",  2)

    -- ─── PAGES ────────────────────────────────
    local PY = TAB_Y + TAB_H + 8
    local PH = H - PY - 12

    local PageKey = mkframe(Win, UDim2.new(1,-24,0,PH), UDim2.new(0,12,0,PY), C.BgPanel, 1, 11)
    local PageSet = mkframe(Win, UDim2.new(1,-24,0,PH), UDim2.new(0,12,0,PY), C.BgPanel, 1, 11)
    PageSet.Visible = false

    -- ═══════════════════════
    --  PAGE: KEY
    -- ═══════════════════════
    local InfoCard = mkframe(PageKey, UDim2.new(1,0,0,78), UDim2.new(0,0,0,0), C.Glass, .4, 12)
    corner(InfoCard, 12) ; mkstroke(InfoCard, C.Stroke, 1, .45)
    grad(InfoCard, 120, C.GlassMid, C.BgPanel) ; shineLine(InfoCard, .72)

    task.spawn(function()
        local s = InfoCard:FindFirstChildWhichIsA("UIStroke")
        while s and s.Parent do
            tw(s, {Transparency=.28}, 2, Enum.EasingStyle.Sine)
            task.wait(2)
            tw(s, {Transparency=.55}, 2, Enum.EasingStyle.Sine)
            task.wait(2)
        end
    end)

    local InfoIco = mklbl(InfoCard, "🗝", 28, Enum.Font.GothamBold, C.TextHi, Enum.TextXAlignment.Center, 13)
    InfoIco.Size = UDim2.new(0,48,0,48) ; InfoIco.Position = UDim2.new(0,12,.5,0)
    InfoIco.AnchorPoint = Vector2.new(0,.5) ; InfoIco.BackgroundTransparency = 1

    task.spawn(function()
        while InfoIco and InfoIco.Parent do
            tw(InfoIco, {Position=UDim2.new(0,12,.5,-3)}, .9, Enum.EasingStyle.Sine)
            task.wait(.9)
            tw(InfoIco, {Position=UDim2.new(0,12,.5,3)},  .9, Enum.EasingStyle.Sine)
            task.wait(.9)
        end
    end)

    local InfoHead = mklbl(InfoCard, "Enter your license key", 13, Enum.Font.GothamBold, C.TextHi, Enum.TextXAlignment.Left, 13)
    InfoHead.Size = UDim2.new(1,-74,0,18) ; InfoHead.Position = UDim2.new(0,70,0,14) ; InfoHead.BackgroundTransparency = 1

    local InfoBody = mklbl(InfoCard, "Get a key via ?getkey in "..self.Discord, 10, Enum.Font.Gotham, C.TextLo, Enum.TextXAlignment.Left, 13)
    InfoBody.Size = UDim2.new(1,-74,0,36) ; InfoBody.Position = UDim2.new(0,70,0,36)
    InfoBody.BackgroundTransparency = 1 ; InfoBody.TextWrapped = true

    local InpLbl = mklbl(PageKey, "LICENSE KEY", 9, Enum.Font.GothamBold, C.TextLo, Enum.TextXAlignment.Left, 12)
    InpLbl.Size = UDim2.new(1,0,0,14) ; InpLbl.Position = UDim2.new(0,0,0,88) ; InpLbl.BackgroundTransparency = 1

    local InputBox = mkframe(PageKey, UDim2.new(1,0,0,42), UDim2.new(0,0,0,104), C.BgDeep, .08, 12)
    corner(InputBox, 10) ; local InpStk = mkstroke(InputBox, C.Stroke, 1.5, .32)
    grad(InputBox, 90, C.BgPanel, C.BgDeep) ; shineLine(InputBox, .80)

    local InpIco = mklbl(InputBox, "◈", 12, Enum.Font.GothamBold, C.TextLo, Enum.TextXAlignment.Center, 13)
    InpIco.Size = UDim2.new(0,34,1,0) ; InpIco.BackgroundTransparency = 1

    local KeyInput = Instance.new("TextBox")
    KeyInput.Size = UDim2.new(1,-84,1,0) ; KeyInput.Position = UDim2.new(0,34,0,0)
    KeyInput.BackgroundTransparency = 1 ; KeyInput.Text = ""
    KeyInput.PlaceholderText = "VOID-XXXX-XXXX-XXXX"
    KeyInput.TextColor3 = C.TextHi ; KeyInput.PlaceholderColor3 = C.TextLo
    KeyInput.TextSize = 13 ; KeyInput.Font = Enum.Font.Code
    KeyInput.ClearTextOnFocus = false ; KeyInput.ZIndex = 13 ; KeyInput.Parent = InputBox

    local PasteBtn = mkbtn(InputBox, UDim2.new(0,44,0,26), UDim2.new(1,-48,.5,0),
        C.GlassMid, .4, "PASTE", 9, C.TextMid, 13)
    PasteBtn.AnchorPoint = Vector2.new(0,.5)
    mkstroke(PasteBtn, C.Stroke, 1, .58)
    PasteBtn.MouseEnter:Connect(function() tw(PasteBtn,{TextColor3=C.TextHi},.15) end)
    PasteBtn.MouseLeave:Connect(function() tw(PasteBtn,{TextColor3=C.TextMid},.15) end)
    PasteBtn.MouseButton1Click:Connect(function()
        if getclipboard then
            local ok, txt = pcall(getclipboard)
            if ok and txt then KeyInput.Text = txt end
        end
    end)

    local StatBar = mkframe(PageKey, UDim2.new(1,0,0,28), UDim2.new(0,0,0,154), C.Glass, .52, 12)
    corner(StatBar, 8) ; mkstroke(StatBar, C.StrokeLo, 1, .62)

    local StatDot = mkframe(StatBar, UDim2.new(0,6,0,6), UDim2.new(0,11,.5,0), C.TextLo, 0, 13)
    StatDot.AnchorPoint = Vector2.new(0,.5) ; corner(StatDot, 99)

    task.spawn(function()
        while StatDot and StatDot.Parent do
            tw(StatDot, {BackgroundTransparency=.35}, .8, Enum.EasingStyle.Sine)
            task.wait(.8)
            tw(StatDot, {BackgroundTransparency=0}, .8, Enum.EasingStyle.Sine)
            task.wait(.8)
        end
    end)

    local StatLbl = mklbl(StatBar, "Awaiting key input", 10, Enum.Font.Gotham, C.TextLo, Enum.TextXAlignment.Left, 13)
    StatLbl.Size = UDim2.new(1,-24,1,0) ; StatLbl.Position = UDim2.new(0,22,0,0) ; StatLbl.BackgroundTransparency = 1

    -- Verify button
    local VBtn = mkbtn(PageKey, UDim2.new(1,0,0,42), UDim2.new(0,0,0,190),
        C.Purple, .14, "", 13, C.TextHi, 12)
    local VStk = mkstroke(VBtn, C.Purple, 1.5, .48)
    grad(VBtn, 135, C.DimPurp, C.PurpHi) ; shineLine(VBtn, .60)
    local VGloss = mkframe(VBtn, UDim2.new(1,0,.46,0), UDim2.new(0,0,0,0), C.Shine, .88, 13)
    corner(VGloss, 12)
    local VTxt = mklbl(VBtn, "VERIFY KEY", 13, Enum.Font.GothamBold, C.TextHi, Enum.TextXAlignment.Center, 14)
    VTxt.Size = UDim2.new(1,0,1,0) ; VTxt.BackgroundTransparency = 1

    task.spawn(function()
        local h = .72
        while VBtn and VBtn.Parent do
            h = (h + .004) % 1
            VStk.Color = Color3.fromHSV(h, .45, .7)
            task.wait()
        end
    end)

    VBtn.MouseEnter:Connect(function()
        tw(VBtn, {BackgroundTransparency=.04},.16)
        tw(VStk, {Transparency=.22},.16)
        tw(VTxt, {TextSize=14},.16)
    end)
    VBtn.MouseLeave:Connect(function()
        tw(VBtn, {BackgroundTransparency=.14},.16)
        tw(VStk, {Transparency=.48},.16)
        tw(VTxt, {TextSize=13},.16)
    end)
    VBtn.MouseButton1Down:Connect(function()
        tw(VBtn, {Size=UDim2.new(.97,0,0,38), Position=UDim2.new(.015,0,0,192)}, .09)
    end)
    VBtn.MouseButton1Up:Connect(function()
        tw(VBtn, {Size=UDim2.new(1,0,0,42), Position=UDim2.new(0,0,0,190)}, .14)
    end)

    local Div = mkframe(PageKey, UDim2.new(1,0,0,1), UDim2.new(0,0,0,242), C.Stroke, .5, 12)
    corner(Div, 99) ; grad(Div, 0, C.Crimson, C.Purple)

    local DRow = mkframe(PageKey, UDim2.new(1,0,0,34), UDim2.new(0,0,0,251),
        Color3.fromRGB(52,57,120), .56, 12)
    corner(DRow, 10) ; mkstroke(DRow, Color3.fromRGB(65,74,150), 1, .55) ; shineLine(DRow, .78)
    local DIco = mklbl(DRow, "💬", 14, Enum.Font.GothamBold, C.TextHi, Enum.TextXAlignment.Center, 13)
    DIco.Size = UDim2.new(0,34,1,0) ; DIco.BackgroundTransparency = 1
    local DLbl = mklbl(DRow, "Type  ?getkey  in "..self.Discord, 10, Enum.Font.GothamBold, Color3.fromRGB(118,125,205), Enum.TextXAlignment.Left, 13)
    DLbl.Size = UDim2.new(1,-38,1,0) ; DLbl.Position = UDim2.new(0,34,0,0) ; DLbl.BackgroundTransparency = 1

    -- ═══════════════════════
    --  PAGE: SETTINGS
    -- ═══════════════════════
    local function mkCard(parent, y, h)
        local c = mkframe(parent, UDim2.new(1,0,0,h or 58), UDim2.new(0,0,0,y), C.Glass, .42, 12)
        corner(c, 12) ; mkstroke(c, C.Stroke, 1, .5)
        grad(c, 120, C.GlassMid, C.BgPanel) ; shineLine(c, .75)
        return c
    end

    -- Keybind
    local KbCard = mkCard(PageSet, 0, 62)
    local KbH = mklbl(KbCard, "TOGGLE KEYBIND", 9, Enum.Font.GothamBold, C.TextLo, Enum.TextXAlignment.Left, 13)
    KbH.Size = UDim2.new(.6,0,0,16) ; KbH.Position = UDim2.new(0,14,0,10) ; KbH.BackgroundTransparency = 1
    local KbD = mklbl(KbCard, "Show / hide the window after unlock", 9, Enum.Font.Gotham, C.TextLo, Enum.TextXAlignment.Left, 13)
    KbD.Size = UDim2.new(.6,0,0,16) ; KbD.Position = UDim2.new(0,14,0,30) ; KbD.BackgroundTransparency = 1

    local KbBtn = mkbtn(KbCard, UDim2.new(0,105,0,26), UDim2.new(1,-117,.5,0),
        C.DimPurp, .28, self.ToggleKey.Name, 10, C.TextHi, 13)
    KbBtn.AnchorPoint = Vector2.new(0,.5) ; mkstroke(KbBtn, C.Purple, 1, .42)
    KbBtn.MouseEnter:Connect(function() tw(KbBtn,{BackgroundTransparency=.12},.15) end)
    KbBtn.MouseLeave:Connect(function() tw(KbBtn,{BackgroundTransparency=.28},.15) end)

    KbBtn.MouseButton1Click:Connect(function()
        if self._rebinding then return end
        self._rebinding = true
        KbBtn.Text = "press key..."
        tw(KbBtn, {BackgroundColor3=C.DimCrim}, .2)
        local kc ; kc = UserInputService.InputBegan:Connect(function(inp, gpe)
            if gpe then return end
            if inp.UserInputType == Enum.UserInputType.Keyboard then
                self.ToggleKey = inp.KeyCode
                KbBtn.Text = inp.KeyCode.Name
                tw(KbBtn, {BackgroundColor3=C.DimPurp}, .2)
                self._rebinding = false ; kc:Disconnect()
            end
        end)
    end)

    -- Unload
    local UlCard = mkCard(PageSet, 72, 56)
    local UlH = mklbl(UlCard, "UNLOAD SCRIPT", 9, Enum.Font.GothamBold, C.TextLo, Enum.TextXAlignment.Left, 13)
    UlH.Size = UDim2.new(.6,0,0,16) ; UlH.Position = UDim2.new(0,14,0,10) ; UlH.BackgroundTransparency = 1
    local UlD = mklbl(UlCard, "Remove GUI and disconnect all events", 9, Enum.Font.Gotham, C.TextLo, Enum.TextXAlignment.Left, 13)
    UlD.Size = UDim2.new(.6,0,0,16) ; UlD.Position = UDim2.new(0,14,0,30) ; UlD.BackgroundTransparency = 1

    local UlBtn = mkbtn(UlCard, UDim2.new(0,82,0,26), UDim2.new(1,-94,.5,0),
        C.DimCrim, .24, "UNLOAD", 10, Color3.fromRGB(165,75,90), 13)
    UlBtn.AnchorPoint = Vector2.new(0,.5) ; mkstroke(UlBtn, C.ErrDark, 1, .42)
    UlBtn.MouseEnter:Connect(function() tw(UlBtn,{BackgroundColor3=C.ErrDark},.18) ; tw(UlBtn,{TextColor3=C.ErrMid},.18) end)
    UlBtn.MouseLeave:Connect(function() tw(UlBtn,{BackgroundColor3=C.DimCrim},.18) ; tw(UlBtn,{TextColor3=Color3.fromRGB(165,75,90)},.18) end)
    UlBtn.MouseButton1Click:Connect(function() self:Unload() end)

    -- Info
    local InfoSet = mkCard(PageSet, 138, 40)
    local IS = mklbl(InfoSet, "◈  "..self.Title.."  ·  "..self.Version.."  ·  "..self.Discord, 10, Enum.Font.Gotham, C.TextLo, Enum.TextXAlignment.Left, 13)
    IS.Size = UDim2.new(1,-24,1,0) ; IS.Position = UDim2.new(0,12,0,0) ; IS.BackgroundTransparency = 1

    -- ─── TAB SWITCH ───────────────────────────
    local activeKey = true
    local function switchTab(toKey)
        local tx = toKey and TAB_X_KEY or TAB_X_SETT
        tw(TabInd, {Position=UDim2.new(0, tx, 0, TAB_Y+3)}, .22, Enum.EasingStyle.Quart)
        TabKey.TextColor3  = toKey and C.TextHi or C.TextLo
        TabSett.TextColor3 = toKey and C.TextLo or C.TextHi
        if toKey and not activeKey then
            PageSet.Visible = false ; PageKey.Visible = true
        elseif not toKey and activeKey then
            PageKey.Visible = false ; PageSet.Visible = true
        end
        activeKey = toKey
    end
    TabKey.MouseButton1Click:Connect(function()  switchTab(true)  end)
    TabSett.MouseButton1Click:Connect(function() switchTab(false) end)
    switchTab(true)

    -- ─── INPUT FOCUS ──────────────────────────
    KeyInput.Focused:Connect(function()
        tw(InpStk, {Color=C.Purple, Transparency=.08}, .22)
        tw(InputBox, {BackgroundTransparency=.03}, .22)
        tw(InpIco, {TextColor3=C.Purple}, .22)
    end)
    KeyInput.FocusLost:Connect(function()
        tw(InpStk, {Color=C.Stroke, Transparency=.32}, .22)
        tw(InputBox, {BackgroundTransparency=.08}, .22)
        tw(InpIco, {TextColor3=C.TextLo}, .22)
    end)

    -- ─── STATUS ───────────────────────────────
    local function setStatus(text, dotCol, txtCol)
        StatLbl.Text = text
        tw(StatLbl, {TextColor3=txtCol  or C.TextMid}, .2)
        tw(StatDot,  {BackgroundColor3=dotCol or C.TextLo}, .2)
    end

    -- ─── FLASH + PARTICLES ────────────────────
    local function flashWin(col)
        local f = mkframe(Win, UDim2.new(1,0,1,0), UDim2.new(0,0,0,0), col, .76, 30)
        corner(f, 16)
        local ft = tw(f, {BackgroundTransparency=1}, .55)
        ft.Completed:Connect(function() f:Destroy() end)
    end

    local function burst(success)
        local cols = success
            and {C.Purple, C.DimPurp, C.Shine}
            or  {C.ErrDark, C.Crimson, C.ErrMid}
        for i = 1, 16 do
            local p = mkframe(Win,
                UDim2.new(0,math.random(4,10),0,math.random(4,10)),
                UDim2.new(.5,0,.5,0), cols[math.random(1,#cols)], .08, 25)
            p.AnchorPoint = Vector2.new(.5,.5) ; corner(p, 99)
            local ang = (i/16)*math.pi*2
            local d   = math.random(55,160)
            local pt = tw(p, {
                Position = UDim2.new(.5+math.cos(ang)*d/W, 0, .5+math.sin(ang)*d/H, 0),
                BackgroundTransparency = 1,
                Size = UDim2.new(0,2,0,2),
            }, .55, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)
            pt.Completed:Connect(function() p:Destroy() end)
        end
    end

    local function shakeWin()
        local orig = Win.Position
        for i = 1, 8 do
            task.wait(.036)
            Win.Position = UDim2.new(orig.X.Scale,
                orig.X.Offset + (i%2==0 and 8 or -8),
                orig.Y.Scale, orig.Y.Offset)
        end
        Win.Position = orig
    end

    -- ─── VERIFY ───────────────────────────────
    local spinF = {"⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"}

    local function doVerify()
        if self._busy then return end
        local key = KeyInput.Text:match("^%s*(.-)%s*$"):upper()
        if key == "" then
            setStatus("⚠  Enter a key first", C.ErrDark, C.TextMid)
            task.spawn(shakeWin) ; return
        end

        self._busy = true
        setStatus("Checking...", C.DimPurp, C.TextMid)
        tw(VBtn, {BackgroundColor3=C.DimPurp}, .25)

        local spinning = true
        task.spawn(function()
            local i = 1
            while spinning do
                VTxt.Text = spinF[i].."  VERIFYING"
                i = i % #spinF + 1 ; task.wait(.07)
            end
        end)

        -- Run HTTP validation off-thread
        task.spawn(function()
            local valid, msg = validateKeyRemote(self.ApiUrl, key)
            spinning = false
            self._busy = false

            if valid then
                VTxt.Text = "✓  ACCESS GRANTED"
                tw(VBtn, {BackgroundColor3=C.OkDark}, .3)
                setStatus("✓  "..msg, C.OkDark, C.OkMid)
                flashWin(C.OkDark) ; burst(true)

                for _, d in pairs(VBtn:GetDescendants()) do
                    if d:IsA("UIGradient") then d:Destroy() end
                end
                local gOk = Instance.new("UIGradient")
                gOk.Rotation = 135
                gOk.Color = ColorSequence.new(C.OkDark, C.OkMid)
                gOk.Parent = VBtn

                task.wait(1.1)
                local ct = tw(Win, {
                    Position = UDim2.new(.5,0,1.8,0),
                    BackgroundTransparency = 1,
                }, .55, Enum.EasingStyle.Back, Enum.EasingDirection.In)
                ct.Completed:Connect(function()
                    GUI:Destroy()
                    self.OnSuccess()
                end)
            else
                VTxt.Text = "VERIFY KEY"
                tw(VBtn, {BackgroundColor3=C.Purple}, .3)
                setStatus("✗  "..msg, C.ErrDark, C.ErrMid)
                flashWin(C.ErrDark) ; burst(false) ; task.spawn(shakeWin)
                self.OnFail(key)
            end
        end)
    end

    VBtn.MouseButton1Click:Connect(doVerify)
    KeyInput.FocusLost:Connect(function(enter) if enter then doVerify() end end)

    -- ─── TOGGLE KEYBIND ───────────────────────
    local kbConn = UserInputService.InputBegan:Connect(function(inp, gpe)
        if gpe then return end
        if inp.KeyCode == self.ToggleKey and GUI:FindFirstChild("LoadScreen") and not GUI.LoadScreen.Visible then
            self._guiOpen = not self._guiOpen
            if self._guiOpen then
                Win.Visible = true
                Win.BackgroundTransparency = 1
                Win.Size = UDim2.new(0,W,0,H-30)
                tw(Win, {BackgroundTransparency=.08, Size=UDim2.new(0,W,0,H)}, .38, Enum.EasingStyle.Back, Enum.EasingDirection.Out)
            else
                local ht = tw(Win, {BackgroundTransparency=1, Size=UDim2.new(0,W,0,20)}, .28, Enum.EasingStyle.Quart)
                ht.Completed:Connect(function()
                    if not self._guiOpen then Win.Visible = false ; Win.Size = UDim2.new(0,W,0,H) end
                end)
            end
        end
    end)
    table.insert(self._connections, kbConn)

    -- ─── OPEN ANIMATION ───────────────────────
    Win.Visible = true
    Win.BackgroundTransparency = 1
    Win.Size = UDim2.new(0,W,0,H-50)
    Win.Position = UDim2.new(.5,0,.42,0)
    tw(Win, {
        Position = UDim2.new(.5,0,.5,0),
        BackgroundTransparency = .08,
        Size = UDim2.new(0,W,0,H),
    }, .55, Enum.EasingStyle.Back, Enum.EasingDirection.Out)
end

-- ══════════════════════════════════════════════
--  PUBLIC: Unload
-- ══════════════════════════════════════════════
function VoidKeyLib:Unload()
    if self._unloaded then return end
    self._unloaded = true
    for _, c in ipairs(self._connections) do
        if typeof(c) == "RBXScriptConnection" then c:Disconnect() end
    end
    if self._gui then
        local Win = self._gui:FindFirstChild("Win")
        if Win then
            local t = tw(Win, {BackgroundTransparency=1, Size=UDim2.new(0,560,0,20)}, .3, Enum.EasingStyle.Quart)
            t.Completed:Connect(function() self._gui:Destroy() end)
        else
            self._gui:Destroy()
        end
    end
end

-- ══════════════════════════════════════════════
--  PUBLIC: SetKeys  (update key list at runtime)
-- ══════════════════════════════════════════════
function VoidKeyLib:SetApiUrl(url)
    self.ApiUrl = url
end

return VoidKeyLib
