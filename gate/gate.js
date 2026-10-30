(() => {
  const STORAGE_KEY = "gate_guest_password_v1";
  const DEFAULT_BRIDGE_ORIGIN = "https://ds-macbook-air.tail3d617f.ts.net";

  const params = new URLSearchParams(window.location.search);
  const bridgeOrigin = (
    params.get("bridge") ||
    window.__GATE_BRIDGE_ORIGIN__ ||
    DEFAULT_BRIDGE_ORIGIN
  ).replace(/\/$/, "");

  let activePassword = "";
  let refreshTimers = [];

  const $ = (id) => document.getElementById(id);

  function showAlert(message, isError = false) {
    const box = $("alert-box");
    if (!message) {
      box.hidden = true;
      box.textContent = "";
      box.classList.remove("error");
      return;
    }
    box.hidden = false;
    box.textContent = message;
    box.classList.toggle("error", Boolean(isError));
  }

  function clearScheduledRefreshes() {
    for (const timer of refreshTimers) clearTimeout(timer);
    refreshTimers = [];
  }

  function formatTime(epochSeconds) {
    if (!epochSeconds) return "";
    const d = new Date(epochSeconds * 1000);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function formatRemaining(seconds) {
    if (seconds == null) return "Active pass";
    if (seconds <= 0) return "Expired";
    if (seconds < 3600) return `${Math.ceil(seconds / 60)}m remaining`;
    if (seconds < 86400) {
      const h = Math.floor(seconds / 3600);
      const m = Math.round((seconds % 3600) / 60);
      return m > 0 ? `${h}h ${m}m remaining` : `${h}h remaining`;
    }
    const d = Math.floor(seconds / 86400);
    return `${d}d remaining`;
  }

  function makeIdempotencyKey() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return `guest-${window.crypto.randomUUID()}`;
    }
    const rand = Math.random().toString(36).slice(2, 12);
    return `guest-${Date.now()}-${rand}-0000`;
  }

  async function callGuestApi(endpoint, payload) {
    const response = await fetch(`${bridgeOrigin}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  }

  function renderGateView(data) {
    const guest = data.guest || {};
    const pos = data.position || {};
    const cam = data.camera || {};

    const pill = $("pass-pill");
    pill.hidden = false;
    pill.textContent = guest.label
      ? `${guest.label} · ${formatRemaining(guest.remaining_seconds)}`
      : formatRemaining(guest.remaining_seconds);

    $("expiry-info").textContent = guest.expires_at
      ? `Pass valid until ${formatTime(guest.expires_at)}`
      : "Pass active until revoked";

    const dot = $("state-dot");
    const stateText = $("state-text");
    const stateMeta = $("state-meta");
    dot.className = "state-dot";

    const prediction = pos.prediction;
    if (pos.reason === "movement" || prediction) {
      dot.classList.add("open");
      stateText.textContent = prediction?.target === "open"
        ? "Opening…"
        : prediction?.target === "closed"
        ? "Closing…"
        : "Gate Moving…";
      stateMeta.textContent = "Relay pulse accepted — waiting for camera confirmation";
    } else if (pos.state === "closed") {
      dot.classList.add("closed");
      stateText.textContent = "Closed";
      stateMeta.textContent = pos.observed_at
        ? `Camera confirmed at ${formatTime(pos.observed_at)}`
        : "Camera confirmed closed";
    } else if (pos.state === "open") {
      dot.classList.add("open");
      stateText.textContent = "Open";
      stateMeta.textContent = pos.observed_at
        ? `Camera confirmed at ${formatTime(pos.observed_at)}`
        : "Camera confirmed open";
    } else {
      dot.classList.add("unknown");
      stateText.textContent = "Status Unclear";
      stateMeta.textContent = pos.observed_at
        ? `Last snapshot ${formatTime(pos.observed_at)}`
        : "Bridge online";
    }

    $("open-gate-label").textContent =
      pos.state === "closed"
        ? "Open Gate"
        : pos.state === "open"
        ? "Close / Toggle Gate"
        : "Open / Toggle Gate";

    $("camera-title").textContent = cam.camera_name || "Gate camera";
    $("camera-time").textContent = cam.captured_at
      ? `Captured ${formatTime(cam.captured_at)}`
      : "";

    const img = $("camera-image");
    const empty = $("camera-empty");
    if (cam.image_base64) {
      img.src = `data:image/jpeg;base64,${cam.image_base64}`;
      img.hidden = false;
      empty.hidden = true;
    } else {
      img.hidden = true;
      empty.hidden = false;
    }
  }

  function showAuthScreen(keepPasswordValue = true) {
    clearScheduledRefreshes();
    $("control-card").hidden = true;
    $("auth-card").hidden = false;
    $("pass-pill").hidden = true;
    if (!keepPasswordValue) {
      $("password-input").value = "";
    }
  }

  async function verifyAndLoadStatus(password, { saveOnSuccess = true, silent = false } = {}) {
    const cleaned = (password || "").trim();
    if (!cleaned) {
      showAlert("Enter your guest password.", true);
      return false;
    }
    $("unlock-btn").disabled = true;
    $("refresh-btn").disabled = true;
    try {
      const { ok, data } = await callGuestApi("/v1/guest/status", {
        password: cleaned,
      });
      if (!ok) {
        // Keep the password in the input field and show the error.
        $("password-input").value = cleaned;
        showAuthScreen(true);
        showAlert(data.error || "Invalid or expired password.", true);
        return false;
      }
      activePassword = cleaned;
      if (saveOnSuccess && $("remember-checkbox").checked) {
        try {
          localStorage.setItem(STORAGE_KEY, cleaned);
        } catch {
          // Ignore storage quota / private-mode restrictions.
        }
      } else if (!saveOnSuccess) {
        // Keep existing saved state untouched during background refreshes.
      } else {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {}
      }

      $("auth-card").hidden = true;
      $("control-card").hidden = false;
      if (!silent) showAlert("");
      renderGateView(data);
      return true;
    } catch {
      $("password-input").value = cleaned;
      showAlert(
        "Could not reach the gate bridge. Check your internet connection and try again.",
        true
      );
      return false;
    } finally {
      $("unlock-btn").disabled = false;
      $("refresh-btn").disabled = false;
    }
  }

  async function triggerOpenGate() {
    if (!activePassword) {
      showAuthScreen(true);
      return;
    }
    const btn = $("open-gate-btn");
    const label = $("open-gate-label");
    const sub = $("open-gate-sub");
    btn.disabled = true;
    label.textContent = "Sending Signal…";
    sub.textContent = "Contacting gate bridge…";
    showAlert("");

    try {
      const { ok, status, data } = await callGuestApi("/v1/guest/open", {
        password: activePassword,
        idempotency_key: makeIdempotencyKey(),
      });
      if (!ok) {
        if (status === 401) {
          $("password-input").value = activePassword;
          showAuthScreen(true);
        }
        showAlert(data.error || "Could not send gate command.", true);
        return;
      }
      renderGateView(data);
      showAlert("Gate signal accepted. Refreshing camera view as the gate moves…", false);

      clearScheduledRefreshes();
      for (const delayMs of [4000, 10000, 20000, 32000]) {
        refreshTimers.push(
          setTimeout(() => {
            if (activePassword) {
              verifyAndLoadStatus(activePassword, { saveOnSuccess: false, silent: true });
            }
          }, delayMs)
        );
      }
    } catch {
      showAlert(
        "Connection dropped while sending the command. Check the camera status before tapping again.",
        true
      );
    } finally {
      setTimeout(() => {
        btn.disabled = false;
        sub.textContent = "Sends one relay pulse to open or close the gate";
      }, 3000);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const pwInput = $("password-input");
    const toggleBtn = $("toggle-visibility");

    toggleBtn.addEventListener("click", () => {
      const showing = pwInput.type === "text";
      pwInput.type = showing ? "password" : "text";
      toggleBtn.textContent = showing ? "Show" : "Hide";
      toggleBtn.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    });

    $("auth-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      await verifyAndLoadStatus(pwInput.value, { saveOnSuccess: true });
    });

    $("refresh-btn").addEventListener("click", async () => {
      showAlert("");
      await verifyAndLoadStatus(activePassword, { saveOnSuccess: false });
    });

    $("open-gate-btn").addEventListener("click", triggerOpenGate);

    $("forget-btn").addEventListener("click", () => {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
      activePassword = "";
      showAlert("Saved password removed from this device.", false);
      showAuthScreen(false);
      pwInput.focus();
    });

    let saved = "";
    try {
      saved = localStorage.getItem(STORAGE_KEY) || "";
    } catch {}
    if (saved) {
      pwInput.value = saved;
      verifyAndLoadStatus(saved, { saveOnSuccess: false });
    }
  });
})();
