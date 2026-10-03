const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const dateFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "short",
  day: "numeric",
  year: "numeric",
});

const JAR_TZ = "America/Los_Angeles";

const dayFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: JAR_TZ,
  month: "short",
  day: "numeric",
  year: "numeric",
});

const whenFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: JAR_TZ,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const formatDay = (value) => {
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? value : dayFmt.format(d);
};

const formatWhen = (tx) => {
  const stamped = Date.parse(tx.at || "");
  if (!Number.isNaN(stamped)) return whenFmt.format(new Date(stamped));
  return formatDay(tx.date);
};

const firstName = (raw) => {
  const name = String(raw || "")
    .replace(/\s+on venmo\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) return "Someone";
  if (/^bank transfer$/i.test(name)) return "Bank transfer";
  const token = name.split(/\s+/)[0].replace(/[.,;:'’]+$/g, "") || "Someone";
  if (/^doan$/i.test(token)) return "Lucia";
  return token;
};

const parseTxDate = (value) => {
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

const startOfWeek = (now) => {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
};

const inThisWeek = (d, now) => d && d >= startOfWeek(now);
const inThisMonth = (d, now) =>
  d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();

const rankPeople = (txs) => {
  const map = new Map();
  for (const tx of txs) {
    const name = firstName(tx.from);
    const amount = Math.abs(Number(tx.amount) || 0);
    const row = map.get(name) || { name, total: 0, count: 0 };
    row.total += amount;
    row.count += 1;
    map.set(name, row);
  }
  return [...map.values()].sort(
    (a, b) => b.total - a.total || b.count - a.count || a.name.localeCompare(b.name)
  );
};

const renderBoard = (id, rows) => {
  const list = document.getElementById(id);
  if (!list) return;
  list.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("li");
    empty.className = "board-empty";
    empty.textContent = "Nobody yet. Stay holy.";
    list.append(empty);
    return;
  }
  rows.slice(0, 5).forEach((row, i) => {
    const li = document.createElement("li");
    const rank = document.createElement("span");
    rank.className = "board-rank";
    rank.textContent = String(i + 1);
    const who = document.createElement("strong");
    who.textContent = row.name;
    const meta = document.createElement("em");
    meta.textContent = money.format(row.total);
    li.append(rank, who, meta);
    list.append(li);
  });
};

const setText = (id, value) => {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
};

const hashSeed = (value) => {
  let h = 2166136261;
  for (const char of String(value)) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const assignCurses = (txs, pool) => {
  const used = new Set();
  const lines = Array.isArray(pool) ? pool.map(String) : [];
  return txs.map((tx, index) => {
    const stored = String(tx.curse || "").trim();
    if (stored && !used.has(stored)) {
      used.add(stored);
      return { ...tx, curse: stored };
    }
    const available = lines.filter((line) => !used.has(line));
    let curse;
    if (available.length) {
      const seed = hashSeed(String(tx.id || `${tx.date}|${index}`));
      curse = available[seed % available.length];
    } else {
      curse = `the jar opened a new chapter (${used.size + 1})`;
    }
    used.add(curse);
    return { ...tx, curse };
  });
};

const stampToday = () => {
  setText("balance-updated", dateFmt.format(new Date()));
};

const scheduleMidnightStamp = () => {
  const now = new Date();
  const next = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    2
  );
  window.setTimeout(() => {
    stampToday();
    scheduleMidnightStamp();
  }, next.getTime() - now.getTime());
};

const txWhen = (tx, index) => {
  const stamped = Date.parse(tx.at || "");
  if (!Number.isNaN(stamped)) return stamped;
  const parts = String(tx.date || "").split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return index;
  // Noon Pacific, plus ledger order, when a payment has no clock time.
  return Date.UTC(parts[0], parts[1] - 1, parts[2], 19, 0, 0) + index;
};

const clockFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: JAR_TZ,
  hour: "numeric",
  minute: "2-digit",
});

