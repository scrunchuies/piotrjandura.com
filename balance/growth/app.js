const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const pctFmt = new Intl.NumberFormat("en-US", {
  style: "percent",
  signDisplay: "exceptZero",
  maximumFractionDigits: 2,
});

const vaultDayFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
});

const formatVaultDay = (value) => {
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? value : vaultDayFmt.format(d);
};

const stampFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const TOKEN_KEY = "jar-vault-token";
const API_DEFAULT =
  "https://script.google.com/macros/s/AKfycbxTu3jAM4y1vc28SDAaxhGo9o-rOw_MOFCrzmlZY4Rl8PLx1hpvAP58rVkwJ_gdKe60/exec";

const jsonp = (url, timeoutMs = 45000) =>
  new Promise((resolve, reject) => {
    const cb = "sjVault_" + Math.random().toString(36).slice(2);
    const script = document.createElement("script");
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("timeout"));
    }, timeoutMs);
    const cleanup = () => {
      window.clearTimeout(timer);
      delete window[cb];
      script.remove();
    };
    window[cb] = (data) => {
      cleanup();
      resolve(data);
    };
    script.src = `${url}${url.includes("?") ? "&" : "?"}callback=${cb}&t=${Date.now()}`;
    script.onerror = () => {
      cleanup();
      reject(new Error("blocked"));
    };
    document.head.append(script);
  });

// Plain fetch works because Apps Script answers with Access-Control-Allow-Origin: *.
const fetchJson = async (url, timeoutMs = 30000) => {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", redirect: "follow", signal: ctrl.signal });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(res.ok ? "unexpected page" : `http ${res.status}`);
    }
  } catch (err) {
    if (err?.name === "AbortError") throw new Error("timed out");
    if (err instanceof TypeError) throw new Error("blocked");
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
};

const qs = (params) =>
  Object.entries(params)
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");

let apiUrl = API_DEFAULT;
let token = "";

const setStatus = (id, text) => {
  const el = document.getElementById(id);
  if (el) el.textContent = text || "";
};

// Try fetch first, then the script-tag route; report both reasons if neither works.
const growth = async (op, extra = {}) => {
  const url = `${apiUrl}?${qs({ action: "growth", op, token, ...extra })}`;
  const reasons = [];
  try {
    return await fetchJson(`${url}&t=${Date.now()}`);
  } catch (err) {
    reasons.push(`fetch ${err?.message || "failed"}`);
  }
  try {
    return await jsonp(url);
  } catch (err) {
    reasons.push(`script ${err?.message || "failed"}`);
  }
  const failure = new Error(reasons.join(", "));
  failure.reasons = reasons;
  throw failure;
};

const showUnreachable = (id, err) => {
  const why = err?.reasons ? ` (${err.reasons.join(", ")})` : "";
  setStatus(
    id,
    `Couldn’t reach the jar script${why}. If you use an ad blocker, VPN, or content blocker, allow script.google.com and script.googleusercontent.com, then try again.`
  );
  const test = document.getElementById("vault-test");
  if (test) {
    test.href = `${apiUrl}?${qs({ action: "growth", op: "login", password: "test" })}`;
    test.hidden = false;
  }
};

const drawChart = (rows) => {
  const svg = document.getElementById("vault-chart");
  const empty = document.getElementById("vault-empty");
  if (!svg) return;
  svg.replaceChildren();
  if (rows.length < 2) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;

  const w = 640;
  const h = 260;
  const pad = 28;
  const values = rows.map((row) => Number(row.value) || 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const xFor = (i) => pad + (i * (w - pad * 2)) / Math.max(rows.length - 1, 1);
  const yFor = (value) => h - pad - ((value - min) / span) * (h - pad * 2);
  const d = rows
    .map((row, i) => `${i ? "L" : "M"}${xFor(i).toFixed(1)},${yFor(Number(row.value) || 0).toFixed(1)}`)
    .join(" ");

  const ns = "http://www.w3.org/2000/svg";
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "#d4b483");
  path.setAttribute("stroke-width", "3");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);

  const last = rows[rows.length - 1];
  const dot = document.createElementNS(ns, "circle");
  dot.setAttribute("cx", xFor(rows.length - 1).toFixed(1));
  dot.setAttribute("cy", yFor(Number(last.value) || 0).toFixed(1));
  dot.setAttribute("r", "4.5");
  dot.setAttribute("fill", "#f3eee6");
  svg.append(dot);
};

const signed = (amount) => `${amount >= 0 ? "+" : "−"}${money.format(Math.abs(amount))}`;

let lastData = null;

