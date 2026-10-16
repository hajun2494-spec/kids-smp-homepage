(() => {
  "use strict";
  const config = window.EVERGREEN_PRESENCE;
  const panel = document.getElementById("presence-panel");
  if (!config || !panel) return;
  const status = document.getElementById("presence-status");
  const count = document.getElementById("presence-count");
  const max = document.getElementById("presence-max");
  const list = document.getElementById("presence-players");
  const message = document.getElementById("presence-message");
  const updated = document.getElementById("presence-updated");
  const refresh = document.getElementById("presence-refresh");
  const interval = Math.max(3000, Number(config.refreshMs) || 5000);
  let timer, controller, pending = false, stopped = false, namesKey = "";

  function setMessage(text) {
    if (message.textContent !== text) message.textContent = text;
  }

  function setPlayers(names) {
    const key = JSON.stringify(names);
    if (key === namesKey) return;
    namesKey = key;
    const fragment = document.createDocumentFragment();
    for (const name of names) {
      const chip = document.createElement("li");
      const face = document.createElement("img");
      face.className = "presence-avatar";
      face.alt = "";
      face.width = 32;
      face.height = 32;
      face.loading = "lazy";
      face.decoding = "async";
      face.referrerPolicy = "no-referrer";
      face.crossOrigin = "anonymous";
      face.addEventListener("error", () => {
        face.src = "player-avatar-fallback.svg";
      }, { once: true });
      // Floodgate replaces Xbox gamertag spaces with underscores on this server.
      const skinName = name.startsWith(".") ? name.replaceAll("_", " ") : name;
      face.src = "https://api.mcheads.org/head/" + encodeURIComponent(skinName) + "/32/hat";
      const label = document.createElement("span");
      label.className = "presence-player-name";
      label.textContent = name;
      chip.appendChild(face);
      chip.appendChild(label);
      fragment.appendChild(chip);
    }
    list.replaceChildren(fragment);
  }

  function render(data) {
    if (!data || data.source !== "pc-push" || !data.players
      || !["online", "offline", "unknown", "stale"].includes(data.state)) throw new Error("invalid_status");
    const capacity = data.players.max;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000) throw new Error("invalid_capacity");
    const names = data.players.list;
    if (!Array.isArray(names) || !names.every(player => player && typeof player.name === "string"
      && player.name.length > 0 && player.name.length <= 64)) throw new Error("invalid_names");
    const online = data.players.online;
    if (data.state === "online" && (!Number.isInteger(online) || online < 0
      || online > capacity || online !== names.length)) throw new Error("invalid_count");
    const time = data.updated_at ? new Date(data.updated_at) : null;
    max.textContent = String(capacity);
    if (time && Number.isFinite(time.getTime())) {
      updated.dateTime = time.toISOString();
      updated.textContent = new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      }).format(time) + " 확인 · 한국 시간";
    } else {
      updated.removeAttribute("datetime");
      updated.textContent = "아직 접속 정보를 받지 못했어요";
    }
    if (data.state === "online") {
      panel.dataset.state = online ? "online" : "empty";
      status.textContent = "온라인";
      count.textContent = String(online);
      setMessage(online
        ? "지금 서버에서 함께 플레이 중인 유저들이에요."
        : "지금은 접속한 플레이어가 없어요. 첫 번째로 합류해 보세요!");
      setPlayers(names.map(player => player.name));
    } else {
      setPlayers([]);
      count.textContent = data.state === "offline" ? "0" : "—";
      panel.dataset.state = data.state === "offline" ? "offline" : "stale";
      status.textContent = data.state === "offline" ? "오프라인" : "연결 확인 중";
      setMessage(data.state === "offline"
        ? "서버가 현재 꺼져 있어요. 운영 시간은 매일 오전 6시부터 오후 11시까지예요."
        : data.state === "stale"
          ? "PC의 접속 정보 전송이 잠시 멈췄어요. 곧 다시 확인할게요."
          : "서버 접속 정보를 확인하고 있어요. 잠시 후 다시 확인해 주세요.");
    }
  }

  function unavailable() {
    panel.dataset.state = "error";
    status.textContent = "확인 불가";
    count.textContent = "—";
    setPlayers([]);
    setMessage("접속 정보를 불러오지 못했어요. 서버 상태는 잠시 후 다시 확인할게요.");
  }

  async function poll() {
    if (pending || stopped || document.hidden) return;
    clearTimeout(timer);
    pending = true;
    refresh.disabled = true;
    panel.setAttribute("aria-busy", "true");
    controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(config.timeoutMs) || 8000));
    try {
      const response = await fetch(config.endpoint, {
        cache: "no-store", credentials: "omit", mode: "cors", signal: controller.signal,
      });
      if (!response.ok) throw new Error("unavailable");
      render(await response.json());
    } catch {
      if (!stopped && !document.hidden) unavailable();
    } finally {
      clearTimeout(timeout);
      controller = null;
      pending = false;
      refresh.disabled = false;
      panel.setAttribute("aria-busy", "false");
      if (!stopped && !document.hidden) timer = setTimeout(poll, interval);
    }
  }

  refresh.addEventListener("click", poll);
  document.addEventListener("visibilitychange", () => {
    clearTimeout(timer);
    if (document.hidden) controller?.abort();
    else poll();
  });
  window.addEventListener("pagehide", () => {
    stopped = true;
    clearTimeout(timer);
    controller?.abort();
  });
  window.addEventListener("pageshow", () => { if (stopped) { stopped = false; poll(); } });
  poll();
})();