const ymdInJar = (date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: JAR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const calendarDaysBetween = (then, now) => {
  const a = Date.parse(`${ymdInJar(then)}T00:00:00Z`);
  const b = Date.parse(`${ymdInJar(now)}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86400000));
};

const quietLabel = (days) => {
  if (days <= 0) return "Paid today";
  if (days === 1) return "1 day quiet";
  return `${days} days quiet`;
};

let latestShameTx = null;

const wrapCanvasText = (ctx, text, x, y, maxWidth, lineHeight) => {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  let line = "";
  let top = y;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      ctx.fillText(line, x, top);
      line = word;
      top += lineHeight;
    } else {
      line = next;
    }
  }
  if (line) ctx.fillText(line, x, top);
  return top;
};

const pngFileFromDataUrl = (dataUrl, filename) => {
  const comma = dataUrl.indexOf(",");
  const binary = atob(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], filename, { type: "image/png" });
};

const showShameSaveSheet = (url) => {
  const sheet = document.getElementById("shame-save");
  const img = document.getElementById("shame-save-img");
  if (!sheet || !img) {
    window.open(url, "_blank", "noopener");
    return;
  }
  img.src = url;
  sheet.classList.add("is-open");
  sheet.hidden = false;
};

const hideShameSaveSheet = () => {
  const sheet = document.getElementById("shame-save");
  const img = document.getElementById("shame-save-img");
  if (sheet) {
    sheet.classList.remove("is-open");
    sheet.hidden = true;
  }
  if (img?.src?.startsWith("blob:")) URL.revokeObjectURL(img.src);
  if (img) img.removeAttribute("src");
};

const savePngFile = (file, filename) => {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  const mobile =
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Mac/i.test(navigator.platform || ""));
  if (mobile) showShameSaveSheet(url);
  else window.setTimeout(() => URL.revokeObjectURL(url), 4000);
};

const downloadShameCertificate = (tx) => {
  const width = 1080;
  const height = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "#0c0b0a";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(212, 180, 131, 0.45)";
  ctx.lineWidth = 4;
  ctx.strokeRect(48, 48, width - 96, height - 96);
  ctx.strokeRect(68, 68, width - 136, height - 136);

  ctx.fillStyle = "#d4b483";
  ctx.font = "500 28px 'IBM Plex Mono', monospace";
  ctx.textAlign = "center";
  ctx.fillText("HOUSEHOLD CURSE TAX", width / 2, 180);

  ctx.fillStyle = "#f3eee6";
  ctx.font = "italic 72px 'Instrument Serif', Georgia, serif";
  ctx.fillText("Certificate of shame", width / 2, 290);

  ctx.fillStyle = "#9a9288";
  ctx.font = "500 22px 'IBM Plex Mono', monospace";
  ctx.fillText("ISSUED TO", width / 2, 400);

  ctx.fillStyle = "#f3eee6";
  ctx.font = "italic 96px 'Instrument Serif', Georgia, serif";
  ctx.fillText(firstName(tx.from), width / 2, 520);

  ctx.fillStyle = "#d4b483";
  ctx.font = "400 64px 'Instrument Serif', Georgia, serif";
  ctx.fillText(money.format(Math.abs(Number(tx.amount) || 0)), width / 2, 640);

  ctx.fillStyle = "#9a9288";
  ctx.font = "italic 36px 'Instrument Serif', Georgia, serif";
  wrapCanvasText(ctx, tx.curse || "caught in 4K", width / 2, 760, 820, 48);

  ctx.fillStyle = "#d4b483";
  ctx.font = "500 24px 'IBM Plex Mono', monospace";
  ctx.fillText(formatWhen(tx).toUpperCase(), width / 2, 1180);
  ctx.fillStyle = "#9a9288";
  ctx.fillText("balance.piotrjandura.com", width / 2, 1232);

  const filename = `shame-${firstName(tx.from).toLowerCase()}.png`;
  const file = pngFileFromDataUrl(canvas.toDataURL("image/png"), filename);
  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], title: "Certificate of shame" }).catch((err) => {
      if (err?.name === "AbortError") return;
      savePngFile(file, filename);
    });
    return;
  }
  savePngFile(file, filename);
};

const byTimeThenDate = (a, b) => {
  const delta = txWhen(b.tx, b.index) - txWhen(a.tx, a.index);
  return delta || b.index - a.index;
};

const render = (data) => {
  const txs = [...(data.transactions || [])]
    .map((tx, index) => ({ tx, index }))
    .filter(({ tx }) => tx.type !== "sent")
    .sort(byTimeThenDate)
    .map(({ tx }) => tx);
  const start = Number(data.startingBalance) || 0;
  const inTotal = txs.reduce(
    (sum, tx) => sum + Math.abs(Number(tx.amount) || 0),
    0
  );
  const balance = start + inTotal;
  const now = new Date();

  setText("balance-amount", money.format(balance));
  setText("stat-in", money.format(inTotal));
  setText("stat-curses", String(Math.floor(Number(balance.toFixed(2)))));
  setText("stat-count", String(txs.length));
  document.title = `Household curse tax · ${money.format(balance)}`;

  const last = txs[0];
  latestShameTx = last || null;
  const spoken = document.getElementById("last-curse");
  const streaks = document.getElementById("jar-streaks");
  const cert = document.getElementById("shame-cert");
  if (last && spoken) {
    const at = Date.parse(last.at || "");
    const when = Number.isNaN(at)
      ? formatDay(last.date)
      : clockFmt.format(new Date(at));
    spoken.hidden = false;
    spoken.textContent = `${firstName(last.from)}, ${when}`;
  } else if (spoken) {
    spoken.hidden = true;
    spoken.textContent = "";
  }
  if (last && streaks) {
    streaks.hidden = false;
    const lastAt = new Date(txWhen(last, 0));
    setText(
      "streak-days",
      `${firstName(last.from)} · ${quietLabel(calendarDaysBetween(lastAt, now))}`
    );
    const latestByPerson = new Map();
    txs.forEach((tx, index) => {
      const name = firstName(tx.from);
      if (!latestByPerson.has(name)) {
        latestByPerson.set(name, new Date(txWhen(tx, index)));
      }
    });
    let quietest = null;
    for (const [name, at] of latestByPerson) {
      const days = calendarDaysBetween(at, now);
      if (!quietest || days > quietest.days) quietest = { name, days };
    }
    setText(
      "streak-quiet",
      quietest ? `${quietest.name} · ${quietLabel(quietest.days)}` : "—"
    );
  } else if (streaks) {
    streaks.hidden = true;
  }
  if (cert) cert.hidden = !last;

  renderBoard(
    "board-week",
    rankPeople(txs.filter((tx) => inThisWeek(parseTxDate(tx.date), now)))
  );
  renderBoard(
    "board-month",
    rankPeople(txs.filter((tx) => inThisMonth(parseTxDate(tx.date), now)))
  );
  renderBoard("board-all", rankPeople(txs));

  const list = document.getElementById("tx-list");
  const empty = document.getElementById("tx-empty");
  if (!list) return;

  list.replaceChildren();

  if (!txs.length) {
    empty?.removeAttribute("hidden");
    latestShameTx = null;
    return;
  }

  empty?.setAttribute("hidden", "");

  for (const tx of txs) {
    const amount = Math.abs(Number(tx.amount) || 0);
    const row = document.createElement("li");
    row.className = "balance-row";

    const who = document.createElement("div");
    who.className = "balance-who";
    const name = document.createElement("strong");
    name.textContent = firstName(tx.from);
    const meta = document.createElement("span");
    meta.textContent = `${formatWhen(tx)} · ${tx.curse}`;
    who.append(name, meta);

    const amt = document.createElement("div");
    amt.className = "balance-amt is-in";
    amt.textContent = `+${money.format(amount)}`;

    const dir = document.createElement("span");
    dir.className = "balance-dir";
    dir.textContent = /^bank transfer$/i.test(firstName(tx.from))
      ? "added"
      : "fined";

    row.append(who, dir, amt);
    list.append(row);
  }
};

const fail = () => {
  setText("balance-amount", "—");
  setText("balance-updated", "Could not load the jar");
};

stampToday();
scheduleMidnightStamp();
document.getElementById("shame-cert")?.addEventListener("click", () => {
  if (latestShameTx) downloadShameCertificate(latestShameTx);
});
document.getElementById("shame-save-close")?.addEventListener("click", hideShameSaveSheet);
document.getElementById("shame-save")?.addEventListener("click", (event) => {
  if (event.target === event.currentTarget) hideShameSaveSheet();
});

const NOTE_COLORS = ["butter", "pink", "mint", "sky"];
const tilts = ["-2.4deg", "1.8deg", "-1.1deg", "2.6deg", "-3deg", "1.2deg"];

const NOTES_API_DEFAULT =
  "https://script.google.com/macros/s/AKfycbxTu3jAM4y1vc28SDAaxhGo9o-rOw_MOFCrzmlZY4Rl8PLx1hpvAP58rVkwJ_gdKe60/exec";

let notesState = [];
let notesApi = NOTES_API_DEFAULT;
let saveTimer = 0;
let thisDevice = "unknown";
let thisDeviceId = "";

const setNotesHint = (text) => {
  const hint = document.getElementById("notes-hint");
  if (hint) hint.textContent = text;
};

const deviceFromUA = () => {
  const ua = navigator.userAgent || "";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) {
    return "iPad";
  }
  if (/Android/i.test(ua)) return "Android";
  if (/CrOS/i.test(ua)) return "Chromebook";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Mac/i.test(ua)) return "Mac";
  if (/Linux/i.test(ua)) return "Linux";
  return "unknown";
};

const loadDeviceId = () => {
  const key = "swear-jar-device-id";
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing.slice(0, 80);
    const id = `d-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
    localStorage.setItem(key, id);
    return id;
  } catch {
    return `d-session-${Math.random().toString(16).slice(2, 10)}`;
  }
};

const detectDevice = async () => {
  thisDeviceId = loadDeviceId();
  thisDevice = deviceFromUA();
  try {
    const hints = navigator.userAgentData;
    if (!hints?.getHighEntropyValues) return;
    const info = await hints.getHighEntropyValues(["model", "platform"]);
    const model = String(info.model || "").trim();
    if (model) thisDevice = model.slice(0, 40);
    else if (/mac/i.test(info.platform || "")) thisDevice = "Mac";
    else if (/win/i.test(info.platform || "")) thisDevice = "Windows";
    else if (/android/i.test(info.platform || "")) thisDevice = "Android";
  } catch {
    /* keep UA guess */
  }
};

const noteLog = () => ({
  at: new Date().toISOString(),
  device: thisDevice,
  deviceId: thisDeviceId,
  ua: String(navigator.userAgent || "").slice(0, 300),
  platform: String(navigator.platform || "").slice(0, 80),
  lang: String(navigator.language || "").slice(0, 20),
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
  screen: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
});

const newNote = (text = "") => ({
  id: `n-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  text,
  color: NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)],
});

const jsonpNotes = (url, timeoutMs = 15000) =>
  new Promise((resolve, reject) => {
    const cb = "sjNotes_" + Math.random().toString(36).slice(2);
    const script = document.createElement("script");
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timeout"));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
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
      reject(new Error("jsonp"));
    };
    document.head.append(script);
  });

const postNotesIframe = (notes) =>
  new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.name = "sj-fridge";
    iframe.hidden = true;
    const form = document.createElement("form");
    form.method = "POST";
    form.action = notesApi;
    form.target = "sj-fridge";
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "notes";
    input.value = JSON.stringify(notes);
    form.append(input);
    let loads = 0;
    iframe.addEventListener("load", () => {
      loads += 1;
      if (loads < 2) return;
      form.remove();
      iframe.remove();
      resolve(true);
    });
    document.body.append(iframe, form);
    form.submit();
    window.setTimeout(() => {
      form.remove();
      iframe.remove();
      resolve(true);
    }, 4000);
  });

const persistNotes = async (notes) => {
  if (!notesApi) {
    setNotesHint("Notes are on the site after the fridge API is connected.");
    return false;
  }
  await postNotesIframe(notes);
  setNotesHint("Click a note to write. Everyone sees the same fridge.");
  return true;
};

const queueSave = (notes) => {
  notesState = notes;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    persistNotes(notesState);
  }, 800);
};

const paintNotes = (notes) => {
  const wall = document.getElementById("sticky-wall");
  if (!wall) return;
  notesState = notes;
  wall.replaceChildren();
  notes.forEach((note, i) => {
    const card = document.createElement("article");
    card.className = `sticky sticky-${note.color || "butter"}`;
    card.style.setProperty("--tilt", tilts[i % tilts.length]);

    const body = document.createElement("div");
    body.className = "sticky-body";
    body.contentEditable = "plaintext-only";
    if (body.contentEditable !== "plaintext-only") body.contentEditable = "true";
    body.spellcheck = true;
    body.dataset.id = note.id;
    body.innerHTML = escapeSticky(note.text);
    body.setAttribute("role", "textbox");
    body.setAttribute("aria-label", "Sticky note");

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "sticky-x";
    remove.setAttribute("aria-label", "Throw this note away");
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      const next = notesState.filter((n) => n.id !== note.id);
      paintNotes(next);
      persistNotes(next);
    });

    body.addEventListener("input", () => {
      const match = notesState.find((n) => n.id === note.id);
      if (match) {
        match.text = body.innerText;
        match.log = noteLog();
      }
      queueSave(notesState);
    });

    card.append(remove, body);
    wall.append(card);
  });
};

const escapeSticky = (text) =>
  String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

const notesScore = (notes) => {
  if (!Array.isArray(notes) || !notes.length) return -1;
  return notes.reduce((sum, note) => sum + String(note.text || "").trim().length, 0) + notes.length;
};

const pickRichestNotes = (candidates) => {
  let best = [];
  let bestScore = -1;
  for (const notes of candidates) {
    const score = notesScore(notes);
    if (score > bestScore) {
      best = notes;
      bestScore = score;
    }
  }
  return best;
};

const loadNotesFromGithub = async () => {
  const res = await fetch(
    "https://api.github.com/repos/scrunchuies/balance.piotrjandura.com/contents/notes.json",
    {
      cache: "no-store",
      headers: { Accept: "application/vnd.github.raw+json" },
    }
  );
  if (!res.ok) throw new Error(String(res.status));
  const data = await res.json();
  if (Array.isArray(data)) return data;
  if (data && data.content) {
    const parsed = JSON.parse(atob(String(data.content).replace(/\n/g, "")));
    return Array.isArray(parsed) ? parsed : [];
  }
  return [];
};

const loadSharedNotes = async () => {
  try {
    const cfg = await fetch(`./notes-api.json?v=2&t=${Date.now()}`, {
      cache: "no-store",
    }).then((res) => (res.ok ? res.json() : {}));
    notesApi = String(cfg.url || "").trim() || NOTES_API_DEFAULT;
  } catch {
    notesApi = NOTES_API_DEFAULT;
  }

  const found = [];
  if (notesApi) {
    try {
      const live = await jsonpNotes(notesApi);
      if (Array.isArray(live) && live.length) found.push(live);
    } catch {
      /* try other sources */
    }
  }

  try {
    found.push(await loadNotesFromGithub());
  } catch {
    /* Pages next */
  }

  try {
    const seed = await fetch(`./notes.json?t=${Date.now()}`, {
      cache: "no-store",
    }).then((res) => (res.ok ? res.json() : []));
    if (Array.isArray(seed)) found.push(seed);
  } catch {
    /* ignore */
  }

  return pickRichestNotes(found);
};

const setupNotes = async () => {
  await detectDevice();
  let notes = await loadSharedNotes();
  if (!notes.length) notes = [newNote("")];
  paintNotes(notes);
  setNotesHint(
    notesApi
      ? "Click a note to write. Everyone sees the same fridge."
      : "Click a note to write. Connect the fridge API to save for everyone."
  );
  document.getElementById("notes-add")?.addEventListener("click", () => {
    const next = [...notesState, newNote("")];
    paintNotes(next);
    persistNotes(next);
  });
};

let cursePool = [];

const fetchLedgerJson = async () => {
  const t = Date.now();
  try {
    const github = await fetch(
      `https://api.github.com/repos/scrunchuies/balance.piotrjandura.com/contents/transactions.json?ref=main&t=${t}`,
      {
        cache: "no-store",
        headers: { Accept: "application/vnd.github.raw+json" },
      }
    );
    if (github.ok) return github.json();
  } catch {
    /* Pages copy next */
  }
  const res = await fetch(`./transactions.json?t=${t}`, { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
};

const loadLedger = async () => {
  const data = await fetchLedgerJson();
  if (!cursePool.length) {
    try {
      const linesRes = await fetch(`./curse-lines.json?t=${Date.now()}`, {
        cache: "no-store",
      });
      if (linesRes.ok) cursePool = await linesRes.json();
    } catch {
      cursePool = [];
    }
  }
  render({
    ...data,
    transactions: assignCurses(data.transactions || [], cursePool),
  });
};

const ensureNotesApi = async () => {
  if (notesApi) return notesApi;
  try {
    const cfg = await fetch(`./notes-api.json?v=2&t=${Date.now()}`, {
      cache: "no-store",
    }).then((res) => (res.ok ? res.json() : {}));
    notesApi = String(cfg.url || "").trim() || NOTES_API_DEFAULT;
  } catch {
    notesApi = NOTES_API_DEFAULT;
  }
  return notesApi;
};

const postIngest = (url) =>
  new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.name = "sj-ingest";
    iframe.hidden = true;
    const form = document.createElement("form");
    form.method = "POST";
    form.action = url;
    form.target = "sj-ingest";
    const ingest = document.createElement("input");
    ingest.type = "hidden";
    ingest.name = "ingest";
    ingest.value = "1";
    const notes = document.createElement("input");
    notes.type = "hidden";
    notes.name = "notes";
    notes.value = JSON.stringify(Array.isArray(notesState) ? notesState : []);
    form.append(ingest, notes);
    document.body.append(iframe, form);
    form.submit();
    window.setTimeout(() => {
      form.remove();
      iframe.remove();
      resolve(true);
    }, 12000);
  });

const triggerIngest = async () => {
  const url = await ensureNotesApi();
  if (!url) return;
  await postIngest(url);
};

const refreshLedgerNow = async () => {
  const btn = document.getElementById("ledger-refresh");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Refreshing…";
  }
  try {
    try {
      await triggerIngest();
    } catch {
      /* still reload the ledger from GitHub */
    }
    await loadLedger();
    if (btn) btn.textContent = "Updated";
  } catch {
    if (btn) btn.textContent = "Retry";
  } finally {
    window.setTimeout(() => {
      if (!btn) return;
      btn.disabled = false;
      btn.textContent = "Refresh now";
    }, 1800);
  }
};

loadLedger().catch(fail);
setupNotes();
document.getElementById("ledger-refresh")?.addEventListener("click", () => {
  refreshLedgerNow();
});