const paint = (data) => {
  lastData = data;
  const history = [...(data.history || [])].sort((a, b) =>
    String(a.date).localeCompare(String(b.date))
  );
  const accounts = data.accounts || [];
  const connections = data.connections || [];
  const linked = connections.length > 0 || Boolean(data.connected);
  const hasAccounts = accounts.length > 0;
  const broken = connections.filter((c) => c.disabled);

  const latestEl = document.getElementById("vault-latest");
  const changeEl = document.getElementById("vault-change");
  const dayLabelEl = document.getElementById("vault-day-label");
  const cashEl = document.getElementById("vault-count");
  if (latestEl) latestEl.textContent = hasAccounts ? money.format(Number(data.total) || 0) : "—";
  if (cashEl) cashEl.textContent = hasAccounts ? money.format(Number(data.cash) || 0) : "—";
  if (changeEl) {
    changeEl.classList.remove("is-up", "is-down");
    const day = Number(data.day);
    const pct = Number(data.dayPct);
    if (hasAccounts && data.hasDay && Number.isFinite(day)) {
      changeEl.textContent = Number.isFinite(pct) ? `${signed(day)} (${pctFmt.format(pct)})` : signed(day);
      if (day > 0) changeEl.classList.add("is-up");
      if (day < 0) changeEl.classList.add("is-down");
      if (dayLabelEl) dayLabelEl.textContent = data.dayLabel || "Today";
    } else if (hasAccounts && data.hasPnl) {
      const pnl = Number(data.pnl) || 0;
      const cost = Number(data.cost) || 0;
      changeEl.textContent = cost > 0 ? `${signed(pnl)} (${pctFmt.format(pnl / cost)})` : signed(pnl);
      if (pnl > 0) changeEl.classList.add("is-up");
      if (pnl < 0) changeEl.classList.add("is-down");
      if (dayLabelEl) dayLabelEl.textContent = "Since buy";
    } else {
      changeEl.textContent = "—";
      if (dayLabelEl) dayLabelEl.textContent = "Today";
    }
  }

  const bits = [];
  const brokerNames = [
    ...new Set(
      (hasAccounts ? accounts.map((a) => a.institution) : connections.map((c) => c.brokerage)).filter(
        Boolean
      )
    ),
  ];
  if (hasAccounts) {
    bits.push(brokerNames.join(", ") || "Brokerage");
    if (accounts.length > 1) bits.push(`${accounts.length} accounts`);
    const at = Date.parse(data.at || "");
    if (!Number.isNaN(at)) bits.push(`as of ${stampFmt.format(new Date(at))}`);
    if (data.syncing) bits.push("first sync still running");
    if (data.delayed) bits.push("Fidelity’s feed can lag the app by about a day");
    if (data.hasDay && data.dayLabel !== "Today" && data.dayAsOf) {
      bits.push(`latest move is from ${formatVaultDay(data.dayAsOf)}`);
    }
  } else if (linked) {
    bits.push(`${brokerNames.join(", ") || "Brokerage"} is connected`);
    bits.push(
      broken.length
        ? "but the connection is disabled — press Reconnect"
        : "but no accounts have come through yet. Fidelity may still be syncing, or no accounts were ticked on the share screen. Press Refresh in a minute."
    );
  } else if (data.error) {
    bits.push(data.error);
  } else {
    bits.push("No brokerage connected yet.");
  }
  (data.warnings || []).forEach((w) => bits.push(w));
  setStatus("vault-quote", bits.join(" · "));

  drawChart(history);

  const list = document.getElementById("vault-positions");
  if (list) {
    list.replaceChildren();
    accounts.forEach((acct) => {
      (acct.positions || []).forEach((pos) => {
        const item = document.createElement("li");
        const head = document.createElement("strong");
        head.textContent = pos.symbol || pos.name || "—";
        const meta = document.createElement("span");
        const parts = [];
        if (pos.units) parts.push(`${Number(pos.units).toLocaleString("en-US", { maximumFractionDigits: 4 })} sh`);
        if (pos.price) parts.push(`@ ${money.format(pos.price)}`);
        if (pos.pnl != null) parts.push(signed(Number(pos.pnl)));
        meta.textContent = parts.join(" · ");
        const val = document.createElement("em");
        val.textContent = money.format(Number(pos.value) || 0);
        item.append(head, meta, val);
        list.append(item);
      });
    });
  }

  const connectCard = document.getElementById("vault-connect-card");
  const connectBtn = document.getElementById("vault-connect");
  const reconnectBtn = document.getElementById("vault-reconnect");
  if (connectCard) connectCard.classList.toggle("is-secondary", hasAccounts);
  if (connectBtn) connectBtn.textContent = linked ? "Connect another account" : "Connect Fidelity";
  if (reconnectBtn) {
    reconnectBtn.hidden = !broken.length;
    reconnectBtn.dataset.id = broken[0]?.id || "";
    reconnectBtn.textContent = broken.length ? `Reconnect ${broken[0].brokerage}` : "Reconnect";
  }
  if (hasAccounts) {
    setStatus("connect-status", "Connected. Access is read-only and can be revoked on Fidelity’s site.");
  } else if (linked) {
    setStatus(
      "connect-status",
      "A connection exists. Don’t reconnect unless the status above asks you to — use Refresh or Details."
    );
  } else {
    setStatus("connect-status", "Connect Fidelity once. You approve read-only access on Fidelity’s own site.");
  }

  const log = document.getElementById("vault-log");
  if (log) {
    log.replaceChildren();
    [...history].reverse().slice(0, 10).forEach((row) => {
      const item = document.createElement("li");
      item.textContent = `${row.date} · ${money.format(Number(row.value) || 0)}`;
      log.append(item);
    });
  }
};

