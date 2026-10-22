(function () {
  "use strict";
  const TILE_SIZE = 512;
  const WORLD_LIMIT = 30000000;
  const PALETTE = ["#63ddb4", "#ffc761", "#a6b6ff", "#f2a6bf", "#b8f246"];
  const integer = (value, limit = WORLD_LIMIT) => Number.isInteger(value) && Math.abs(value) <= limit;
  const timestamp = (value) => value === null || (typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value)));
  const label = (value, max = 80) => typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const WORLD_LABELS = { overworld: "오버월드", the_nether: "네더", the_end: "엔드" };
  const onlyKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key));

  function validateChunkPlayers(raw) {
    if (!onlyKeys(raw, ["version", "server", "source", "state", "precision", "chunk_size", "updated_at", "received_at", "update_interval_seconds", "players"])
      || raw.version !== 1 || raw.precision !== "chunk" || raw.chunk_size !== 16
      || !["live", "stale", "pending", "offline", "unknown"].includes(raw.state)
      || !timestamp(raw.updated_at) || !timestamp(raw.received_at) || !Array.isArray(raw.players) || raw.players.length > 1000)
      throw new Error("플레이어 위치 형식이 올바르지 않아요.");
    const names = new Set();
    const players = raw.players.map((player) => {
      if (!onlyKeys(player, ["name", "world", "chunkX", "chunkZ"]) || !label(player.name, 64) || names.has(player.name.toLowerCase())
        || !Object.hasOwn(WORLD_LABELS, player.world) || !integer(player.chunkX, 1875000) || !integer(player.chunkZ, 1875000))
        throw new Error("정확하지 않은 청크 위치예요.");
      names.add(player.name.toLowerCase());
      return { name: player.name, world: player.world, chunkX: player.chunkX, chunkZ: player.chunkZ };
    });
    if (raw.state !== "live" && players.length) throw new Error("오래된 플레이어 위치예요.");
    return { state: raw.state, updatedAt: raw.updated_at, receivedAt: raw.received_at, players };
  }

  function liveChunkPlayers(feed, now = Date.now()) {
    if (!feed || feed.state !== "live" || !feed.updatedAt || !feed.receivedAt) return [];
    const age = Math.max(0, now - Date.parse(feed.receivedAt), now - Date.parse(feed.updatedAt));
    return Number.isFinite(age) && age <= 25000 ? feed.players : [];
  }

  function chunkBounds(player) {
    return { minX: player.chunkX * 16, maxX: player.chunkX * 16 + 15, minZ: player.chunkZ * 16, maxZ: player.chunkZ * 16 + 15 };
  }

  function mapEndpoint(statusEndpoint) {
    const url = new URL(statusEndpoint);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) throw new Error("안전하지 않은 지도 주소예요.");
    url.pathname = "/api/map";
    url.search = "";
    url.hash = "";
    return url.href;
  }

  function validateMap(raw, endpoint) {
    if (!raw || raw.version !== 1 || raw.player_locations !== false || !["live", "stale", "pending"].includes(raw.state)) throw new Error("지도 응답 형식이 맞지 않아요.");
    if (!timestamp(raw.updated_at) || !timestamp(raw.received_at) || !Array.isArray(raw.worlds) || raw.worlds.length > 3 || !Array.isArray(raw.towns) || raw.towns.length > 1024) throw new Error("지도 정보가 올바르지 않아요.");
    if (!raw.terrain || raw.terrain.source !== "saved-world" || raw.terrain.tile_size !== TILE_SIZE || raw.terrain.blocks_per_pixel !== 1 || !timestamp(raw.terrain.updated_at)) throw new Error("지형 정보가 올바르지 않아요.");
    const origin = new URL(endpoint).origin;
    const worldIds = new Set();
    const worlds = raw.worlds.map((world) => {
      if (!world || !/^[a-z0-9_-]{1,40}$/.test(world.id) || worldIds.has(world.id) || !label(world.label) || !Array.isArray(world.tiles) || world.tiles.length > 64) throw new Error("차원 정보가 올바르지 않아요.");
      worldIds.add(world.id);
      const seen = new Set();
      const tiles = world.tiles.map((tile) => {
        if (!tile || !integer(tile.regionX, 58593) || !integer(tile.regionZ, 58593) || !/^[a-f0-9]{64}$/.test(tile.sha256) || !timestamp(tile.updatedAt)) throw new Error("지형 타일 정보가 올바르지 않아요.");
        const key = `${tile.regionX},${tile.regionZ}`;
        const path = `/api/map/tiles/${world.id}/${tile.regionX}/${tile.regionZ}/${tile.sha256}.png`;
        if (seen.has(key) || typeof tile.url !== "string") throw new Error("중복된 지형 타일이에요.");
        const url = new URL(tile.url, origin);
        if (url.origin !== origin || url.pathname !== path || url.search || url.hash || url.username || url.password) throw new Error("지형 타일 주소가 올바르지 않아요.");
        seen.add(key);
        return { regionX: tile.regionX, regionZ: tile.regionZ, sha256: tile.sha256, updatedAt: tile.updatedAt, url: url.href };
      });
      return { id: world.id, label: world.label, tiles };
    });
    if (worlds.reduce((total, world) => total + world.tiles.length, 0) > 64) throw new Error("지형 타일 수가 너무 많아요.");
    const townIds = new Set();
    const towns = raw.towns.map((town) => {
      if (!town || !label(town.id, 80) || townIds.has(town.id) || !label(town.name) || !worldIds.has(town.world) || ![town.minX, town.maxX, town.minZ, town.maxZ].every((x) => integer(x)) || town.minX > town.maxX || town.minZ > town.maxZ) throw new Error("마을 영역 정보가 올바르지 않아요.");
      townIds.add(town.id);
      return { id: town.id, name: town.name, world: town.world, minX: town.minX, maxX: town.maxX, minZ: town.minZ, maxZ: town.maxZ };
    });
    return { state: raw.state, updatedAt: raw.updated_at, receivedAt: raw.received_at, terrainUpdatedAt: raw.terrain.updated_at, worlds, towns };
  }

  function worldBounds(world, towns, preferTowns = true) {
    const areas = towns.filter((town) => town.world === world.id);
    if (!preferTowns || areas.length === 0) {
      for (const tile of world.tiles) areas.push({ minX: tile.regionX * TILE_SIZE, minZ: tile.regionZ * TILE_SIZE, maxX: (tile.regionX + 1) * TILE_SIZE - 1, maxZ: (tile.regionZ + 1) * TILE_SIZE - 1 });
    }
    if (areas.length === 0) return null;
    return { minX: Math.min(...areas.map((x) => x.minX)), maxX: Math.max(...areas.map((x) => x.maxX)), minZ: Math.min(...areas.map((x) => x.minZ)), maxZ: Math.max(...areas.map((x) => x.maxZ)) };
  }

  function viewToWorld(x, y, view) { return { x: view.x + (x - view.width / 2) / view.scale, z: view.z + (y - view.height / 2) / view.scale }; }
  function worldToView(x, z, view) { return { x: (x - view.x) * view.scale + view.width / 2, y: (z - view.z) * view.scale + view.height / 2 }; }
  function coordinateText(point) { return `X ${Math.floor(point.x)} · Z ${Math.floor(point.z)}`; }
  const pure = { mapEndpoint, validateMap, validateChunkPlayers, liveChunkPlayers, chunkBounds, worldBounds, viewToWorld, worldToView, coordinateText };
  if (typeof module !== "undefined" && module.exports) module.exports = pure;
  if (typeof document === "undefined") return;

  const $ = (id) => document.getElementById(id);
  const canvas = $("world-map");
  if (!canvas) return;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) { $("map-empty-title").textContent = "이 브라우저에서는 지도를 그릴 수 없어요."; return; }
  let endpoint;
  try { endpoint = mapEndpoint(window.EVERGREEN_PRESENCE?.endpoint || "https://evergreen-smp-presence.chloekang.chatgpt.site/api/status"); }
  catch (error) { $("map-empty-title").textContent = error.message; return; }
  const state = { data: null, playerFeed: null, playersFailed: false, playersBusy: false, world: "", selectedTown: "", pin: null, view: { x: 0, z: 0, width: 1, height: 1, scale: 1 }, fitPending: true, failed: false, fetchBusy: false, renderQueued: false, tileActive: 0, tiles: new Map(), pointers: new Map(), gesture: null };
  const announce = (message) => { $("map-announcement").textContent = message; };
  const livePlayers = () => state.playersFailed ? [] : liveChunkPlayers(state.playerFeed);
  const allWorlds = () => {
    const result = [...(state.data?.worlds || [])];
    for (const player of livePlayers()) if (!result.some((world) => world.id === player.world)) result.push({ id: player.world, label: WORLD_LABELS[player.world], tiles: [] });
    return result;
  };
  const currentWorld = () => allWorlds().find((world) => world.id === state.world);
  const currentTowns = () => state.data?.towns.filter((town) => town.world === state.world) || [];
  const townColor = (town) => PALETTE[state.data.towns.findIndex((entry) => entry.id === town.id) % PALETTE.length];
  const timeText = (iso) => iso ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }).format(new Date(iso)) : "아직 없음";

  function requestDraw() {
    if (!state.renderQueued) { state.renderQueued = true; requestAnimationFrame(() => { state.renderQueued = false; draw(); }); }
  }

  function clampView() {
    state.view.scale = clamp(state.view.scale, 0.025, 24);
    state.view.x = clamp(state.view.x, -WORLD_LIMIT, WORLD_LIMIT);
    state.view.z = clamp(state.view.z, -WORLD_LIMIT, WORLD_LIMIT);
  }

  function fit(bounds) {
    if (!bounds) return;
    const { view } = state;
    view.x = (bounds.minX + bounds.maxX + 1) / 2;
    view.z = (bounds.minZ + bounds.maxZ + 1) / 2;
    view.scale = Math.min(view.width / Math.max(150, bounds.maxX - bounds.minX + 80), view.height / Math.max(150, bounds.maxZ - bounds.minZ + 80));
    clampView(); requestDraw();
  }

  function fitAll() { const world = currentWorld(); if (world) fit(worldBounds(world, state.data.towns)); }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    state.view.width = rect.width; state.view.height = rect.height;
    canvas.width = Math.max(1, Math.round(rect.width * ratio)); canvas.height = Math.max(1, Math.round(rect.height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (state.fitPending && currentWorld()) { fitAll(); state.fitPending = false; }
    requestDraw();
  }

  function paintGrid() {
    const { view } = state;
    const step = Math.pow(2, Math.ceil(Math.log2(60 / view.scale)));
    const corner = viewToWorld(0, 0, view);
    ctx.strokeStyle = "#c5e5cf0b"; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = Math.floor(corner.x / step) * step; x <= corner.x + view.width / view.scale; x += step) { const sx = worldToView(x, 0, view).x; ctx.moveTo(sx, 0); ctx.lineTo(sx, view.height); }
    for (let z = Math.floor(corner.z / step) * step; z <= corner.z + view.height / view.scale; z += step) { const sy = worldToView(0, z, view).y; ctx.moveTo(0, sy); ctx.lineTo(view.width, sy); }
    ctx.stroke();
    const scaleStep = Math.pow(10, Math.floor(Math.log10(100 / view.scale)));
    const scaleBlocks = [1, 2, 5, 10].map((value) => value * scaleStep).find((value) => value * view.scale >= 60) || scaleStep;
    $("map-scale").style.width = `${Math.max(50, scaleBlocks * view.scale)}px`;
    $("map-scale").textContent = `${scaleBlocks.toLocaleString("ko-KR")} 블록`;
  }

  function loadTile(tile) {
    let record = state.tiles.get(tile.url);
    if (record) return record;
    record = { state: "queued", image: null, tile, retryAt: 0 }; state.tiles.set(tile.url, record);
    return record;
  }

  function pumpTiles() {
    for (const [url, record] of state.tiles) {
      if (state.tileActive >= 4) break;
      if (record.state !== "queued" || !record.visible) continue;
      state.tileActive++; record.state = "loading";
      const image = new Image(); image.decoding = "async";
      let settled = false;
      const timer = setTimeout(() => { finish(false); image.src = ""; }, 15000);
      function finish(success) {
        if (settled) return; settled = true; clearTimeout(timer);
        state.tileActive--; record.state = success ? "loaded" : "error"; record.image = success ? image : null; record.retryAt = Date.now() + 30000;
        requestDraw();
      }
      image.onload = () => finish(image.naturalWidth === TILE_SIZE && image.naturalHeight === TILE_SIZE);
      image.onerror = () => finish(false);
      image.src = url;
    }
  }

  function draw() {
    const { view } = state;
    ctx.fillStyle = "#091611"; ctx.fillRect(0, 0, view.width, view.height); paintGrid();
    for (const record of state.tiles.values()) record.visible = false;
    const world = currentWorld();
    let visibleTiles = 0, badTiles = 0;
    if (world) for (const tile of world.tiles) {
      const pos = worldToView(tile.regionX * TILE_SIZE, tile.regionZ * TILE_SIZE, view);
      const size = TILE_SIZE * view.scale;
      if (pos.x > view.width || pos.y > view.height || pos.x + size < 0 || pos.y + size < 0) continue;
      visibleTiles++;
      const record = loadTile(tile); record.visible = true;
      if (record.state === "error") { badTiles++; if (Date.now() >= record.retryAt) record.state = "queued"; }
      if (record.state === "loaded") { ctx.imageSmoothingEnabled = false; ctx.drawImage(record.image, pos.x, pos.y, size + 0.2, size + 0.2); }
      else { ctx.fillStyle = "#12261c99"; ctx.fillRect(pos.x, pos.y, size, size); if (size > 150) { ctx.fillStyle = "#abc0b480"; ctx.font = "11px sans-serif"; ctx.textAlign = "center"; ctx.fillText(record.state === "error" ? "지형을 불러오지 못했어요" : "지형 불러오는 중", pos.x + size / 2, pos.y + size / 2); } }
    }
    pumpTiles();
    for (const town of currentTowns()) {
      const pos = worldToView(town.minX, town.minZ, view);
      const width = (town.maxX - town.minX + 1) * view.scale, height = (town.maxZ - town.minZ + 1) * view.scale;
      const selected = town.id === state.selectedTown, color = townColor(town);
      ctx.fillStyle = `${color}${selected ? "35" : "20"}`; ctx.fillRect(pos.x, pos.y, width, height);
      ctx.strokeStyle = color; ctx.lineWidth = selected ? 3 : 1.5; ctx.setLineDash(selected ? [] : [6, 3]); ctx.strokeRect(pos.x, pos.y, width, height); ctx.setLineDash([]);
      const textX = pos.x + width / 2, textY = pos.y + height / 2;
      if (textX > -100 && textX < view.width + 100 && textY > -30 && textY < view.height + 30) {
        ctx.font = "bold 12px 'Malgun Gothic', sans-serif"; const textWidth = ctx.measureText(town.name).width;
        ctx.fillStyle = "#06110eea"; ctx.fillRect(textX - textWidth / 2 - 9, textY - 13, textWidth + 18, 25);
        ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = color; ctx.fillText(town.name, textX, textY); ctx.textBaseline = "alphabetic";
      }
    }
    // A whole 16×16 area is highlighted; its centre is a schematic marker, not
    // the person's precise position. Never interpolate or retain old movement.
    for (const player of livePlayers().filter((entry) => entry.world === state.world)) {
      const bounds = chunkBounds(player), pos = worldToView(bounds.minX, bounds.minZ, view), size = 16 * view.scale;
      if (pos.x > view.width || pos.y > view.height || pos.x + size < 0 || pos.y + size < 0) continue;
      ctx.fillStyle = "#ffc76155"; ctx.fillRect(pos.x, pos.y, size, size);
      ctx.strokeStyle = "#ffc761"; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.strokeRect(pos.x, pos.y, Math.max(1, size), Math.max(1, size)); ctx.setLineDash([]);
      const centre = worldToView(bounds.minX + 8, bounds.minZ + 8, view);
      ctx.beginPath(); ctx.arc(centre.x, centre.y, 4, 0, Math.PI * 2); ctx.fillStyle = "#ffc761"; ctx.fill();
      ctx.font = "bold 11px 'Malgun Gothic', sans-serif"; ctx.textAlign = "center";
      const text = `${player.name} · 1청크`, width = ctx.measureText(text).width;
      ctx.fillStyle = "#06110ef2"; ctx.fillRect(centre.x - width / 2 - 6, pos.y - 24, width + 12, 19);
      ctx.fillStyle = "#ffe0a3"; ctx.fillText(text, centre.x, pos.y - 10);
    }
    if (state.pin) {
      const pos = worldToView(state.pin.x + 0.5, state.pin.z + 0.5, view);
      ctx.lineWidth = 2; ctx.strokeStyle = "#f5f0df"; ctx.fillStyle = "#173f2c"; ctx.beginPath(); ctx.arc(pos.x, pos.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pos.x - 12, pos.y); ctx.lineTo(pos.x - 7, pos.y); ctx.moveTo(pos.x + 7, pos.y); ctx.lineTo(pos.x + 12, pos.y); ctx.moveTo(pos.x, pos.y - 12); ctx.lineTo(pos.x, pos.y - 7); ctx.moveTo(pos.x, pos.y + 7); ctx.lineTo(pos.x, pos.y + 12); ctx.stroke();
    }
    if (state.data && state.data.worlds.length) {
      const hasAnything = currentTowns().length > 0 || (world && world.tiles.length > 0) || livePlayers().some((player) => player.world === state.world);
      $("map-empty").hidden = hasAnything;
      if (!hasAnything) { $("map-empty-title").textContent = "아직 공개된 지도 영역이 없어요"; $("map-empty-text").textContent = "저장된 지형 또는 마을 정보가 도착하면 여기에 표시돼요."; }
      if (badTiles && badTiles === visibleTiles) $("terrain-updated").textContent = "지형 이미지를 불러오지 못했어요. 마을 영역과 좌표는 계속 확인할 수 있고, 잠시 후 자동으로 다시 불러와요.";
    }
    // Release tiles no longer listed in the snapshot. Hashed URLs remain stable between polls.
    if (state.data && state.tiles.size > 64) { const allowed = new Set(state.data.worlds.flatMap((entry) => entry.tiles.map((tile) => tile.url))); for (const [url, record] of state.tiles) if ((!allowed.has(url) || !record.visible) && record.state !== "loading") state.tiles.delete(url); }
  }

  function renderTownDetails() {
    const town = currentTowns().find((entry) => entry.id === state.selectedTown);
    $("selected-town").hidden = !town;
    if (!town) return;
    $("selected-town-title").textContent = town.name;
    $("town-northwest").textContent = `X ${town.minX} · Z ${town.minZ}`;
    $("town-southeast").textContent = `X ${town.maxX} · Z ${town.maxZ}`;
    $("town-area").textContent = `${(town.maxX - town.minX + 1).toLocaleString("ko-KR")} × ${(town.maxZ - town.minZ + 1).toLocaleString("ko-KR")} 블록`;
  }

  function selectTown(town) {
    state.selectedTown = town.id; fit(town); renderTownList();
    announce(`${town.name} 영역으로 이동했어요. 북서쪽 X ${town.minX}, Z ${town.minZ}. 남동쪽 X ${town.maxX}, Z ${town.maxZ}.`);
  }

  function renderTownList() {
    const list = $("town-list"), towns = currentTowns();
    const focusedTownId = list.contains(document.activeElement) ? document.activeElement.dataset.townId : null;
    list.replaceChildren(); $("town-count").textContent = String(towns.length);
    if (!towns.length) { const item = document.createElement("li"); item.className = "town-empty"; item.textContent = "이 차원에는 등록된 마을이 없어요."; list.append(item); }
    for (const town of towns) {
      const item = document.createElement("li"), button = document.createElement("button"), dot = document.createElement("span"), name = document.createElement("span"), strong = document.createElement("strong"), small = document.createElement("small"), arrow = document.createElement("span");
      button.type = "button"; button.dataset.townId = town.id; button.setAttribute("aria-pressed", String(state.selectedTown === town.id));
      dot.className = "town-dot"; dot.style.backgroundColor = townColor(town); dot.setAttribute("aria-hidden", "true");
      strong.textContent = town.name; small.textContent = `${town.maxX - town.minX + 1} × ${town.maxZ - town.minZ + 1} 블록`; arrow.textContent = "↗"; arrow.className = "town-chevron"; arrow.setAttribute("aria-hidden", "true");
      name.append(strong, small); button.append(dot, name, arrow); item.append(button); list.append(item); button.addEventListener("click", () => selectTown(town));
      if (focusedTownId === town.id) button.focus({ preventScroll: true });
    }
    renderTownDetails();
  }

  function renderStatus() {
    renderPlayerList();
    if (!state.data) return;
    const old = state.data.receivedAt && Date.now() - Date.parse(state.data.receivedAt) > 20000;
    const mode = state.failed || old ? "stale" : state.data.state;
    $("map-status").dataset.state = mode;
    $("map-status").textContent = mode === "live" ? "정보 갱신 중" : mode === "pending" ? "전송 대기" : "이전 정보 표시";
    $("map-updated").textContent = state.failed ? "연결이 잠시 끊겼어요. 마지막 지도를 유지하고 있어요." : `마을 정보 ${timeText(state.data.updatedAt)} · 서울`;
    $("terrain-updated").textContent = `지형 저장 반영 ${timeText(state.data.terrainUpdatedAt)} · 마을 정보는 약 5초마다 갱신 · 지형과 건축물은 월드 저장 후 반영 · 서버 접속 가능 여부와는 달라요.`;
  }

  function renderSnapshot(next) {
    const oldSignature = state.data ? JSON.stringify(state.data.towns) + state.world : "";
    state.data = next;
    const worlds = allWorlds(), worldChanged = !worlds.some((world) => world.id === state.world);
    if (worldChanged) { state.world = worlds[0]?.id || ""; state.fitPending = true; state.selectedTown = ""; }
    renderWorldSelector();
    if (oldSignature !== JSON.stringify(next.towns) + state.world) renderTownList();
    if (state.fitPending && currentWorld()) { fitAll(); state.fitPending = false; }
    renderStatus(); requestDraw();
    if (!worlds.length) { $("map-empty").hidden = false; $("map-empty-title").textContent = "서버의 첫 지도 전송을 기다려요"; $("map-empty-text").textContent = "저장된 월드가 준비되면 지형과 마을 영역이 자동으로 나타나요."; }
  }

  function renderWorldSelector() {
    const worlds = allWorlds();
    const selector = $("map-world");
    if (Array.from(selector.options).map((option) => `${option.value}:${option.textContent}`).join("|") !== worlds.map((world) => `${world.id}:${world.label}`).join("|")) {
      selector.replaceChildren(...worlds.map((world) => { const option = document.createElement("option"); option.value = world.id; option.textContent = world.label; return option; }));
    }
    selector.disabled = worlds.length < 2; selector.value = state.world;
  }

  function renderPlayerList() {
    const list = $("map-player-list"), players = livePlayers();
    const key = JSON.stringify(players) + state.world;
    $("map-player-count").textContent = String(players.length);
    $("map-player-status").textContent = state.playersFailed ? "위치 연결이 끊겨 표시를 숨겼어요." : state.playerFeed?.state === "live" && players.length ? "약 5초마다 갱신 · 16×16블록 단위" : state.playerFeed?.state === "live" ? "표시할 접속자가 없어요." : "실시간 위치 전송을 기다리고 있어요.";
    if (list.dataset.signature === key) return;
    const focusedName = list.contains(document.activeElement) ? document.activeElement.dataset.playerName : null;
    list.dataset.signature = key; list.replaceChildren();
    for (const player of players) {
      const item = document.createElement("li"), button = document.createElement("button"), strong = document.createElement("strong"), small = document.createElement("small");
      button.type = "button"; button.dataset.playerName = player.name;
      strong.textContent = player.name; small.textContent = `${WORLD_LABELS[player.world]} · 청크 ${player.chunkX}, ${player.chunkZ}`;
      button.append(strong, small); item.append(button); list.append(item);
      button.addEventListener("click", () => { state.world = player.world; state.selectedTown = ""; clearPin(); renderWorldSelector(); renderTownList(); fit(chunkBounds(player)); announce(`${player.name}의 대략적인 위치. 청크 X ${player.chunkX}, Z ${player.chunkZ}. 정확한 좌표와 높이는 공개하지 않아요.`); });
      if (focusedName === player.name) button.focus({ preventScroll: true });
    }
  }

  async function fetchPlayers() {
    if (state.playersBusy) return;
    state.playersBusy = true;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${endpoint}/players`, { signal: controller.signal, cache: "no-store", credentials: "omit", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("위치 연결 대기");
      const body = await response.text(); if (body.length > 256 * 1024) throw new Error("응답 제한");
      state.playerFeed = validateChunkPlayers(JSON.parse(body)); state.playersFailed = false;
    } catch { state.playersFailed = true; state.playerFeed = null; }
    finally { clearTimeout(timer); state.playersBusy = false; renderWorldSelector(); renderPlayerList(); requestDraw(); }
  }

  async function fetchMap() {
    if (state.fetchBusy) return;
    state.fetchBusy = true; $("map-refresh").disabled = true;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(endpoint, { signal: controller.signal, cache: "no-store", credentials: "omit", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text();
      if (body.length > 3000000) throw new Error("지도 정보가 너무 커요.");
      const next = validateMap(JSON.parse(body), endpoint);
      state.failed = false; renderSnapshot(next);
    } catch (error) {
      state.failed = true;
      if (state.data) renderStatus();
      else { $("map-status").dataset.state = "error"; $("map-status").textContent = "연결 대기"; $("map-updated").textContent = "지도를 불러오지 못했어요. 잠시 후 자동으로 다시 시도해요."; $("map-empty-title").textContent = "지도 연결을 기다리고 있어요"; $("map-empty-text").textContent = "서버 PC의 지도 전송이 준비됐는지 확인해 주세요. 새로고침으로 다시 시도할 수도 있어요."; }
    } finally { clearTimeout(timer); state.fetchBusy = false; $("map-refresh").disabled = false; }
  }

  function zoomAt(x, y, factor) {
    const before = viewToWorld(x, y, state.view);
    state.view.scale = clamp(state.view.scale * factor, 0.025, 24);
    const after = viewToWorld(x, y, state.view);
    state.view.x += before.x - after.x; state.view.z += before.z - after.z;
    clampView(); requestDraw();
  }

  function pointFromEvent(event) { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
  function showPin(point) {
    state.pin = { x: Math.floor(clamp(point.x, -WORLD_LIMIT, WORLD_LIMIT)), z: Math.floor(clamp(point.z, -WORLD_LIMIT, WORLD_LIMIT)) };
    $("coordinate-card").hidden = false; $("selected-coordinate").textContent = coordinateText(state.pin); $("copy-coordinate").textContent = "좌표 복사";
    announce(`${coordinateText(state.pin)} 선택. 좌표 복사 버튼으로 복사할 수 있어요.`); requestDraw();
  }
  function clearPin() { state.pin = null; $("coordinate-card").hidden = true; requestDraw(); }
  function resetGesture() {
    const points = [...state.pointers.values()];
    if (points.length >= 2) { const mid = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }; state.gesture = { type: "pinch", start: mid, distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y), view: { ...state.view }, anchor: viewToWorld(mid.x, mid.y, state.view), moved: true }; }
    else if (points.length === 1) state.gesture = { type: "drag", start: points[0], view: { ...state.view }, moved: true };
    else state.gesture = null;
  }
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId); const point = pointFromEvent(event); state.pointers.set(event.pointerId, point);
    if (state.pointers.size === 1) state.gesture = { type: "drag", start: point, view: { ...state.view }, moved: false };
    else resetGesture();
    canvas.classList.add("is-dragging");
  });
  canvas.addEventListener("pointermove", (event) => {
    const point = pointFromEvent(event); $("map-hover").textContent = coordinateText(viewToWorld(point.x, point.y, state.view));
    if (!state.pointers.has(event.pointerId)) return;
    state.pointers.set(event.pointerId, point); const gesture = state.gesture;
    if (!gesture) return;
    if (gesture.type === "pinch" && state.pointers.size >= 2) {
      const points = [...state.pointers.values()], mid = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }, distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      state.view.scale = clamp(gesture.view.scale * distance / Math.max(1, gesture.distance), 0.025, 24);
      state.view.x = gesture.anchor.x - (mid.x - state.view.width / 2) / state.view.scale; state.view.z = gesture.anchor.z - (mid.y - state.view.height / 2) / state.view.scale;
    } else if (gesture.type === "drag") {
      const dx = point.x - gesture.start.x, dy = point.y - gesture.start.y;
      if (Math.hypot(dx, dy) > 5) gesture.moved = true;
      if (gesture.moved) { state.view.x = gesture.view.x - dx / state.view.scale; state.view.z = gesture.view.z - dy / state.view.scale; }
    }
    clampView(); requestDraw();
  });
  function endPointer(event) {
    if (!state.pointers.has(event.pointerId)) return;
    const point = pointFromEvent(event), isClick = event.type === "pointerup" && state.pointers.size === 1 && state.gesture?.type === "drag" && !state.gesture.moved;
    state.pointers.delete(event.pointerId); resetGesture();
    if (!state.pointers.size) canvas.classList.remove("is-dragging");
    if (isClick) showPin(viewToWorld(point.x, point.y, state.view));
  }
  canvas.addEventListener("pointerup", endPointer); canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("lostpointercapture", (event) => { if (state.pointers.delete(event.pointerId)) resetGesture(); if (!state.pointers.size) canvas.classList.remove("is-dragging"); });
  canvas.addEventListener("wheel", (event) => { event.preventDefault(); const point = pointFromEvent(event); zoomAt(point.x, point.y, Math.exp(clamp(-event.deltaY * 0.0015, -0.5, 0.5))); }, { passive: false });
  canvas.addEventListener("keydown", (event) => {
    const { view } = state; const amount = (event.shiftKey ? 160 : 55) / view.scale;
    if (event.key === "ArrowLeft") view.x -= amount; else if (event.key === "ArrowRight") view.x += amount; else if (event.key === "ArrowUp") view.z -= amount; else if (event.key === "ArrowDown") view.z += amount;
    else if (["+", "="].includes(event.key)) zoomAt(view.width / 2, view.height / 2, 1.5); else if (event.key === "-") zoomAt(view.width / 2, view.height / 2, 1 / 1.5);
    else if (event.key === "Home") fitAll(); else if (event.key === "Enter" || event.key === " ") showPin({ x: view.x, z: view.z }); else if (event.key === "Escape") clearPin(); else return;
    event.preventDefault(); clampView(); requestDraw();
  });
  $("map-zoom-in").addEventListener("click", () => zoomAt(state.view.width / 2, state.view.height / 2, 1.5));
  $("map-zoom-out").addEventListener("click", () => zoomAt(state.view.width / 2, state.view.height / 2, 1 / 1.5));
  $("map-fit").addEventListener("click", () => { state.selectedTown = ""; fitAll(); renderTownList(); announce("현재 차원의 모든 마을을 함께 볼 수 있도록 지도를 맞췄어요."); });
  $("map-refresh").addEventListener("click", () => { fetchMap(); fetchPlayers(); }); $("clear-coordinate").addEventListener("click", () => { clearPin(); canvas.focus(); });
  $("map-world").addEventListener("change", (event) => { state.world = event.target.value; state.selectedTown = ""; clearPin(); renderTownList(); fitAll(); requestDraw(); });
  $("copy-coordinate").addEventListener("click", async () => {
    if (!state.pin) return;
    const text = `X: ${state.pin.x}, Z: ${state.pin.z}`;
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else { const field = document.createElement("textarea"); field.value = text; field.className = "sr-only"; document.body.append(field); field.select(); const copied = document.execCommand("copy"); field.remove(); if (!copied) throw new Error("복사 불가"); $("copy-coordinate").focus(); }
      $("copy-coordinate").textContent = "복사 완료 ✓"; announce(`${text} 복사했어요.`);
    } catch { $("copy-coordinate").textContent = "직접 선택해 주세요"; const selection = window.getSelection(), range = document.createRange(); range.selectNodeContents($("selected-coordinate")); selection.removeAllRanges(); selection.addRange(range); announce("자동 복사가 안 돼요. 표시된 좌표를 직접 선택해 복사해 주세요."); }
  });
  new ResizeObserver(resize).observe($("map-viewport"));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { fetchMap(); fetchPlayers(); } });
  resize(); fetchMap(); fetchPlayers();
  setInterval(() => { if (!document.hidden) { fetchMap(); fetchPlayers(); } renderStatus(); requestDraw(); }, 5000);
}());

