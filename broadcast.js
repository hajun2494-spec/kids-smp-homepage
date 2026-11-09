(function () {
  "use strict";
  const TILE_SIZE = 512;
  const FRESH_MS = 25000;
  const WORLD_LABELS = { overworld: "오버월드", the_nether: "네더", the_end: "엔드" };
  const SCENES = ["map", "players", "video", "uptime"];
  const PALETTE = ["#d0eab2", "#eecb8b", "#b3d9dc", "#d3c3e4", "#e8bbb3"];
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const integer = (value, limit = 30000000) => Number.isInteger(value) && Math.abs(value) <= limit;
  const label = (value, max = 80) => typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
  const timestamp = (value) => value === null || (typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value)));
  const onlyKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key));

  function freshAt(updatedAt, receivedAt, now = Date.now(), limit = FRESH_MS) {
    if (!updatedAt || !receivedAt) return false;
    const updated = Date.parse(updatedAt), received = Date.parse(receivedAt);
    return Number.isFinite(updated) && Number.isFinite(received) && updated <= now + 60000 && received <= now + 60000 && Math.max(0, now - updated, now - received) <= limit;
  }

  function validateStatus(raw) {
    if (!raw || raw.source !== "pc-push" || !["online", "offline", "unknown", "stale"].includes(raw.state)
      || !raw.players || !integer(raw.players.max, 10000) || raw.players.max < 1 || !Array.isArray(raw.players.list)
      || raw.players.list.length > 1000 || !timestamp(raw.updated_at) || !timestamp(raw.received_at)) throw new Error("invalid_status");
    const seen = new Set();
    const names = raw.players.list.map((entry) => {
      if (!entry || !label(entry.name, 64) || seen.has(entry.name.toLowerCase())) throw new Error("invalid_player");
      seen.add(entry.name.toLowerCase()); return entry.name;
    });
    if (raw.state === "online" && (!integer(raw.players.online, 10000) || raw.players.online < 0
      || raw.players.online > raw.players.max || raw.players.online !== names.length)) throw new Error("invalid_count");
    return { state: raw.state, count: raw.players.online, max: raw.players.max, names, updatedAt: raw.updated_at, receivedAt: raw.received_at };
  }

  function currentStatus(status, failed, now = Date.now()) {
    if (failed || !status) return { state: failed ? "error" : "unknown", count: null, names: [] };
    if (status.state === "offline") return { state: "offline", count: 0, names: [] };
    if (status.state === "online" && freshAt(status.updatedAt, status.receivedAt, now)) return { state: "online", count: status.count, names: status.names };
    return { state: status.state === "unknown" ? "unknown" : "stale", count: null, names: [] };
  }

  function validateChunkPlayers(raw) {
    if (!onlyKeys(raw, ["version", "server", "source", "state", "precision", "chunk_size", "updated_at", "received_at", "update_interval_seconds", "players"])
      || raw.version !== 1 || raw.precision !== "chunk" || raw.chunk_size !== 16
      || !["live", "stale", "pending", "offline", "unknown"].includes(raw.state)
      || !timestamp(raw.updated_at) || !timestamp(raw.received_at) || !Array.isArray(raw.players) || raw.players.length > 1000) throw new Error("invalid_chunk_feed");
    const names = new Set();
    const players = raw.players.map((entry) => {
      if (!onlyKeys(entry, ["name", "world", "chunkX", "chunkZ"]) || !label(entry.name, 64) || names.has(entry.name.toLowerCase())
        || !Object.hasOwn(WORLD_LABELS, entry.world) || !integer(entry.chunkX, 1875000) || !integer(entry.chunkZ, 1875000)) throw new Error("invalid_chunk_player");
      names.add(entry.name.toLowerCase()); return { name: entry.name, world: entry.world, chunkX: entry.chunkX, chunkZ: entry.chunkZ };
    });
    if (raw.state !== "live" && players.length) throw new Error("stale_chunk_players");
    return { state: raw.state, updatedAt: raw.updated_at, receivedAt: raw.received_at, players };
  }

  function liveChunkPlayers(feed, failed = false, now = Date.now()) {
    return !failed && feed && feed.state === "live" && freshAt(feed.updatedAt, feed.receivedAt, now) ? feed.players : [];
  }

  function validateMap(raw, endpoint) {
    if (!raw || raw.version !== 1 || raw.player_locations !== false || !["live", "stale", "pending"].includes(raw.state)
      || !timestamp(raw.updated_at) || !timestamp(raw.received_at) || !Array.isArray(raw.worlds) || raw.worlds.length > 3
      || !Array.isArray(raw.towns) || raw.towns.length > 1024 || !raw.terrain || raw.terrain.source !== "saved-world"
      || raw.terrain.tile_size !== TILE_SIZE || raw.terrain.blocks_per_pixel !== 1 || !timestamp(raw.terrain.updated_at)) throw new Error("invalid_map");
    const origin = new URL(endpoint).origin, seenWorlds = new Set();
    const worlds = raw.worlds.map((world) => {
      if (!world || !Object.hasOwn(WORLD_LABELS, world.id) || seenWorlds.has(world.id) || !label(world.label)
        || !Array.isArray(world.tiles) || world.tiles.length > 1024) throw new Error("invalid_world");
      seenWorlds.add(world.id); const seenTiles = new Set();
      const tiles = world.tiles.map((tile) => {
        if (!tile || !integer(tile.regionX, 58593) || !integer(tile.regionZ, 58593) || !/^[a-f0-9]{64}$/.test(tile.sha256) || !timestamp(tile.updatedAt) || typeof tile.url !== "string") throw new Error("invalid_tile");
        const key = `${tile.regionX},${tile.regionZ}`, url = new URL(tile.url, origin);
        const path = `/api/map/tiles/${world.id}/${tile.regionX}/${tile.regionZ}/${tile.sha256}.png`;
        if (seenTiles.has(key) || url.origin !== origin || url.pathname !== path || url.search || url.hash || url.username || url.password) throw new Error("invalid_tile_url");
        seenTiles.add(key); return { regionX: tile.regionX, regionZ: tile.regionZ, url: url.href };
      });
      return { id: world.id, label: world.label, tiles };
    });
    if (worlds.reduce((sum, world) => sum + world.tiles.length, 0) > 2048) throw new Error("too_many_tiles");
    const seenTowns = new Set();
    const towns = raw.towns.map((town) => {
      if (!town || !label(town.id) || seenTowns.has(town.id) || !label(town.name) || !seenWorlds.has(town.world)
        || ![town.minX, town.maxX, town.minZ, town.maxZ].every((value) => integer(value)) || town.minX > town.maxX || town.minZ > town.maxZ) throw new Error("invalid_town");
      seenTowns.add(town.id); return { id: town.id, name: town.name, world: town.world, minX: town.minX, maxX: town.maxX, minZ: town.minZ, maxZ: town.maxZ };
    });
    return { state: raw.state, updatedAt: raw.updated_at, receivedAt: raw.received_at, terrainUpdatedAt: raw.terrain.updated_at, worlds, towns };
  }

  function mapState(data, failed, now = Date.now()) {
    if (failed) return "error";
    if (!data || data.state === "pending") return "pending";
    return data.state === "live" && freshAt(data.updatedAt, data.receivedAt, now) ? "live" : "stale";
  }

  function rosterPage(names, offset, pageSize) {
    const size = Math.max(1, Math.floor(pageSize) || 18), pages = Math.max(1, Math.ceil(names.length / size));
    const page = Math.floor(Math.max(0, offset) / size) % pages;
    return { names: names.slice(page * size, (page + 1) * size), offset: page * size, page: page + 1, pages };
  }

  const pure = { freshAt, validateStatus, currentStatus, validateChunkPlayers, liveChunkPlayers, validateMap, mapState, rosterPage };
  if (typeof module !== "undefined" && module.exports) module.exports = pure;
  if (typeof document === "undefined") return;

  const $ = (id) => document.getElementById(id);
  if (!$("broadcast-shell")) return;
  const cfg = window.EVERGREEN_BROADCAST || {};
  const backgroundMusic = $("background-music");
  if (backgroundMusic) {
    backgroundMusic.loop = true;
    backgroundMusic.volume = Number.isFinite(Number(cfg.musicVolume)) ? clamp(Number(cfg.musicVolume), 0, 1) : .38;
    if (typeof cfg.musicSrc === "string" && cfg.musicSrc.trim()) {
      try { const musicUrl = new URL(cfg.musicSrc, window.location.href); if (["https:", "http:"].includes(musicUrl.protocol)) backgroundMusic.src = musicUrl.href; } catch { /* Use the bundled full song. */ }
    }
    const playBackgroundMusic = () => { if (backgroundMusic.paused) backgroundMusic.play()?.catch(() => {}); };
    playBackgroundMusic();
    window.addEventListener("load", playBackgroundMusic, { once: true });
    document.addEventListener("pointerdown", playBackgroundMusic, { capture: true, passive: true });
    document.addEventListener("keydown", playBackgroundMusic, { capture: true });
  }
  const duration = Object.fromEntries(SCENES.map((name) => [name, clamp(Number(cfg.durations?.[name]) || ({ map: 24000, players: 16000, video: 36000, uptime: 16000 })[name], 5000, 600000)]));
  let apiOrigin;
  try { const url = new URL(cfg.apiOrigin || "https://evergreen-smp-presence.chloekang.chatgpt.site"); if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error(); apiOrigin = url.origin; }
  catch { apiOrigin = "https://evergreen-smp-presence.chloekang.chatgpt.site"; }
  const endpoints = { status: `${apiOrigin}/api/status`, map: `${apiOrigin}/api/map`, positions: `${apiOrigin}/api/map/players` };
  const seoulClock = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const seoulDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });
  const openedAt = cfg.openedAt || "2026-10-10T07:42:55+09:00";
  const state = { scene: 0, elapsed: 0, paused: false, status: null, statusFailed: false, feed: null, feedFailed: false, map: null, mapFailed: false, rosterOffset: 0, rosterElapsed: 0, rosterKey: "", mapVisits: 1, focusIndex: 0, focusElapsed: 0, mapWorld: "overworld", mapSignature: "", videoLoaded: false, videoReady: false, videoPlaying: false, videoMuted: true, lastFrame: 0, stopped: false };
  const pending = new Set(), controllers = new Set();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let wakeTimer, videoStartTimer, listeningTimer, clockSecond = "";

  try {
    const home = new URL(cfg.homepage || "/", window.location.href);
    if (["https:", "http:"].includes(home.protocol)) {
      document.querySelectorAll(".homepage-link").forEach((link) => { link.href = home.href; });
      $("homepage-address").textContent = `${home.hostname} ↗`;
    }
  } catch { /* The default homepage link remains usable. */ }
  try {
    const date = new Date(openedAt), day = seoulDate.format(date).replaceAll("-", ".");
    $("since-label").textContent = `SINCE ${day}`;
    $("opened-at").textContent = `${day} · ${seoulClock.format(date)} KST`;
  } catch { $("opened-at").textContent = "첫 정상 기동 시각을 확인 중이에요"; }

  function updateClock(now = Date.now()) {
    const second = Math.floor(now / 1000);
    if (second === clockSecond) return;
    clockSecond = second;
    $("seoul-clock").textContent = seoulClock.format(now);
    $("seoul-clock").dateTime = new Date(now).toISOString();
    const age = window.EvergreenBroadcastTime?.calendarElapsed(openedAt, now);
    for (const key of ["months", "days", "hours", "minutes", "seconds"]) $("elapsed-" + key).textContent = age ? String(age[key]).padStart(2, "0") : "—";
    renderStatus(); renderMapLabels();
  }

  function renderStatus() {
    const value = currentStatus(state.status, state.statusFailed), names = value.names;
    const labels = { online: "온라인", offline: "오프라인", unknown: "연결 확인 중", stale: "정보 갱신 대기", error: "연결 확인 중" };
    $("server-pill").dataset.state = value.state;
    $("server-state").textContent = labels[value.state];
    $("header-count").textContent = value.count === null ? "—" : String(value.count);
    $("player-count").textContent = value.count === null ? "—" : String(value.count);
    $("player-count").parentElement.dataset.digits = String(value.count === null ? 1 : String(value.count).length);
    const online = value.state === "online";
    $("players-message").textContent = online ? names.length ? "각자의 자리에서, 같은 세계를 함께 만들고 있어요." : "지금은 접속한 플레이어가 없어요. 첫 번째 발자국을 남겨 보세요." : value.state === "offline" ? "지금은 서버가 쉬어가는 시간이에요. 매일 07:00–23:00에 다시 만나요." : "새 접속 정보를 기다리고 있어요. 확인되면 자동으로 나타나요.";
    const updated = state.status?.updatedAt;
    $("status-updated").textContent = online && updated ? `접속 정보 ${seoulClock.format(new Date(updated))} KST` : value.state === "offline" ? "서버 오프라인 · 운영시간 07:00–23:00" : "접속 정보 갱신 대기";
    $("players-updated").textContent = online && updated ? `${seoulClock.format(new Date(updated))} 확인 · 약 5초마다 갱신` : "새 접속 정보를 기다리고 있어요";
    $("roster-empty").hidden = names.length > 0;
    $("roster-empty-title").textContent = value.state === "offline" ? "잠시 쉬어가는 에버그린." : online ? "새로운 발자국을 기다려요." : "오늘의 이웃들을 확인 중이에요.";
    $("roster-empty-text").textContent = value.state === "offline" ? "운영시간은 매일 07:00–23:00, 한국 시간이에요." : online ? "아직 접속한 플레이어가 없어요. 다음 모험의 주인공이 되어 주세요." : "정보가 오래되거나 연결이 끊기면 이전 접속자 이름을 표시하지 않아요.";
    renderRoster(names);
  }

  function pageSize() { return window.innerWidth <= 800 ? 6 : window.innerWidth <= 1150 ? 12 : 18; }
  function renderRoster(names = currentStatus(state.status, state.statusFailed).names) {
    const size = pageSize(), page = rosterPage(names, state.rosterOffset, size), key = JSON.stringify(page.names) + `:${page.page}:${size}`;
    state.rosterOffset = page.offset;
    $("roster-pagination").textContent = page.pages > 1 ? `${page.page} / ${page.pages} PAGES` : "EVERGREEN COMMUNITY";
    if (state.rosterKey === key) return;
    state.rosterKey = key;
    const grid = $("player-grid"); grid.dataset.size = page.names.length > 6 ? "large" : "small";
    grid.style.gridTemplateColumns = `repeat(${page.names.length > 6 ? window.innerWidth <= 800 ? 3 : window.innerWidth <= 1150 ? 4 : 6 : 3},minmax(0,1fr))`;
    const fragment = document.createDocumentFragment();
    page.names.forEach((name, index) => {
      const card = document.createElement("li"), number = document.createElement("span"), image = document.createElement("img"), text = document.createElement("span"), note = document.createElement("small");
      card.className = "player-card"; number.className = "card-number"; number.textContent = String(page.offset + index + 1).padStart(2, "0");
      image.width = 80; image.height = 80; image.alt = ""; image.referrerPolicy = "no-referrer"; image.decoding = "async";
      image.addEventListener("error", () => { image.src = "player-avatar-fallback.svg"; }, { once: true });
      const skinName = name.startsWith(".") ? name.replaceAll("_", " ") : name;
      image.src = `https://api.mcheads.org/head/${encodeURIComponent(skinName)}/96/hat`;
      text.className = "player-name"; text.textContent = name; text.title = name; note.textContent = "EXPLORING EVERGREEN";
      card.append(number, image, text, note); fragment.append(card);
    });
    grid.replaceChildren(fragment);
  }

  async function poll(kind) {
    if (pending.has(kind) || state.stopped || document.hidden) return;
    pending.add(kind); const controller = new AbortController(); controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(endpoints[kind], { cache: "no-store", credentials: "omit", mode: "cors", headers: { Accept: "application/json" }, signal: controller.signal });
      if (!response.ok) throw new Error("unavailable");
      const body = await response.text(); if (body.length > (kind === "map" ? 3000000 : 256000)) throw new Error("oversized");
      const raw = JSON.parse(body);
      if (kind === "status") { state.status = validateStatus(raw); state.statusFailed = false; renderStatus(); }
      else if (kind === "positions") { state.feed = validateChunkPlayers(raw); state.feedFailed = false; renderMapLabels(); }
      else {
        state.map = validateMap(raw, endpoints.map); state.mapFailed = false;
        const signature = JSON.stringify(state.map.worlds.map((world) => [world.id, world.tiles.length])) + JSON.stringify(state.map.towns);
        renderWorlds();
        if (signature !== state.mapSignature) { state.mapSignature = signature; focusMap(true); }
        renderMapLabels(); pruneTiles();
      }
    } catch {
      if (state.stopped || document.hidden) return;
      if (kind === "status") { state.statusFailed = true; renderStatus(); }
      else if (kind === "positions") { state.feedFailed = true; state.feed = null; renderMapLabels(); }
      else { state.mapFailed = true; renderMapLabels(); }
    } finally { clearTimeout(timer); pending.delete(kind); controllers.delete(controller); }
  }

  const canvas = $("broadcast-map"), ctx = canvas.getContext("2d", { alpha: false });
  const view = { x: 0, z: 0, scale: 1, width: 1, height: 1 }, target = { x: 0, z: 0, scale: 1 };
  const tiles = new Map(); let activeTiles = 0, tileFailures = 0;
  const currentWorld = () => state.map?.worlds.find((world) => world.id === state.mapWorld);
  const currentTowns = () => state.map?.towns.filter((town) => town.world === state.mapWorld) || [];
  const point = (x, z) => ({ x: (x - view.x) * view.scale + view.width / 2, y: (z - view.z) * view.scale + view.height / 2 });
  function renderWorlds() {
    const worlds = state.map?.worlds || [];
    if (!worlds.length) {
      const select = $("map-world");
      if (select.dataset.signature !== "pending") { const option = document.createElement("option"); option.value = "overworld"; option.textContent = "차원 연결 중"; select.replaceChildren(option); select.dataset.signature = "pending"; }
      select.disabled = true; return;
    }
    if (!worlds.some((world) => world.id === state.mapWorld)) state.mapWorld = worlds.find((world) => world.id === "overworld")?.id || worlds[0]?.id || "overworld";
    const select = $("map-world"), signature = worlds.map((world) => world.id + world.label).join("|");
    if (select.dataset.signature !== signature) {
      select.dataset.signature = signature; select.replaceChildren(...worlds.map((world) => { const option = document.createElement("option"); option.value = world.id; option.textContent = world.label; return option; }));
    }
    select.value = state.mapWorld; select.disabled = worlds.length < 2;
  }

  function focusMap(instant = false) {
    const world = currentWorld(); if (!world) return;
    const towns = currentTowns().sort((a, b) => (b.maxX - b.minX + 1) * (b.maxZ - b.minZ + 1) - (a.maxX - a.minX + 1) * (a.maxZ - a.minZ + 1));
    const town = towns.length ? towns[state.focusIndex % towns.length] : null;
    let minX, maxX, minZ, maxZ;
    if (town) { ({ minX, maxX, minZ, maxZ } = town); }
    else if (world.tiles.length) {
      const ordered = [...world.tiles].sort((a, b) => Math.abs(a.regionX) + Math.abs(a.regionZ) - Math.abs(b.regionX) - Math.abs(b.regionZ));
      const focus = ordered[(state.focusIndex * 5) % Math.min(ordered.length, 30)];
      minX = focus.regionX * TILE_SIZE; maxX = minX + TILE_SIZE; minZ = focus.regionZ * TILE_SIZE; maxZ = minZ + TILE_SIZE;
    } else { minX = -512; maxX = 512; minZ = -512; maxZ = 512; }
    target.x = (minX + maxX) / 2; target.z = (minZ + maxZ) / 2;
    target.scale = clamp(Math.min(view.width / Math.max(900, maxX - minX + 400), view.height / Math.max(600, maxZ - minZ + 400)), .025, 6);
    if (instant || reducedMotion) Object.assign(view, target);
    $("map-focus-name").textContent = town ? town.name : world.label;
    $("map-detail").textContent = town ? `${world.label} · 공개된 마을 ${towns.length}곳 둘러보기` : `${world.label} · 저장된 세계의 풍경`;
  }

  function resizeMap() {
    const rect = canvas.getBoundingClientRect(); if (rect.width < 1 || rect.height < 1) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2); view.width = rect.width; view.height = rect.height;
    canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio);
    if (ctx) ctx.setTransform(ratio, 0, 0, ratio, 0, 0); focusMap(true);
  }

  function renderMapLabels() {
    const status = mapState(state.map, state.mapFailed), feedFresh = state.feed && state.feed.state === "live" && !state.feedFailed && freshAt(state.feed.updatedAt, state.feed.receivedAt);
    const badge = $("map-data-state"); badge.dataset.state = status;
    badge.textContent = { live: "지도 갱신 중", stale: "저장된 지도", pending: "지도 연결 중", error: state.map ? "지도 갱신 대기" : "지도 연결 대기" }[status];
    $("map-freshness").textContent = status === "live" ? "마을 정보 갱신 중 · 지형은 월드 저장 후 반영돼요." : state.map ? "최근 저장된 지도를 표시해요 · 새 지도 정보를 기다리고 있어요." : "지도 연결을 기다리고 있어요 · 잠시 후 자동으로 다시 확인해요.";
    $("position-freshness").textContent = feedFresh ? "플레이어는 16×16블록 단위로만 표시해요." : "새 위치 정보가 없어 플레이어 표시는 잠시 쉬어요.";
    const time = state.map?.terrainUpdatedAt;
    $("map-updated").textContent = tileFailures ? "일부 지형 연결 대기 · 자동 재시도 중" : time ? `지형 저장 ${seoulDate.format(new Date(time)).replaceAll("-", ".")} ${seoulClock.format(new Date(time))} KST` : "저장된 지형을 표시해요";
    const world = currentWorld(), hasContent = world && (world.tiles.length || currentTowns().length);
    $("map-message").hidden = !!hasContent && !!ctx;
    if (!ctx) { $("map-message-title").textContent = "지도를 표시할 수 없는 브라우저예요"; $("map-message-text").textContent = "최신 브라우저로 방송 화면을 열어 주세요."; }
    else if (state.mapFailed && !state.map) { $("map-message-title").textContent = "세계로 연결하는 중이에요"; $("map-message-text").textContent = "지도 정보를 받지 못했어요. 잠시 후 자동으로 다시 확인해요."; }
    else if (state.map && !hasContent) { $("map-message-title").textContent = "아직 공개된 지형이 없어요"; $("map-message-text").textContent = "월드의 지형이나 마을 정보가 준비되면 나타나요."; }
  }

  function tileRecord(tile) {
    if (!tiles.has(tile.url)) tiles.set(tile.url, { tile, state: "queued", image: null, visible: false, retryAt: 0 });
    return tiles.get(tile.url);
  }
  function loadTiles() {
    for (const [url, record] of tiles) {
      if (activeTiles >= 6) break;
      if (!record.visible || record.state !== "queued") continue;
      activeTiles++; record.state = "loading";
      const image = new Image(); image.decoding = "async"; let done = false;
      const timer = setTimeout(() => { finish(false); image.src = ""; }, 15000);
      function finish(ok) { if (done) return; done = true; clearTimeout(timer); activeTiles--; record.state = ok ? "loaded" : "error"; record.image = ok ? image : null; record.retryAt = Date.now() + 30000; }
      image.onload = () => finish(image.naturalWidth === TILE_SIZE && image.naturalHeight === TILE_SIZE); image.onerror = () => finish(false); image.src = url;
    }
  }
  function pruneTiles() {
    if (!state.map) return;
    const allowed = new Set(state.map.worlds.flatMap((world) => world.tiles.map((tile) => tile.url)));
    for (const [url, record] of tiles) if (!allowed.has(url) && record.state !== "loading") tiles.delete(url);
  }

  function drawMap(dt) {
    if (!ctx) return;
    const ease = reducedMotion ? 1 : 1 - Math.exp(-dt / 1000);
    for (const key of ["x", "z", "scale"]) view[key] += (target[key] - view[key]) * ease;
    const w = view.width, h = view.height;
    ctx.fillStyle = "#172c20"; ctx.fillRect(0, 0, w, h); ctx.imageSmoothingEnabled = false;
    const step = 128 * view.scale, offsetX = (w / 2 - view.x * view.scale) % step, offsetZ = (h / 2 - view.z * view.scale) % step;
    ctx.strokeStyle = "#d6e5bd08"; ctx.lineWidth = 1; ctx.beginPath();
    if (step >= 8) { for (let x = offsetX; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); } for (let z = offsetZ; z < h; z += step) { ctx.moveTo(0, z); ctx.lineTo(w, z); } } ctx.stroke();
    for (const record of tiles.values()) record.visible = false;
    tileFailures = 0;
    for (const tile of currentWorld()?.tiles || []) {
      const pos = point(tile.regionX * TILE_SIZE, tile.regionZ * TILE_SIZE), size = TILE_SIZE * view.scale;
      if (pos.x > w || pos.y > h || pos.x + size < 0 || pos.y + size < 0) continue;
      const record = tileRecord(tile); record.visible = true;
      if (record.state === "error") { tileFailures++; if (Date.now() >= record.retryAt) record.state = "queued"; }
      if (record.image) ctx.drawImage(record.image, pos.x, pos.y, size + .5, size + .5);
      else { ctx.fillStyle = "#233b2b"; ctx.fillRect(pos.x, pos.y, size, size); }
    }
    loadTiles();
    if (tiles.size > 96) for (const [url, record] of tiles) { if (tiles.size <= 96) break; if (!record.visible && record.state !== "loading") tiles.delete(url); }
    const towns = currentTowns();
    towns.forEach((town, index) => {
      const pos = point(town.minX, town.minZ), width = (town.maxX - town.minX + 1) * view.scale, height = (town.maxZ - town.minZ + 1) * view.scale, color = PALETTE[index % PALETTE.length];
      ctx.fillStyle = color + "20"; ctx.fillRect(pos.x, pos.y, width, height); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([7, 4]); ctx.strokeRect(pos.x, pos.y, width, height); ctx.setLineDash([]);
      const x = pos.x + width / 2, y = pos.y + height / 2;
      if (x > -100 && x < w + 100 && y > -30 && y < h + 30) {
        ctx.font = "18px EvergreenSproutPixel, 'Malgun Gothic', sans-serif"; const textWidth = ctx.measureText(town.name).width;
        ctx.fillStyle = "#1a3326ef"; ctx.fillRect(x - textWidth / 2 - 12, y - 18, textWidth + 24, 34);
        ctx.fillStyle = color; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(town.name, x, y); ctx.textBaseline = "alphabetic";
      }
    });
    // Only public 16×16 chunk rectangles are rendered. The marker is their centre,
    // never an exact player coordinate, altitude, or interpolated position.
    for (const player of liveChunkPlayers(state.feed, state.feedFailed).filter((entry) => entry.world === state.mapWorld)) {
      const pos = point(player.chunkX * 16, player.chunkZ * 16), size = 16 * view.scale;
      if (pos.x > w || pos.y > h || pos.x + size < 0 || pos.y + size < 0) continue;
      ctx.fillStyle = "#f5ce8750"; ctx.fillRect(pos.x, pos.y, size, size); ctx.strokeStyle = "#ffdc9c"; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); ctx.strokeRect(pos.x, pos.y, Math.max(size, 1), Math.max(size, 1)); ctx.setLineDash([]);
      const x = pos.x + size / 2; ctx.font = "12px EvergreenSproutPixel, 'Malgun Gothic', sans-serif"; ctx.textAlign = "center";
      const text = `${player.name} · 청크`, textWidth = ctx.measureText(text).width;
      ctx.fillStyle = "#193123ed"; ctx.fillRect(x - textWidth / 2 - 7, pos.y - 25, textWidth + 14, 20); ctx.fillStyle = "#ffdda6"; ctx.fillText(text, x, pos.y - 11);
    }
  }

  const videoId = /^[a-zA-Z0-9_-]{11}$/.test(cfg.promoVideoId) ? cfg.promoVideoId : "SWIzyoQxBkM";
  const iframe = $("promo-video"), youtubeOrigin = "https://www.youtube.com";
  $("youtube-link").href = `${youtubeOrigin}/watch?v=${videoId}`;
  function videoCommand(func, args = []) { if (func === "unMute") func = "mute"; if (state.videoLoaded) iframe.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args, id: "evergreen-promo" }), youtubeOrigin); }
  function listenToVideo() {
    if (!state.videoLoaded) return;
    iframe.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: "evergreen-promo", channel: "evergreen" }), youtubeOrigin);
    videoCommand("addEventListener", ["onStateChange"]); videoCommand("addEventListener", ["onError"]);
  }
  function prepareVideo() {
    if (!state.videoLoaded) {
      const url = new URL(`${youtubeOrigin}/embed/${videoId}`);
      Object.entries({ autoplay: "1", mute: "1", controls: "0", rel: "0", playsinline: "1", enablejsapi: "1", modestbranding: "1", disablekb: "1" }).forEach(([key, value]) => url.searchParams.set(key, value));
      if (["http:", "https:"].includes(window.location.protocol)) url.searchParams.set("origin", window.location.origin);
      iframe.src = url.href; state.videoLoaded = true;
    } else { videoCommand("seekTo", [0, true]); videoCommand(state.videoMuted ? "mute" : "unMute"); videoCommand(state.paused ? "pauseVideo" : "playVideo"); }
    clearInterval(listeningTimer); listenToVideo(); listeningTimer = setInterval(listenToVideo, 1500);
    clearTimeout(videoStartTimer); videoStartTimer = setTimeout(() => {
      if (SCENES[state.scene] === "video" && !state.videoPlaying) { $("video-play").hidden = false; $("video-state").textContent = "재생 버튼을 누르면 영상을 볼 수 있어요"; }
    }, 6500);
  }
  iframe.addEventListener("load", () => { listenToVideo(); if (SCENES[state.scene] === "video") { videoCommand(state.videoMuted ? "mute" : "unMute"); videoCommand(state.paused ? "pauseVideo" : "playVideo"); } });
  window.addEventListener("message", (event) => {
    if (event.origin !== youtubeOrigin || event.source !== iframe.contentWindow) return;
    let message; try { message = typeof event.data === "string" ? JSON.parse(event.data) : event.data; } catch { return; }
    if (!message || typeof message !== "object") return;
    if (message.event === "onReady") { state.videoReady = true; listenToVideo(); videoCommand("mute"); if (SCENES[state.scene] === "video") videoCommand(state.paused ? "pauseVideo" : "playVideo"); }
    const value = message.event === "onStateChange" ? message.info : message.event === "infoDelivery" ? message.info?.playerState : null;
    if (value === 1) {
      videoCommand("mute");
      state.videoPlaying = true; state.videoReady = true; $("video-poster").hidden = true; $("video-play").hidden = true; $("video-state").textContent = "공식 홍보 영상 재생 중";
      if (SCENES[state.scene] !== "video" || state.paused) videoCommand("pauseVideo");
    } else if (value === 2) { state.videoPlaying = false; $("video-state").textContent = state.paused ? "방송 일시 정지 중" : "영상 일시 정지"; }
    else if (value === 0 && SCENES[state.scene] === "video" && !state.paused) goScene(state.scene + 1);
    if (message.event === "onError") { $("video-play").hidden = false; $("video-state").textContent = "영상 연결 대기 · YouTube에서도 볼 수 있어요"; }
  });
  $("video-play").addEventListener("click", () => { videoCommand("playVideo"); if (state.paused) setPaused(false); $("video-play").hidden = true; });

  function goScene(index, manual = false) {
    const old = SCENES[state.scene]; state.scene = (index + SCENES.length) % SCENES.length; const name = SCENES[state.scene];
    if (old === "video" && name !== "video") { videoCommand("pauseVideo"); clearInterval(listeningTimer); clearTimeout(videoStartTimer); state.videoPlaying = false; }
    state.elapsed = 0; state.focusElapsed = 0;
    document.querySelectorAll(".scene").forEach((scene) => { const active = scene.dataset.scene === name; scene.hidden = !active; scene.classList.toggle("is-active", active); });
    document.querySelectorAll(".scene-tab").forEach((tab) => { const active = tab.dataset.go === name; tab.classList.toggle("is-active", active); if (active) tab.setAttribute("aria-current", "true"); else tab.removeAttribute("aria-current"); });
    if (name === "map") {
      const worlds = state.map?.worlds || [];
      if (worlds.length && old !== "map") { state.mapWorld = worlds[state.mapVisits % worlds.length].id; state.mapVisits++; }
      state.focusIndex = 0; renderWorlds(); resizeMap(); focusMap(true);
    }
    if (name === "players") { state.rosterElapsed = 0; renderRoster(); }
    if (name === "video") prepareVideo();
    if (manual) { wakeControls(); $("broadcast-announcement").textContent = $("scene-" + name).querySelector("h1").textContent; }
    renderProgress();
  }
  function renderProgress() {
    const total = duration[SCENES[state.scene]]; document.documentElement.style.setProperty("--scene-progress", String(clamp(state.elapsed / total, 0, 1)));
    $("scene-countdown").textContent = `${Math.max(0, Math.ceil((total - state.elapsed) / 1000))}s`;
  }
  function setPaused(value) {
    state.paused = value; $("pause-toggle").textContent = value ? "▶" : "Ⅱ"; $("pause-toggle").setAttribute("aria-pressed", String(value)); $("pause-toggle").setAttribute("aria-label", value ? "자동 순환 다시 시작" : "자동 순환 일시 정지");
    $("rotation-label").textContent = value ? "일시 정지" : "자동 순환"; $("rotation-dot").style.background = value ? "#b39c71" : "";
    if (SCENES[state.scene] === "video") videoCommand(value ? "pauseVideo" : "playVideo"); wakeControls();
  }
  async function toggleFullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { $("broadcast-announcement").textContent = "브라우저에서 전체 화면을 지원하지 않아요. 브라우저의 전체 화면 기능을 이용해 주세요."; }
    wakeControls();
  }
  function wakeControls() {
    document.body.classList.add("controls-awake"); clearTimeout(wakeTimer);
    wakeTimer = setTimeout(() => { if (!document.querySelector(".broadcast-controls:focus-within")) document.body.classList.remove("controls-awake"); }, 3000);
  }
  if (new URLSearchParams(window.location.search).get("controls") === "1") document.body.classList.add("show-controls");
  document.addEventListener("pointermove", wakeControls, { passive: true }); document.addEventListener("pointerdown", wakeControls, { passive: true }); document.addEventListener("focusin", wakeControls);
  $("previous-scene").addEventListener("click", () => goScene(state.scene - 1, true)); $("next-scene").addEventListener("click", () => goScene(state.scene + 1, true)); $("pause-toggle").addEventListener("click", () => setPaused(!state.paused)); $("fullscreen-toggle").addEventListener("click", toggleFullscreen);
  document.querySelectorAll(".scene-tab").forEach((tab) => tab.addEventListener("click", () => goScene(SCENES.indexOf(tab.dataset.go), true)));
  $("map-world").addEventListener("change", (event) => { state.mapWorld = event.target.value; state.focusIndex = 0; state.focusElapsed = 0; focusMap(false); });
  document.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.repeat || event.target.closest?.("input, textarea, select, button, [contenteditable='true'], iframe")) return;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") goScene(state.scene + 1, true);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") goScene(state.scene - 1, true);
    else if (event.key === " " || event.code === "Space") setPaused(!state.paused);
    else if (event.key.toLowerCase() === "f") toggleFullscreen(); else return; event.preventDefault();
  });
  document.addEventListener("fullscreenchange", () => { $("fullscreen-toggle").textContent = document.fullscreenElement ? "⊡" : "⛶"; $("fullscreen-toggle").setAttribute("aria-label", document.fullscreenElement ? "전체 화면 종료" : "전체 화면"); resizeMap(); });
  window.addEventListener("resize", () => { resizeMap(); state.rosterKey = ""; renderRoster(); });
  if (window.ResizeObserver) new ResizeObserver(resizeMap).observe($("map-frame"));
  document.addEventListener("visibilitychange", () => {
    state.lastFrame = 0;
    if (document.hidden) { controllers.forEach((controller) => controller.abort()); if (SCENES[state.scene] === "video") videoCommand("pauseVideo"); }
    else { poll("status"); poll("map"); poll("positions"); if (SCENES[state.scene] === "video" && !state.paused) videoCommand("playVideo"); }
  });
  window.addEventListener("pagehide", () => { state.stopped = true; controllers.forEach((controller) => controller.abort()); clearInterval(listeningTimer); });
  window.addEventListener("pageshow", () => { state.stopped = false; poll("status"); poll("map"); poll("positions"); });
  function frame(time) {
    const dt = state.lastFrame ? Math.min(time - state.lastFrame, 1000) : 0; state.lastFrame = time;
    if (!state.stopped && !document.hidden) {
      updateClock();
      if (!state.paused) {
        state.elapsed += dt;
        if (SCENES[state.scene] === "map") { state.focusElapsed += dt; if (state.focusElapsed >= 8000) { state.focusElapsed = 0; state.focusIndex++; focusMap(false); } }
        if (SCENES[state.scene] === "players") { state.rosterElapsed += dt; if (state.rosterElapsed >= 5000) { state.rosterElapsed = 0; state.rosterOffset += pageSize(); renderRoster(); } }
        if (state.elapsed >= duration[SCENES[state.scene]]) goScene(state.scene + 1);
      }
      if (SCENES[state.scene] === "map") drawMap(state.paused ? 0 : dt);
      renderProgress();
    }
    requestAnimationFrame(frame);
  }
  updateClock(); renderWorlds(); resizeMap(); renderMapLabels(); wakeControls();
  const requestedScene = new URLSearchParams(window.location.search).get("scene");
  if (SCENES.includes(requestedScene)) { state.mapVisits = requestedScene === "map" ? 1 : 0; goScene(SCENES.indexOf(requestedScene)); }
  poll("status"); poll("map"); poll("positions");
  setInterval(() => { poll("status"); poll("map"); poll("positions"); }, 5000);
  requestAnimationFrame(frame);
}());