const showDesk = (on) => {
  const login = document.getElementById("vault-login");
  const desk = document.getElementById("vault-desk");
  if (login) login.hidden = on;
  if (desk) desk.hidden = !on;
};

const loadDesk = async (op = "list") => {
  const data = await growth(op);
  if (!data?.ok) {
    token = "";
    remember("");
    showDesk(false);
    setStatus("login-status", data?.error || "Sign in again.");
    return;
  }
  showDesk(true);
  paint(data);
};

const ensureApi = async () => {
  try {
    const cfg = await fetch(`${window.location.origin}/notes-api.json?t=${Date.now()}`, {
      cache: "no-store",
    }).then((res) => (res.ok ? res.json() : {}));
    apiUrl = String(cfg.url || "").trim() || API_DEFAULT;
  } catch {
    apiUrl = API_DEFAULT;
  }
};

const remember = (value) => {
  try {
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode */
  }
};

const recall = () => {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
};

// Always re-read notes-api.json first so a redeployed script URL is picked up
// without a reload; retry once in case the first attempt hit a stale URL.
const growthFresh = async (op, extra = {}) => {
  await ensureApi();
  try {
    return await growth(op, extra);
  } catch {
    await ensureApi();
    return growth(op, extra);
  }
};

document.getElementById("vault-login")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("login-status", "Signing in…");
  const password = document.getElementById("vault-password")?.value || "";
  let data;
  try {
    data = await growthFresh("login", { password });
  } catch (err) {
    showUnreachable("login-status", err);
    return;
  }
  const test = document.getElementById("vault-test");
  if (test) test.hidden = true;
  if (!data?.ok || !data.token) {
    setStatus("login-status", data?.error || "Could not sign in.");
    return;
  }
  token = data.token;
  remember(token);
  document.getElementById("vault-password").value = "";
  setStatus("login-status", "");
  showDesk(true);
  setStatus("vault-quote", "Loading the brokerage…");
  try {
    await loadDesk("refresh");
  } catch {
    setStatus("vault-quote", "Signed in, but the brokerage didn’t answer. Press Refresh.");
  }
});

const startConnect = async (reconnect = "") => {
  setStatus("connect-status", "Opening the secure connection portal…");
  try {
    const redirect = `${window.location.origin}${window.location.pathname}?connected=1`;
    const data = await growth("connect", { redirect, reconnect });
    if (!data?.ok || !data.url) {
      setStatus("connect-status", data?.error || "Could not start the connection.");
      return;
    }
    window.location.assign(data.url);
  } catch {
    setStatus("connect-status", "Could not reach SnapTrade. Check the script properties.");
  }
};

document.getElementById("vault-reconnect")?.addEventListener("click", (event) => {
  startConnect(event.currentTarget.dataset.id || "");
});

document.getElementById("vault-details")?.addEventListener("click", async () => {
  const pre = document.getElementById("vault-debug");
  const btn = document.getElementById("vault-details");
  if (!pre) return;
  if (!pre.hidden) {
    pre.hidden = true;
    if (btn) btn.textContent = "Details";
    return;
  }
  if (btn) btn.textContent = "Loading…";
  try {
    const data = await growth("debug");
    pre.textContent = JSON.stringify(
      { lastView: lastData && { connected: lastData.connected, connections: lastData.connections, accounts: lastData.accounts?.length, warnings: lastData.warnings, error: lastData.error, cached: lastData.cached }, snaptrade: data },
      null,
      2
    );
  } catch (err) {
    pre.textContent = `Could not load details: ${err?.message || err}`;
  }
  pre.hidden = false;
  if (btn) btn.textContent = "Hide details";
});

document.getElementById("vault-refresh")?.addEventListener("click", async () => {
  const btn = document.getElementById("vault-refresh");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Refreshing…";
  }
  try {
    await loadDesk("refresh");
  } catch {
    setStatus("vault-quote", "Refresh failed. Try again in a minute.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Refresh";
    }
  }
});

document.getElementById("vault-connect")?.addEventListener("click", () => {
  startConnect("");
});

document.getElementById("vault-logout")?.addEventListener("click", async () => {
  try {
    await growth("logout");
  } catch {
    /* local sign-out still */
  }
  token = "";
  remember("");
  showDesk(false);
  setStatus("login-status", "Signed out.");
});

(async () => {
  await ensureApi();
  token = recall();
  if (!token) return;
  const justConnected = new URLSearchParams(window.location.search).get("connected") === "1";
  if (justConnected) {
    window.history.replaceState({}, "", window.location.pathname);
  }
  try {
    await loadDesk(justConnected ? "refresh" : "list");
  } catch (err) {
    showDesk(true);
    showUnreachable("vault-quote", err);
  }
})();
