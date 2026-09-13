-- CrustWatcher v2.2 — UE4SS Lua mod for The Crust
-- Reads the live market, credits, and in-game time through Unreal reflection and appends
-- JSON snapshots to an NDJSON file that the CrustDash dashboard tails. F8 writes a full dump.
--
-- Threading: everything that touches Lua state or game objects runs on the game thread via
-- LoopInGameThreadWithDelay. v1.x used LoopAsync + ExecuteInGameThread, which touched the mod's
-- Lua state from the async thread while the game thread ran snapshots — the game crashed inside
-- UE4SS's __gc finalizer and object methods. The F8 keybind only sets a flag.
--
-- Native crashes can't be caught by pcall, so also:
--   * never call UScriptStruct:GetProperty() unless IsMappedToProperty() (UE4SS wraps a null pointer otherwise)
--   * never deep-read referenced objects (Float_GlossaryProperty_C); read known scalar fields directly
--   * deep reads only start once the game objects have been stable for a few polls (not mid level-load)
--   * the first deep reads after each load log a breadcrumb per field to UE4SS.log

-- settings.lua sits next to this file. The installer writes it:
--   return { outDir = "C:/Users/you/AppData/Local/CrustDash/data/live", launcher = ".../CrustDash.ps1",
--            startWithGame = true, debug = false }
local function loadSettings()
    local ok, source = pcall(function() return debug.getinfo(1, "S").source end)
    local here = ok and source and source:gsub("^@", ""):match("^(.*)[/\\]") or "."
    local loaded, settings = pcall(dofile, here .. "/settings.lua")
    return (loaded and type(settings) == "table") and settings or {}
end
local SETTINGS = loadSettings()

local CONFIG = {
    outDir = SETTINGS.outDir or ((os.getenv("LOCALAPPDATA") or "."):gsub("\\", "/") .. "/CrustDash/data/live"),
    pollMs = 2000,
    settleTicks = 2,    -- polls the object set must stay unchanged before deep reads
    crumbReads = SETTINGS.debug and 30 or 2,  -- deep reads to breadcrumb in UE4SS.log after each change
    historyEvery = 15,  -- include 30-day price histories every N snapshots (~30 s)
    maxArray = 128,     -- cap array elements per property
    maxDepth = 5,       -- recursion depth for structs
    -- Large or useless for the dashboard (Stats.bin already has the graph history)
    skipProps = { UberGraphFrame = true, GraphsByNames = true, DataTableLayersGroups = true,
                  LevelActorOrderOfBeginPlay = true, LevelActorOrderOfBeginPlayAfterInstancing = true },
    dumpRoots = { "MarketManager", "HealthlyMarketInstance_C", "StatisticsAndMonitoringBase",
                  "TheCrustGameModeBase", "CrustGameInstance_C" },
    enums = { EResourceType = "/Script/TheCrust.EResourceType" },
}

-- Market fields that change continuously: read every snapshot
local MARKET_DYNAMIC_FIELDS = {
    "CurrentPricesToSell", "CurrentPricesToBuy", "CurrentPrices", "CurrentMarketVolume", "MarketVolumeBuffer",
}
-- Slow-changing configuration + 30-day histories: only on "full" snapshots (every historyEvery polls).
-- Splitting these cut the session log from ~21 KB to a few KB per poll.
local MARKET_FULL_FIELDS = {
    "ResourcesToSell", "ResourcesToBuy", "BasePrices", "BasePricePercentage", "BaseMarketVolume",
    "MarketMaxPricePositiveDeviation", "MarketMaxPriceNegativeDeviation", "PriceHistoryLength",
    "SellingPriceHistory", "BuyingPriceHistory",
}

local sessionId = os.date("%Y%m%d_%H%M%S")
local liveFile = string.format("%s/session_%s.ndjson", CONFIG.outDir, sessionId)
local seq = 0
local enumsWritten = false
local lastState = nil
local lastSignature = nil
local stableTicks = 0
local crumbsLeft = 0
local forceCrumbs = false
local lastSlot = nil
local dumpRequested = false
local lastGlossary = {}
local glossaryFirst = true

local function log(msg) print("[CrustWatcher] " .. tostring(msg) .. "\n") end
local function crumb(what) if forceCrumbs or crumbsLeft > 0 then log("read " .. what) end end

