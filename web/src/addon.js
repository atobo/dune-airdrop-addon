(function () {
  const addonId = "my-dune-addon";
  const pendingRequests = new Map();

  function createRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function request(action, payload = {}) {
    const requestId = createRequestId();

    const promise = new Promise((resolve, reject) => {
      pendingRequests.set(requestId, { resolve, reject });

      window.parent.postMessage(
        {
          type: "dune-addon-request",
          addonId,
          requestId,
          action,
          payload
        },
        window.location.origin
      );

      window.setTimeout(() => {
        const pending = pendingRequests.get(requestId);
        if (!pending) return;
        pendingRequests.delete(requestId);
        pending.reject(new Error("Bridge request timed out."));
      }, 30000);
    });

    return promise;
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;

    const message = event.data || {};
    if (message.type !== "dune-addon-response") return;
    if (message.addonId && message.addonId !== addonId) return;

    const pending = pendingRequests.get(message.requestId);
    if (!pending) return;

    pendingRequests.delete(message.requestId);

    if (message.ok) {
      pending.resolve(message.result);
    } else {
      pending.reject(new Error(message.error || "Bridge request failed."));
    }
  });

  window.DuneAddon = { request };

  const playersEl = document.querySelector("#players");
  const logEl = document.querySelector("#log");
  const queryResultEl = document.querySelector("#queryResult");
  const refreshPlayersButton = document.querySelector("#refreshPlayers");
  const runQueryButton = document.querySelector("#runQuery");

  function log(message) {
    logEl.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  }

  function renderPlayers(players) {
    if (!Array.isArray(players) || players.length === 0) {
      playersEl.innerHTML = '<p class="empty">No players found.</p>';
      return;
    }

    playersEl.innerHTML = players
      .map((player) => {
        const name = escapeHtml(player.name || player.player_name || "Unknown");
        const level = escapeHtml(String(player.level ?? "-"));
        const faction = escapeHtml(player.faction || "No faction");
        const guild = escapeHtml(player.guild || "No guild");

        return `
          <article class="card">
            <h3>${name}</h3>
            <dl>
              <div><dt>Level</dt><dd>${level}</dd></div>
              <div><dt>Faction</dt><dd>${faction}</dd></div>
              <div><dt>Guild</dt><dd>${guild}</dd></div>
            </dl>
          </article>
        `;
      })
      .join("");
  }

  function escapeHtml(value) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function loadPlayers() {
    refreshPlayersButton.disabled = true;
    playersEl.innerHTML = '<p class="empty">Loading players...</p>';

    try {
      const result = await request("leadership.players.list");
      renderPlayers(result.players || result || []);
      log("Loaded player data.");
    } catch (error) {
      playersEl.innerHTML = `<p class="empty error">${escapeHtml(error.message)}</p>`;
      log(error.message);
    } finally {
      refreshPlayersButton.disabled = false;
    }
  }

  async function runSampleQuery() {
    runQueryButton.disabled = true;
    queryResultEl.textContent = "Running query...";

    try {
      const result = await request("database.query", {
        query: "select current_database() as database_name, now() as server_time"
      });
      queryResultEl.textContent = JSON.stringify(result, null, 2);
      log("Sample query completed.");
    } catch (error) {
      queryResultEl.textContent = error.message;
      log(error.message);
    } finally {
      runQueryButton.disabled = false;
    }
  }

  refreshPlayersButton.addEventListener("click", loadPlayers);
  runQueryButton.addEventListener("click", runSampleQuery);
})();
