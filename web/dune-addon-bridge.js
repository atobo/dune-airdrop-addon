(function () {
  const addonId = document.documentElement.dataset.addonId || "my-dune-addon";
  const pendingRequests = new Map();

  function createRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function request(action, payload = {}) {
    if (window.parent === window) {
      return Promise.reject(new Error("Open this addon in Dune Docker Console, or provide a local development mock."));
    }
    const requestId = createRequestId();

    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        const pending = pendingRequests.get(requestId);
        if (!pending) return;
        pendingRequests.delete(requestId);
        pending.reject(new Error("Bridge request timed out."));
      }, 30000);
      pendingRequests.set(requestId, { resolve, reject, timer });
      try {
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
      } catch (error) {
        pendingRequests.delete(requestId);
        window.clearTimeout(timer);
        reject(error);
      }
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== window.location.origin) return;

    const message = event.data || {};
    if (message.type !== "dune-addon-response") return;
    if (typeof message.requestId !== "string" || typeof message.ok !== "boolean") return;
    if (message.addonId && message.addonId !== addonId) return;

    const pending = pendingRequests.get(message.requestId);
    if (!pending) return;

    pendingRequests.delete(message.requestId);
    window.clearTimeout(pending.timer);

    if (message.ok) {
      pending.resolve(message.result);
    } else {
      pending.reject(new Error(message.error || "Bridge request failed."));
    }
  });

  window.DuneAddon = { request };
})();