------------------------------------------------------------------ JSON
local function jsonStr(s)
    return '"' .. s:gsub('[%c"\\]', function(c)
        if c == '"' then return '\\"' elseif c == '\\' then return '\\\\'
        elseif c == '\n' then return '\\n' elseif c == '\r' then return '\\r'
        elseif c == '\t' then return '\\t' end
        return string.format('\\u%04x', c:byte())
    end) .. '"'
end

local function toJson(v)
    local t = type(v)
    if t == "nil" then return "null"
    elseif t == "boolean" then return tostring(v)
    elseif t == "number" then
        if v ~= v or v == math.huge or v == -math.huge then return "null" end
        if math.type and math.type(v) == "integer" then return tostring(v) end
        return string.format("%.6g", v)
    elseif t == "string" then return jsonStr(v)
    elseif t == "table" then
        if v.__array then
            local parts = {}
            for i = 1, #v do parts[i] = toJson(v[i]) end
            return "[" .. table.concat(parts, ",") .. "]"
        end
        local parts = {}
        for k, val in pairs(v) do
            if k ~= "__array" then parts[#parts + 1] = jsonStr(tostring(k)) .. ":" .. toJson(val) end
        end
        return "{" .. table.concat(parts, ",") .. "}"
    end
    return jsonStr(tostring(v))
end

------------------------------------------------------------------ reflection
-- Blueprint struct fields look like "SupplyAmount_2_304188684018F077F1561687AFD06456"
local function cleanName(n) return (n:gsub("_%d+_%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x$", "")) end

local function try(f, ...) local ok, r = pcall(f, ...); if ok then return r end end

local function propTypeName(prop)
    return try(function() return prop:GetClass():GetFName():ToString() end) or "?"
end

local STOP_CLASSES = { Object = true, Actor = true, ActorComponent = true, SceneComponent = true, Info = true }

-- Collect {prop, name, type} for a class (walking supers) or a script struct
local function collectProps(structLike, walkSupers)
    local out, cur = {}, structLike
    while cur and try(function() return cur:IsValid() end) do
        local cname = try(function() return cur:GetFName():ToString() end) or ""
        if walkSupers and STOP_CLASSES[cname] then break end
        try(function()
            cur:ForEachProperty(function(prop)
                local n = prop:GetFName():ToString()
                local ptype = propTypeName(prop)
                if not CONFIG.skipProps[n] and not ptype:find("Delegate") then
                    out[#out + 1] = { prop = prop, name = n, type = ptype }
                end
            end)
        end)
        if not walkSupers then break end
        cur = try(function() return cur:GetSuperStruct() end)
    end
    return out
end

local function propsByName(obj)
    local m = {}
    for _, p in ipairs(collectProps(obj:GetClass(), true)) do m[p.name] = p end
    return m
end

local serValue -- forward

local function serStruct(sv, structDef, depth)
    local o = {}
    for _, p in ipairs(collectProps(structDef, false)) do
        o[cleanName(p.name)] = serValue(try(function() return sv[p.name] end), p.prop, p.type, depth + 1)
    end
    return o
end

local function serObjectShallow(obj)
    return try(function() return obj:IsValid() and obj:GetFullName() or nil end)
end

-- A struct handed to us without its property (map keys/values) can name its definition — but only
-- when it is mapped to a property: UE4SS's GetProperty() wraps a null pointer otherwise.
local function structDefOf(v)
    if try(function() return v:IsMappedToProperty() end) ~= true then return nil end
    return try(function() return v:GetProperty():GetStruct() end)
end

-- Best-effort for values whose property type we don't have (map entries, untyped arrays)
local function serLoose(v, depth)
    if type(v) ~= "userdata" then return v end
    if depth > CONFIG.maxDepth then return "<depth>" end
    local def = structDefOf(v)
    if def then return serStruct(v, def, depth) end
    local s = try(function() return v:ToString() end)
    if type(s) == "string" then return s end
    local n = try(function() return v:GetArrayNum() end)
    if n then
        local arr = { __array = true }
        try(function()
            v:ForEach(function(i, e)
                if #arr >= CONFIG.maxArray then return true end
                arr[#arr + 1] = serLoose(e:get(), depth + 1)
            end)
        end)
        return arr
    end
    return serObjectShallow(v) or tostring(v)
end

serValue = function(v, prop, ptype, depth)
    if v == nil then return nil end
    if depth > CONFIG.maxDepth then return "<depth>" end
    if type(v) ~= "userdata" then return v end

    if ptype == "StrProperty" or ptype == "NameProperty" or ptype == "TextProperty" then
        return try(function() return v:ToString() end)
    elseif ptype == "StructProperty" then
        local def = try(function() return prop:GetStruct() end) or structDefOf(v)
        if def then return serStruct(v, def, depth) end
    elseif ptype == "ArrayProperty" then
        local inner = try(function() return prop:GetInner() end)
        local itype = inner and propTypeName(inner)
        local arr = { __array = true }
        local total = try(function() return v:GetArrayNum() end) or 0
        try(function()
            v:ForEach(function(i, e)
                if #arr >= CONFIG.maxArray then return true end
                arr[#arr + 1] = serValue(e:get(), inner, itype, depth + 1)
            end)
        end)
        if total > CONFIG.maxArray then return { __truncated = total, items = arr } end
        return arr
    elseif ptype == "MapProperty" then
        -- Struct keys (e.g. the market's Lot) can't be JSON object keys: emit [{key, value}] instead
        local entries, structKeys = { __array = true }, false
        try(function()
            v:ForEach(function(k, val)
                local key = serLoose(k:get(), depth + 1)
                if type(key) == "table" then structKeys = true end
                entries[#entries + 1] = { key = key, value = serLoose(val:get(), depth + 1) }
            end)
        end)
        if structKeys then return entries end
        local m = {}
        for _, e in ipairs(entries) do m[tostring(e.key)] = e.value end
        return m
    elseif ptype == "ObjectProperty" or ptype == "WeakObjectProperty" or ptype == "SoftObjectProperty" then
        -- Referenced objects are only ever named: deep-reading Float_GlossaryProperty_C crashed natively
        return serObjectShallow(v)
    end
    return serLoose(v, depth)
end

local function serObjectDeep(obj, depth)
    if not try(function() return obj:IsValid() end) then return nil end
    local o = { __class = try(function() return obj:GetClass():GetFName():ToString() end),
                __name = try(function() return obj:GetFName():ToString() end) }
    for _, p in ipairs(collectProps(obj:GetClass(), true)) do
        if depth == 0 then crumb("  ." .. p.name) end
        o[cleanName(p.name)] = serValue(try(function() return obj[p.name] end), p.prop, p.type, depth + 1)
    end
    return o
end

------------------------------------------------------------------ game readers
local function valid(obj) return obj ~= nil and try(function() return obj:IsValid() end) == true end

local function readFields(obj, fields, depth, label)
    local props, out = propsByName(obj), {}
    for _, f in ipairs(fields) do
        local p = props[f]
        if p then
            crumb((label or "?") .. "." .. f)
            out[cleanName(f)] = serValue(try(function() return obj[f] end), p.prop, p.type, depth)
        end
    end
    return out
end

-- FDateTime has no reflected fields; the engine's own math library can break it apart.
-- The class default object is looked up each read rather than cached across ticks.
local function readDateTime(dt)
    local kml = StaticFindObject("/Script/Engine.Default__KismetMathLibrary")
    if not valid(kml) or dt == nil then return nil end
    local t = {}
    for _, part in ipairs({ "Year", "Month", "Day", "Hour", "Minute" }) do
        t[part:lower()] = try(function() return kml["Get" .. part](kml, dt) end)
    end
    return next(t) and t or nil
end

local function marketInstances(mm)
    local list = {}
    -- The native MarketInstances array is empty in practice; the Blueprint's "Market Instances" holds them
    for _, propName in ipairs({ "Market Instances", "MarketInstances" }) do
        local arr = try(function() return mm[propName] end)
        if arr then
            try(function()
                arr:ForEach(function(i, e)
                    local inst = e:get()
                    if valid(inst) then list[#list + 1] = inst end
                end)
            end)
        end
        if #list > 0 then break end
    end
    return list
end

-- Cheap, shallow identity of the objects we read; any change means a load/transition is in progress
local function presenceSignature()
    local parts = {}
    for _, cls in ipairs({ "MarketManager", "StatisticsAndMonitoringBase", "TheCrustGameModeBase" }) do
        local o = FindFirstOf(cls)
        parts[#parts + 1] = valid(o) and (try(function() return o:GetFName():ToString() end) or "?") or "-"
    end
    local mm = FindFirstOf("MarketManager")
    parts[#parts + 1] = valid(mm) and tostring(#marketInstances(mm)) or "0"
    return table.concat(parts, "|")
end

local function snapshot(full)
    local data = {}

    local mm = FindFirstOf("MarketManager")
    if valid(mm) then
        local markets = { __array = true }
        for _, inst in ipairs(marketInstances(mm)) do
            local m = readFields(inst, MARKET_DYNAMIC_FIELDS, 1, "market")
            m.__name = try(function() return inst:GetFName():ToString() end)
            if full then
                for k, v in pairs(readFields(inst, MARKET_FULL_FIELDS, 1, "market")) do m[k] = v end
            end
            markets[#markets + 1] = m
        end
        data.markets = markets
    end

    local stats = FindFirstOf("StatisticsAndMonitoringBase")
    if valid(stats) then
        if full then data.stats = readFields(stats, { "ModuleCounts" }, 1, "stats") end
        -- Credits live in a Float_GlossaryProperty_C; read its two float fields directly (never deep-read it)
        local gp = try(function() return stats.CreditsCountGlosaryProperty end)
        if valid(gp) then
            crumb("stats.credits.FloatValue")
            data.credits = {
                value = try(function() return gp.FloatValue end),
                base = try(function() return gp.BaseValue end),
            }
        end
    end

    local gm = FindFirstOf("TheCrustGameModeBase")
    if valid(gm) then
        data.game = readFields(gm, { "GameSpeed", "GameSpeedState", "FastTime", "CreditsAtMonthStart", "GameSeedBase" }, 1, "game")
        crumb("game.InGameTime")
        data.game.inGameTime = readDateTime(try(function() return gm.InGameTime end))
    end

    return data
end

local function exportEnums()
    local out = {}
    for label, path in pairs(CONFIG.enums) do
        local e = StaticFindObject(path)
        if valid(e) then
            local names = {}
            try(function()
                e:ForEachName(function(name, value)
                    local s = try(function() return name:ToString() end) or tostring(name)
                    names[tostring(value)] = s
                end)
            end)
            if next(names) then out[label] = names end
        end
    end
    return next(out) and out or nil
end

------------------------------------------------------------------ output
local function appendLine(path, line)
    local f = io.open(path, "a")
    if not f then log("cannot open " .. path); return end
    f:write(line, "\n")
    f:close()
end

-- The game keeps many live values (credits among them) in "glossary" objects: Float_GlossaryProperty_C with
-- a Name, Category, "Full Address" and FloatValue. Export values that changed since the last export, using
-- scalar reads only (deep-reading these objects crashed in v1.1).
local function exportGlossary()
    if glossaryFirst then log("glossary export start") end
    local all = FindAllOf("Float_GlossaryProperty_C")
    if not all then return end
    local changed, total = { __array = true }, 0
    for _, gp in ipairs(all) do
        if total >= 5000 then break end
        if valid(gp) then
            total = total + 1
            local addr = try(function() return gp["Full Address"]:ToString() end)
            if addr and addr ~= "" then
                local value = try(function() return gp.FloatValue end)
                local stored = value == nil and "nil" or value
                if lastGlossary[addr] ~= stored then
                    lastGlossary[addr] = stored
                    changed[#changed + 1] = {
                        a = addr,
                        n = try(function() return gp.Name:ToString() end),
                        c = try(function() return gp.Category:ToString() end),
                        v = value,
                    }
                end
            end
        end
    end
    if glossaryFirst then log("glossary export: " .. total .. " properties"); glossaryFirst = false end
    if #changed > 0 then
        appendLine(liveFile, toJson({ type = "glossary", t = os.time(), count = total, entries = changed }))
    end
end

local function writeDump()
    local path = string.format("%s/dump_%s.json", CONFIG.outDir, os.date("%Y%m%d_%H%M%S"))
    forceCrumbs = true -- a dump is rare and touches everything: always leave a trail
    local out = { enums = exportEnums() }
    for _, cls in ipairs(CONFIG.dumpRoots) do
        local all = FindAllOf(cls)
        local list = { __array = true }
        if all then
            for i, obj in ipairs(all) do
                if i > 8 then break end
                crumb("dump " .. cls .. "[" .. i .. "]")
                local schema = {}
                for _, p in ipairs(collectProps(obj:GetClass(), true)) do schema[p.name] = p.type end
                list[#list + 1] = { schema = schema, value = serObjectDeep(obj, 0) }
            end
        end
        out[cls] = list
    end
    forceCrumbs = false
    local f = io.open(path, "w")
    if f then f:write(toJson(out)); f:close(); log("dump written: " .. path) end
end

------------------------------------------------------------------ main (game thread only)
local function tick()
    if dumpRequested then
        dumpRequested = false
        local okd, errd = pcall(writeDump)
        forceCrumbs = false
        if not okd then log("dump error: " .. tostring(errd)) end
    end

    local signature = presenceSignature()
    if signature ~= lastSignature then
        log("objects changed: " .. signature .. " (settling)")
        lastSignature = signature
        stableTicks = 0
        crumbsLeft = CONFIG.crumbReads
        return
    end
    stableTicks = stableTicks + 1
    if stableTicks < CONFIG.settleTicks then return end

    local full = (seq % CONFIG.historyEvery) == 0
    if crumbsLeft > 0 then log("deep read start (signature " .. signature .. ")") end
    local data = snapshot(full)
    if crumbsLeft > 0 then log("deep read ok"); crumbsLeft = crumbsLeft - 1 end

    local state = data.markets and #data.markets > 0 and "market" or (next(data) and "partial" or "none")
    if state ~= lastState then log("state: " .. state); lastState = state end
    if state == "none" then return end

    if not enumsWritten then
        local enums = exportEnums()
        if enums then
            appendLine(liveFile, toJson({ type = "enums", t = os.time(), enums = enums }))
            enumsWritten = true
        end
    end

    -- Which save is loaded (ties the live session to a dashboard profile) + the game's display names
    local gi = FindFirstOf("CrustGameInstance_C")
    if valid(gi) then
        local slot = try(function() return gi.ScopeSlotNameLoad:ToString() end)
        if slot and slot ~= "" and slot ~= lastSlot then
            crumb("gameInstance.Resource Name Map")
            local p = propsByName(gi)["Resource Name Map"]
            local names = p and serValue(try(function() return gi["Resource Name Map"] end), p.prop, p.type, 1) or nil
            appendLine(liveFile, toJson({ type = "session_info", t = os.time(), slot = slot, resourceDisplayNames = names }))
            log("loaded save: " .. slot)
            lastSlot = slot
        end
    end

    seq = seq + 1
    appendLine(liveFile, toJson({ type = "snapshot", seq = seq, t = os.time(), full = full, history = full, data = data }))

    if full then
        local okg, errg = pcall(exportGlossary)
        if not okg then log("glossary error: " .. tostring(errg)) end
    end
end

os.execute('mkdir "' .. CONFIG.outDir:gsub("/", "\\") .. '" 2>nul')
appendLine(liveFile, toJson({ type = "session_start", session = sessionId, t = os.time(), version = "2.2" }))
log("v2.2 session " .. sessionId .. " -> " .. liveFile .. (SETTINGS.debug and " (debug)" or ""))

-- Start the dashboard with the game. The launcher returns straight away if the dashboard is already running.
if SETTINGS.launcher and SETTINGS.startWithGame ~= false then
    local command = string.format('start "" powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%s" -FromGame',
        (SETTINGS.launcher:gsub("/", "\\")))
    local ok, err = pcall(os.execute, command)
    log(ok and "dashboard launcher started" or ("dashboard launcher failed: " .. tostring(err)))
end

if type(LoopInGameThreadWithDelay) ~= "function" then
    -- No async fallback on purpose: LoopAsync + ExecuteInGameThread is what crashed the game
    log("ERROR: this UE4SS build has no LoopInGameThreadWithDelay; watcher disabled")
else
    LoopInGameThreadWithDelay(CONFIG.pollMs, function()
        local ok, err = pcall(tick)
        if not ok then log("tick error: " .. tostring(err)) end
        return false -- keep looping
    end)
end

-- Keybind callbacks don't run on the game thread: only set a flag; the next tick writes the dump
RegisterKeyBind(Key.F8, function()
    dumpRequested = true
    log("dump requested")
end)
