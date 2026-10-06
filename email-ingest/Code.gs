/**
 * Venmo → balance.piotrjandura.com
 *
 * 1. Create a Gmail inbox that will receive forwarded Venmo mail
 *    (a dedicated Gmail is fine).
 * 2. iCloud.com → Mail → Settings → Rules → Add a Rule:
 *    Message is from "venmo.com" → Forward to that Gmail.
 * 3. Venmo app → Settings → Notifications → turn on payment emails.
 * 4. https://script.google.com → New project → paste this file.
 * 5. Project Settings → Script properties:
 *      GITHUB_TOKEN  = a fine-grained PAT with Contents: Read and write
 *                      on scrunchuies/balance.piotrjandura.com
 *      SELF_NAME       = Piotr   (optional; who “You paid” should be billed as)
 *      JAR_PAYEE_NAMES = comma list of Venmo names for the jar account
 *                        (default: swear jar,swearjar,jar,piotr,piotr jandura)
 *    A Venmo note like "name: jeff" (also Name: / NAME:) bills that person
 *    instead of the Venmo sender. No name: keeps the sender.
 *      GROWTH_PASSWORD = shared password for the private vault page
 *                        (not your Fidelity password)
 *      SNAPTRADE_CLIENT_ID / SNAPTRADE_CONSUMER_KEY
 *                      = Personal API key from https://snaptrade.com/personal
 *      SNAPTRADE_BROKER = optional portal slug (default FIDELITY)
 *    Vault: sign in on /growth/, press Connect Fidelity, approve read-only
 *    access on Fidelity's site. Optional trigger: snapshotBrokerage, daily
 *    2–3 PM Pacific, to log the closing value even when nobody opens the page.

 * 6. Run ingestVenmo once, approve Gmail + external-request access.
 *    To rebuild the whole jar from mail (after deleting the JSON/labels):
 *    run rebuildLedgerFromMail once, then check the execution log for the total.
 * 7. Triggers → Add trigger → ingestVenmo → Time-driven → Every 5 minutes.
 * 8. Fridge notes (shared): Deploy → New deployment → Web app.
 *    Execute as: Me. Who has access: Anyone.
 *    Paste that URL into NOTES_API in app.js, then ship the site.
 *
 * Do not enable Cloudflare Email Routing on piotrjandura.com. That would
 * replace the iCloud MX records and break existing mail.
 */

const DEFAULT_REPO = "scrunchuies/balance.piotrjandura.com";
const FILE_PATH = "transactions.json";
const NOTES_PATH = "notes.json";
const CURSE_PATH = "curse-lines.json";
const PROCESSED_LABEL = "ledger-logged";
const SKIPPED_LABEL = "ledger-skipped";
const NOTE_COLORS = { butter: true, pink: true, mint: true, sky: true };
const MAIL_QUERY =
  '(from:venmo.com OR subject:"paid you" OR subject:"You received" OR subject:"You paid" OR subject:"transfer of $")';

function ingestVenmo() {
  const token = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
  if (!token) throw new Error("Set script property GITHUB_TOKEN");

  const processed = getOrCreateLabel(PROCESSED_LABEL);
  const skipped = getOrCreateLabel(SKIPPED_LABEL);
  // Gmail labels apply to the whole thread. Do not exclude ledger-logged
  // threads or a new $1 in an old Venmo conversation is never seen.
  const query = MAIL_QUERY + " newer_than:14d";
  const threads = GmailApp.search(query, 0, 50);
  const seen = loadLoggedIds(token);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    for (const thread of threads) {
      let logged = false;
      for (const message of thread.getMessages()) {
        const id = message.getId();
        if (seen[id]) {
          logged = true;
          continue;
        }

        const parsed = parseVenmoEmail({
          subject: message.getSubject(),
          text: message.getPlainBody() || message.getBody() || "",
        });

        const deposit = asJarDeposit(parsed);
        if (!deposit) continue;

        appendTransaction(token, {
          id: id,
          date: Utilities.formatDate(
            message.getDate(),
            "America/Los_Angeles",
            "yyyy-MM-dd"
          ),
          at: message.getDate().toISOString(),
          type: "received",
          from: deposit.from || "",
          to: "",
          amount: deposit.amount,
          note: "",
          viaSent: parsed.type === "sent",
        });
        seen[id] = true;
        logged = true;
        thread.addLabel(processed);
        thread.removeLabel(skipped);
      }
      if (!logged) thread.addLabel(skipped);
    }
  } finally {
    lock.releaseLock();
  }
}

function collectJarDepositsFromMail() {
  const seenMsg = {};
  const candidates = [];
  var start = 0;
  while (start < 2000) {
    const threads = GmailApp.search(MAIL_QUERY, start, 100);
    if (!threads.length) break;
    for (var t = 0; t < threads.length; t++) {
      const thread = threads[t];
      const messages = thread.getMessages();
      for (var m = 0; m < messages.length; m++) {
        const message = messages[m];
        const id = message.getId();
        if (seenMsg[id]) continue;
        seenMsg[id] = true;
        const parsed = parseVenmoEmail({
          subject: message.getSubject(),
          text: message.getPlainBody() || message.getBody() || "",
        });
        const deposit = asJarDeposit(parsed);
        if (!deposit) continue;
        candidates.push({
          id: id,
          date: Utilities.formatDate(
            message.getDate(),
            "America/Los_Angeles",
            "yyyy-MM-dd"
          ),
          at: message.getDate().toISOString(),
          type: "received",
          from: deposit.from || "",
          to: "",
          amount: deposit.amount,
          note: "",
          viaSent: parsed.type === "sent",
          thread: thread,
        });
      }
    }
    start += threads.length;
    if (threads.length < 100) break;
  }
  return candidates;
}

function isNearDuplicate(rows, tx) {
  const at = Date.parse(tx.at || "");
  for (var i = 0; i < (rows || []).length; i++) {
    const row = rows[i];
    if (!sameDeposit(row, tx)) continue;
    const other = Date.parse(row.at || "");
    if (!isNaN(at) && !isNaN(other) && Math.abs(at - other) < 45000) return true;
  }
  return false;
}

function dedupeJarDeposits(candidates) {
  const received = [];
  const sent = [];
  for (var i = 0; i < candidates.length; i++) {
    if (candidates[i].viaSent) sent.push(candidates[i]);
    else received.push(candidates[i]);
  }
  received.sort(function (a, b) {
    return String(a.at).localeCompare(String(b.at));
  });
  sent.sort(function (a, b) {
    return String(a.at).localeCompare(String(b.at));
  });
  const kept = [];
  for (var r = 0; r < received.length; r++) {
    if (isNearDuplicate(kept, received[r])) continue;
    kept.push(received[r]);
  }
  for (var s = 0; s < sent.length; s++) {
    const tx = sent[s];
    if (kept.some(function (row) { return sameDeposit(row, tx); })) continue;
    if (isNearDuplicate(kept, tx)) continue;
    kept.push(tx);
  }
  kept.sort(function (a, b) {
    return String(a.at).localeCompare(String(b.at));
  });
  return kept;
}

function rebuildLedgerFromMail() {
  const token = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
  if (!token) throw new Error("Set script property GITHUB_TOKEN");

  const processed = getOrCreateLabel(PROCESSED_LABEL);
  const skipped = getOrCreateLabel(SKIPPED_LABEL);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const kept = dedupeJarDeposits(collectJarDepositsFromMail());
    const pool = loadCursePool(token);
    const used = {};
    const rows = [];
    for (var i = 0; i < kept.length; i++) {
      const tx = kept[i];
      var curse = "";
      for (var p = 0; p < pool.length; p++) {
        if (!used[pool[p]]) {
          curse = pool[p];
          break;
        }
      }
      if (!curse) curse = "the jar opened a new chapter (" + (i + 1) + ")";
      used[curse] = true;
      rows.push({
        id: tx.id,
        date: tx.date,
        at: tx.at,
        type: "received",
        from: tx.from,
        to: "",
        amount: tx.amount,
        note: "",
        curse: curse,
      });
      if (tx.thread) {
        tx.thread.addLabel(processed);
        tx.thread.removeLabel(skipped);
      }
    }

    const json = {
      asOf: rows.reduce(function (latest, row) {
        return !latest || String(row.date) > String(latest) ? row.date : latest;
      }, ""),
      startingBalance: 0,
      currency: "USD",
      ignoredIds: [],
      transactions: rows,
    };
    replaceLedger(token, json, "Rebuild jar ledger from Venmo email.");

    var total = 0;
    for (var n = 0; n < rows.length; n++) total += Math.abs(Number(rows[n].amount) || 0);
    Logger.log(
      "Rebuilt " + rows.length + " fines totaling $" + total.toFixed(2) + "."
    );
  } finally {
    lock.releaseLock();
  }
}

function getOrCreateLabel(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function selfPayerName() {
  return (
    PropertiesService.getScriptProperties().getProperty("SELF_NAME") || "Piotr"
  );
}

function jarPayeeNames() {
  const raw =
    PropertiesService.getScriptProperties().getProperty("JAR_PAYEE_NAMES") ||
    "swear jar,swearjar,jar,piotr,piotr jandura";
  return raw
    .split(",")
    .map(function (name) {
      return name.replace(/^@/, "").replace(/\s+/g, " ").trim().toLowerCase();
    })
    .filter(Boolean);
}

function isJarPayee(name) {
  const payee = String(name || "")
    .replace(/^@/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!payee) return false;
  const names = jarPayeeNames();
  if (names.indexOf(payee) !== -1) return true;
  return names.indexOf(payee.split(" ")[0]) !== -1;
}

function isJarAccountName(name) {
  const token = firstName(name).toLowerCase();
  return token === "swear" || token === "swearjar" || token === "jar";
}

function asJarDeposit(parsed) {
  if (!parsed || !parsed.amount) return null;
  const named = firstName(parsed.commentName || "");
  if (parsed.type === "received") {
    if (!named && isJarAccountName(parsed.from)) return null;
    if (/^bank transfer$/i.test(firstName(parsed.from))) return null;
    if (named) {
      const copy = {};
      for (const key in parsed) copy[key] = parsed[key];
      copy.from = named;
      return copy;
    }
    return parsed;
  }
  if (parsed.type === "sent" && isJarPayee(parsed.to)) {
    return {
      type: "received",
      from: named || firstName(selfPayerName()),
      amount: parsed.amount,
    };
  }
  return null;
}

function isGmailMessageId(id) {
  return /^[0-9a-f]{16}$/i.test(String(id || ""));
}

function sameDeposit(row, tx) {
  if (String(row.date) !== String(tx.date)) return false;
  if (firstName(row.from) !== firstName(tx.from)) return false;
  return Math.abs(Number(row.amount) - Number(tx.amount)) <= 0.001;
}

function isDuplicateDeposit(rows, tx, viaSent) {
  if ((rows || []).some(function (row) { return row.id === tx.id; })) return true;
  if (isJarAccountName(tx.from)) return true;
  const matches = (rows || []).filter(function (row) {
    return sameDeposit(row, tx);
  });
  if (!matches.length) return false;
  // "You paid the jar" is the same fine as "Piotr paid you" that day.
  if (viaSent) return true;
  // Gmail re-import of a row that already has a Venmo/PayPal id.
  if (isGmailMessageId(tx.id) && matches.some(function (row) { return !isGmailMessageId(row.id); })) {
    return true;
  }
  return false;
}

function loadLoggedIds(token) {
  const repo =
    PropertiesService.getScriptProperties().getProperty("GITHUB_REPO") || DEFAULT_REPO;
  const url = "https://api.github.com/repos/" + repo + "/contents/" + FILE_PATH;
  const res = UrlFetchApp.fetch(url, {
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "User-Agent": "venmo-ledger-ingest",
    },
    muteHttpExceptions: true,
  });
  const current = JSON.parse(res.getContentText());
  if (res.getResponseCode() === 404 || !current.content) return {};
  const json = JSON.parse(
    Utilities.newBlob(Utilities.base64Decode(current.content.replace(/\n/g, ""))).getDataAsString()
  );
  const seen = {};
  (json.transactions || []).forEach(function (row) {
    if (row && row.id) seen[row.id] = true;
  });
  (json.ignoredIds || []).forEach(function (id) {
    if (id) seen[id] = true;
  });
  return seen;
}

function rememberIgnoredId(json, id) {
  json.ignoredIds = json.ignoredIds || [];
  if (id && json.ignoredIds.indexOf(id) === -1) json.ignoredIds.push(id);
}

function writeLedger(url, headers, json, sha, message) {
  const payload = {
    message: message,
    content: Utilities.base64Encode(
      JSON.stringify(json, null, 2) + "\n",
      Utilities.Charset.UTF_8
    ),
    branch: "main",
  };
  if (sha) payload.sha = sha;
  return UrlFetchApp.fetch(url, {
    method: "put",
    contentType: "application/json",
    headers: headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
}

function replaceLedger(token, json, message) {
  const repo =
    PropertiesService.getScriptProperties().getProperty("GITHUB_REPO") || DEFAULT_REPO;
  const url = "https://api.github.com/repos/" + repo + "/contents/" + FILE_PATH;
  const headers = {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
    "User-Agent": "venmo-ledger-ingest",
  };
  const current = UrlFetchApp.fetch(url, {
    headers: headers,
    muteHttpExceptions: true,
  });
  const code = current.getResponseCode();
  var sha = "";
  if (code === 200) {
    const parsed = JSON.parse(current.getContentText());
    sha = parsed.sha || "";
  } else if (code !== 404) {
    throw new Error("Could not read transactions.json (" + code + "): " + current.getContentText());
  }
  const res = writeLedger(url, headers, json, sha, message);
  const out = res.getResponseCode();
  if (out !== 200 && out !== 201) {
    throw new Error("GitHub replace failed (" + out + "): " + res.getContentText());
  }
}

function appendTransaction(token, tx) {
  const repo =
    PropertiesService.getScriptProperties().getProperty("GITHUB_REPO") || DEFAULT_REPO;
  const url = "https://api.github.com/repos/" + repo + "/contents/" + FILE_PATH;
  const headers = {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
    "User-Agent": "venmo-ledger-ingest",
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const current = JSON.parse(
      UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true }).getContentText()
    );
    if (!current.content || !current.sha) {
      const created = writeLedger(
        url,
        headers,
        {
          asOf: "",
          startingBalance: 0,
          currency: "USD",
          ignoredIds: [],
          transactions: [],
        },
        "",
        "Create jar ledger."
      );
      const createdCode = created.getResponseCode();
      if (createdCode !== 200 && createdCode !== 201) {
        throw new Error("Could not read transactions.json: " + JSON.stringify(current));
      }
      continue;
    }

    const json = JSON.parse(
      Utilities.newBlob(Utilities.base64Decode(current.content.replace(/\n/g, ""))).getDataAsString()
    );
    json.transactions = json.transactions || [];
    json.ignoredIds = json.ignoredIds || [];
    const viaSent = Boolean(tx.viaSent);
    delete tx.viaSent;
    if (json.ignoredIds.indexOf(tx.id) !== -1) return;
    if (json.transactions.some(function (row) { return row.id === tx.id; })) return;
    if (isDuplicateDeposit(json.transactions, tx, viaSent)) {
      rememberIgnoredId(json, tx.id);
      Logger.log("Skip duplicate Venmo mail, not added to the jar: " + tx.id);
      const skipRes = writeLedger(
        url,
        headers,
        json,
        current.sha,
        "Ignore duplicate Venmo email."
      );
      const skipCode = skipRes.getResponseCode();
      if (skipCode === 200 || skipCode === 201) return;
      if (skipCode !== 409 && skipCode !== 422) {
        throw new Error("GitHub update failed (" + skipCode + "): " + skipRes.getContentText());
      }
      continue;
    }

    tx.curse = pickUnusedCurse(token, json.transactions);
    json.transactions.push(tx);
    json.asOf = json.transactions.reduce(function (latest, row) {
      return !latest || String(row.date) > String(latest) ? row.date : latest;
    }, json.asOf || "");

    const res = writeLedger(
      url,
      headers,
      json,
      current.sha,
      "Log Venmo " + tx.type + " from email."
    );
    const code = res.getResponseCode();
    if (code === 200 || code === 201) return;
    if (code !== 409 && code !== 422) {
      throw new Error("GitHub update failed (" + code + "): " + res.getContentText());
    }
  }

  throw new Error("GitHub update collided three times");
}

function parseVenmoEmail(input) {
  const subject = (input && input.subject) || "";
  const text = (input && input.text) || "";
  const cleaned = stripSubject(subject);
  const body = String(text).replace(/<[^>]+>/g, " ");
  const haystack = (cleaned + "\n" + body).slice(0, 8000);
  const skip = [
    /is requesting/i,
    /requested \$/i,
    /wants \$/i,
    /charge request/i,
    /unfinished payment/i,
    /verify your/i,
    /reset your password/i,
    /weekly summary/i,
    /transaction history/i,
    /security (code|alert)/i,
  ];
  if (skip.some(function (re) { return re.test(haystack); })) {
    const completed =
      /(?:paid|payed|sent) you(?:r)? \$/i.test(cleaned) ||
      /^you received \$/i.test(cleaned);
    if (!completed) return null;
  }

  const money = "\\$([0-9]{1,3}(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?|[0-9]+(?:\\.[0-9]{1,2})?)";
  let m = cleaned.match(new RegExp("you received " + money + " from (.+?)(?:\\s+on venmo)?$", "i"));
  if (m) return pack("received", m[1], m[2], "", body, cleaned);
  m = cleaned.match(new RegExp("^(.+?) (?:paid|payed|sent) your " + money + " request", "i"));
  if (m) return pack("received", m[2], m[1], "", body, cleaned);
  m = cleaned.match(new RegExp("^(.+?) (?:paid|payed|sent) you " + money + "(?:\\b|\\s|$)", "i"));
  if (m) return pack("received", m[2], m[1], "", body, cleaned);
  m = haystack.match(new RegExp("([A-Za-z][A-Za-z .'-]{0,60}?) (?:paid|payed|sent) you " + money, "i"));
  if (m) return pack("received", m[2], m[1], "", body, cleaned);
  m = cleaned.match(new RegExp("you added " + money + "(?: to(?: your)? venmo(?: balance| account)?)?", "i"));
  if (m) return pack("received", m[1], "Bank transfer", "", body, cleaned);
  m = cleaned.match(new RegExp("(?:your )?(?:bank )?transfer of " + money + ".*from", "i"));
  if (m) return pack("received", m[1], "Bank transfer", "", body, cleaned);
  m = cleaned.match(new RegExp("you (?:paid|payed|sent) (.+?) " + money + "(?:\\b|\\s|$)", "i"));
  if (m) return pack("sent", m[2], "", m[1], body, cleaned);
  m = cleaned.match(new RegExp("you (?:paid|sent) " + money + " to (.+)$", "i"));
  if (m) return pack("sent", m[1], "", m[2], body, cleaned);
  m = cleaned.match(new RegExp("(?:your )?transfer of " + money + ".*(?:to (?:your )?bank|cashed out)", "i"));
  if (m) return pack("sent", m[1], "", "Bank transfer", body, cleaned);
  m = cleaned.match(new RegExp("(?:your )?transfer of " + money + " is complete", "i"));
  if (m) return pack("received", m[1], "Bank transfer", "", body, cleaned);
  return null;
}

function pack(type, amountRaw, from, to, body, cleaned) {
  const amount = Number(String(amountRaw).replace(/,/g, ""));
  if (!amount || isNaN(amount)) return null;
  const noteMatch =
    body.match(/(?:note|for|memo)[:\s]+(.{1,80})/i) ||
    cleaned.match(/\s[—–-]\s+(.{1,80})$/);
  const note = noteMatch ? cleanName(noteMatch[1]) : "";
  const commentName = firstName(extractCommentName(note + "\n" + body + "\n" + cleaned));
  return {
    type: type,
    amount: amount,
    from: type === "received" && commentName ? commentName : firstName(from),
    to: firstName(to),
    note: note,
    commentName: commentName,
  };
}

function stripSubject(subject) {
  return String(subject || "")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[＄]/g, "$")
    .replace(/^(?:(?:fwd|fw|re|aw|sv)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanName(raw) {
  return String(raw || "")
    .replace(/\s+on venmo\s*$/i, "")
    .replace(/\s+via venmo\s*$/i, "")
    .replace(/["""']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:]+$/, "");
}

function firstName(raw) {
  const name = cleanName(raw);
  if (!name) return "";
  if (/^bank transfer$/i.test(name)) return "Bank transfer";
  const token = name.split(/\s+/)[0];
  if (/^doan$/i.test(token)) return "Lucia";
  return token;
}

function extractCommentName(text) {
  const re = /\bname\s*:\s*([A-Za-z][A-Za-z .'-]{0,40})/gi;
  var last = "";
  var match;
  while ((match = re.exec(String(text || "")))) {
    const name = cleanName(match[1]);
    if (name && !/^name$/i.test(name)) last = name;
  }
  return last;
}

function githubHeaders(token) {
  return {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
    "User-Agent": "swear-jar-fridge",
  };
}

function githubRepo() {
  return PropertiesService.getScriptProperties().getProperty("GITHUB_REPO") || DEFAULT_REPO;
}

function githubFileUrl(path) {
  return "https://api.github.com/repos/" + githubRepo() + "/contents/" + path;
}

function loadCursePool(token) {
  const res = UrlFetchApp.fetch(githubFileUrl(CURSE_PATH), {
    headers: githubHeaders(token),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) return [];
  const current = JSON.parse(res.getContentText());
  if (!current.content) return [];
  const parsed = decodeGithubFile(current);
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

function pickUnusedCurse(token, existing) {
  const used = {};
  (existing || []).forEach(function (row) {
    if (row && row.curse) used[String(row.curse)] = true;
  });
  const pool = loadCursePool(token);
  for (var i = 0; i < pool.length; i++) {
    if (!used[pool[i]]) return pool[i];
  }
  return "the jar opened a new chapter (" + (Object.keys(used).length + 1) + ")";
}

function decodeGithubFile(current) {
  return JSON.parse(
    Utilities.newBlob(Utilities.base64Decode(current.content.replace(/\n/g, ""))).getDataAsString()
  );
}

function sanitizeNotes(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 48).map(function (row, i) {
    const rawId = String((row && row.id) || "n-" + i).replace(/[^A-Za-z0-9._-]/g, "");
    const id = rawId.slice(0, 80) || "n-" + i;
    const color = NOTE_COLORS[row && row.color] ? row.color : "butter";
    const text = String((row && row.text) || "").slice(0, 500);
    const src = row && row.log ? row.log : {};
    const log = {
      at: String(src.at || "").slice(0, 40),
      device: String(src.device || "").replace(/[^\w\s.'-]/g, "").trim().slice(0, 40),
      deviceId: String(src.deviceId || "").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 80),
      ua: String(src.ua || "").slice(0, 300),
      platform: String(src.platform || "").slice(0, 80),
      lang: String(src.lang || "").slice(0, 20),
      tz: String(src.tz || "").slice(0, 60),
      screen: String(src.screen || "").slice(0, 20),
    };
    const out = { id: id, text: text, color: color };
    if (log.deviceId || log.ua || log.device) out.log = log;
    return out;
  });
}

function readNotesJson(token) {
  const res = UrlFetchApp.fetch(githubFileUrl(NOTES_PATH), {
    headers: githubHeaders(token),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code === 404) return { notes: [], sha: "" };
  const current = JSON.parse(res.getContentText());
  if (!current.content) throw new Error("Could not read notes.json: " + res.getContentText());
  const parsed = decodeGithubFile(current);
  return {
    notes: sanitizeNotes(Array.isArray(parsed) ? parsed : []),
    sha: current.sha || "",
  };
}

function writeNotesJson(token, notes) {
  const url = githubFileUrl(NOTES_PATH);
  const headers = githubHeaders(token);
  const body = JSON.stringify(notes, null, 2) + "\n";

  for (let attempt = 0; attempt < 3; attempt++) {
    const current = JSON.parse(
      UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true }).getContentText()
    );
    const sha = current.sha || "";
    const payload = {
      message: "Update fridge notes.",
      content: Utilities.base64Encode(body, Utilities.Charset.UTF_8),
      branch: "main",
    };
    if (sha) payload.sha = sha;

    const res = UrlFetchApp.fetch(url, {
      method: "put",
      contentType: "application/json",
      headers: headers,
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code === 200 || code === 201) return;
    if (code !== 409 && code !== 422) {
      throw new Error("GitHub notes update failed (" + code + "): " + res.getContentText());
    }
  }

  throw new Error("GitHub notes update collided three times");
}

function publicNotes(notes) {
  return (notes || []).map(function (row) {
    return {
      id: row.id,
      text: row.text,
      color: row.color,
    };
  });
}

function parsePostedNotes(e) {
  var raw = "";
  if (e && e.parameter && e.parameter.notes != null) raw = e.parameter.notes;
  else if (e && e.postData && e.postData.contents) raw = e.postData.contents;
  if (Array.isArray(raw)) return raw;
  try {
    var parsed = JSON.parse(String(raw || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function mergeNotes(incoming, existing) {
  var prev = {};
  (existing || []).forEach(function (row) {
    if (row && row.id) prev[row.id] = row;
  });
  return (incoming || []).map(function (row) {
    var old = (row && row.id && prev[row.id]) || {};
    return {
      id: row && row.id,
      text: row && row.text,
      color: row && row.color,
      log: (row && row.log) || old.log,
    };
  });
}

function respondJsonp(e, obj) {
  const payload = JSON.stringify(obj);
  const cb = e && e.parameter && e.parameter.callback;
  if (cb && /^[A-Za-z_][A-Za-z0-9_]*$/.test(cb)) {
    return ContentService.createTextOutput(cb + "(" + payload + ");").setMimeType(
      ContentService.MimeType.JAVASCRIPT
    );
  }
  return ContentService.createTextOutput(payload).setMimeType(ContentService.MimeType.JSON);
}

function wantsGrowth(e) {
  var p = (e && e.parameter) || {};
  if (String(p.action) === "growth") return true;
  if (String(p.growth) === "1") return true;
  return /(?:^|&)(?:action=growth|growth=1)(?:&|$)/.test(String((e && e.queryString) || ""));
}

/* ---------- Vault: live brokerage value via SnapTrade (Personal API key) ---------- */

const SNAP_BASE = "https://api.snaptrade.com";
const SNAP_LIVE_KEY = "snap:live";
const SNAP_HISTORY_PROP = "BROKERAGE_HISTORY";
const SNAP_CACHE_SECONDS = 300;
const SNAP_MIN_LIVE_GAP_MS = 15000;

function snapCreds() {
  var props = PropertiesService.getScriptProperties();
  var clientId = String(props.getProperty("SNAPTRADE_CLIENT_ID") || "").trim();
  var consumerKey = String(props.getProperty("SNAPTRADE_CONSUMER_KEY") || "").trim();
  if (!clientId || !consumerKey) {
    throw new Error("Add SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY in Script properties.");
  }
  return { clientId: clientId, consumerKey: consumerKey };
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  var keys = Object.keys(value).sort();
  return (
    "{" +
    keys
      .map(function (key) {
        return JSON.stringify(key) + ":" + canonicalJson(value[key]);
      })
      .join(",") +
    "}"
  );
}

function snapRequest(method, path, body) {
  var creds = snapCreds();
  var query =
    "clientId=" + encodeURIComponent(creds.clientId) + "&timestamp=" + Math.floor(Date.now() / 1000);
  var content = body && Object.keys(body).length ? body : null;
  var sigContent = canonicalJson({ content: content, path: "/api/v1" + path, query: query });
  var signature = Utilities.base64Encode(
    Utilities.computeHmacSha256Signature(sigContent, creds.consumerKey, Utilities.Charset.UTF_8)
  );
  var options = {
    method: method,
    muteHttpExceptions: true,
    headers: { Signature: signature, Accept: "application/json" },
  };
  if (content) {
    options.contentType = "application/json";
    options.payload = canonicalJson(content);
  }
  var res = UrlFetchApp.fetch(SNAP_BASE + "/api/v1" + path + "?" + query, options);
  var code = res.getResponseCode();
  var text = res.getContentText();
  var json = null;
  try {
    json = JSON.parse(text);
  } catch (err) {
    json = null;
  }
  if (code < 200 || code >= 300) {
    var detail = (json && (json.detail || json.message)) || text.slice(0, 200) || "HTTP " + code;
    throw new Error("SnapTrade " + code + ": " + detail);
  }
  return json;
}

function snapConnectUrl(redirect, reconnectId) {
  var body = { connectionType: "read", immediateRedirect: true, connectionPortalVersion: "v4" };
  if (redirect) body.customRedirect = redirect;
  if (reconnectId) {
    body.reconnect = reconnectId;
    return snapRequest("post", "/snapTrade/login", body).redirectURI;
  }
  var broker = String(
    PropertiesService.getScriptProperties().getProperty("SNAPTRADE_BROKER") || "FIDELITY"
  ).trim();
  try {
    body.broker = broker;
    return snapRequest("post", "/snapTrade/login", body).redirectURI;
  } catch (err) {
    delete body.broker;
    return snapRequest("post", "/snapTrade/login", body).redirectURI;
  }
}

function positionRow(pos) {
  var instrument = (pos && pos.instrument) || {};
  var sym = (pos && pos.symbol) || {};
  var inner = (sym && sym.symbol) || {};
  var units = moneyAmount(pos.units != null ? pos.units : pos.fractional_units) || 0;
  var price = moneyAmount(pos.price) || 0;
  // price is per share. A missing price must not turn the share count into a $0 value.
  var value = units && price ? roundMoney(Math.abs(units) * price) : 0;
  var explicit = moneyAmount(pos.market_value);
  if (!value && explicit != null) value = roundMoney(Math.abs(explicit));
  var costPer = moneyAmount(pos.average_purchase_price);
  var costField = moneyAmount(pos.cost_basis);
  var cost = null;
  if (costPer != null && units) cost = roundMoney(Math.abs(units) * costPer);
  else if (costField != null && units) {
    var asPerShare = roundMoney(Math.abs(units) * costField);
    var asTotal = roundMoney(costField);
    // cost_basis is usually per share. If that blows past the position value, it was already the whole cost.
    cost = value > 0 && asPerShare > value * 3 && asTotal <= value * 3 ? asTotal : asPerShare;
  }
  var pnl = cost == null ? null : roundMoney(value - cost);
  if ((pnl == null || pnl === 0) && pos.open_pnl != null && isFinite(Number(pos.open_pnl)) && Number(pos.open_pnl) !== 0) {
    pnl = roundMoney(Number(pos.open_pnl));
  }
  var symbol = String(
    instrument.raw_symbol || instrument.symbol || inner.raw_symbol || inner.symbol || ""
  ).toUpperCase();
  var name = String(instrument.description || inner.description || sym.description || "");
  return {
    symbol: symbol,
    name: name,
    units: units,
    price: price,
    value: value,
    cost: cost,
    pnl: pnl,
    cashEquivalent: Boolean(pos.cash_equivalent),
  };
}

function isMoneyMarketSymbol(symbol) {
  return /^(SPAXX|FDRXX|FZFXX|SPRXX|FCASH|FDLXX|FZDXX)$/.test(String(symbol || ""));
}

function quoteSymbol(symbol) {
  var cache = CacheService.getScriptCache();
  var key = "quote:" + symbol;
  var hit = cache.get(key);
  if (hit) {
    try {
      return JSON.parse(hit);
    } catch (err) {
      hit = "";
    }
  }
  var res = UrlFetchApp.fetch(
    "https://query1.finance.yahoo.com/v8/finance/chart/" +
      encodeURIComponent(symbol) +
      "?interval=1d&range=10d",
    { muteHttpExceptions: true, headers: { "User-Agent": "Mozilla/5.0" } }
  );
  if (res.getResponseCode() !== 200) return null;
  var json = JSON.parse(res.getContentText());
  var result = json.chart && json.chart.result && json.chart.result[0];
  if (!result || !result.meta) return null;
  var closes = (((result.indicators || {}).quote || [])[0] || {}).close || [];
  var priced = [];
  closes.forEach(function (close) {
    var n = moneyAmount(close);
    if (n != null) priced.push(n);
  });
  var last = moneyAmount(result.meta.regularMarketPrice);
  var prev = priced.length >= 2 ? priced[priced.length - 2] : moneyAmount(result.meta.previousClose);
  if (last == null) return null;
  var quote = { price: last, previous: prev };
  cache.put(key, JSON.stringify(quote), 300);
  return quote;
}

function markPositions(positions) {
  (positions || []).forEach(function (p) {
    if (!p || p.cashEquivalent || !p.symbol || !p.units) return;
    var quote = null;
    try {
      quote = quoteSymbol(p.symbol);
    } catch (err) {
      quote = null;
    }
    if (!quote || quote.price == null) return;
    p.price = quote.price;
    p.value = roundMoney(Math.abs(p.units) * quote.price);
    p.marked = true;
    if (p.cost != null) p.pnl = roundMoney(p.value - p.cost);
    if (quote.previous != null) {
      p.day = roundMoney((quote.price - quote.previous) * p.units);
      p.dayPct = quote.previous ? (quote.price - quote.previous) / quote.previous : null;
    }
  });
}

function loadPositions(accountId) {
  var all = snapRequest("get", "/accounts/" + accountId + "/positions/all", null);
  if (all && Array.isArray(all.results)) return all.results;
  if (Array.isArray(all)) return all;
  return [];
}

function connectionRow(conn) {
  var brokerage = (conn && conn.brokerage) || {};
  var fresh = (conn && conn.data_freshness_mode) || {};
  return {
    id: String(conn.id || ""),
    brokerage: String(brokerage.display_name || brokerage.name || brokerage.slug || "Brokerage"),
    slug: String(brokerage.slug || ""),
    type: String(conn.type || ""),
    disabled: Boolean(conn.disabled),
    created: String(conn.created_date || ""),
    delayed: fresh.institution === "delayed" || fresh.snaptrade === "delayed",
    accounts: 0,
  };
}

function maskNumber(raw) {
  var s = String(raw || "");
  return s.length > 4 ? "…" + s.slice(-4) : s;
}

function moneyAmount(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return isFinite(value) ? value : null;
  if (typeof value === "string") {
    var n = Number(String(value).replace(/[$,]/g, ""));
    return isFinite(n) ? n : null;
  }
  if (typeof value === "object") {
    if (value.amount != null) return moneyAmount(value.amount);
    if (value.value != null) return moneyAmount(value.value);
  }
  return null;
}

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

function historyRows(data) {
  var list = [];
  if (data && Array.isArray(data.history)) list = data.history;
  else if (Array.isArray(data)) list = data;
  var rows = [];
  list.forEach(function (row) {
    if (!row) return;
    var value = moneyAmount(row.total_value != null ? row.total_value : row.value);
    var date = String(row.date || row.timestamp || "").slice(0, 10);
    if (!date || value == null) return;
    rows.push({ date: date, value: roundMoney(value) });
  });
  rows.sort(function (a, b) {
    return a.date.localeCompare(b.date);
  });
  return rows;
}

function mergeHistory(seriesList) {
  var byDate = {};
  (seriesList || []).forEach(function (series) {
    (series || []).forEach(function (row) {
      byDate[row.date] = roundMoney((byDate[row.date] || 0) + row.value);
    });
  });
  return Object.keys(byDate)
    .sort()
    .map(function (date) {
      return { date: date, value: byDate[date] };
    });
}

function applyDayMove(history, total) {
  var today = Utilities.formatDate(new Date(), "America/Los_Angeles", "yyyy-MM-dd");
  var rows = (history || []).filter(function (row) {
    return row && row.date && isFinite(Number(row.value));
  });
  if (isFinite(total) && total > 0) {
    rows = rows.filter(function (row) {
      return row.date !== today;
    });
    rows.push({ date: today, value: roundMoney(total) });
  }
  rows.sort(function (a, b) {
    return a.date.localeCompare(b.date);
  });
  if (rows.length < 2) {
    return { history: rows, hasDay: false, day: 0, dayPct: null, dayAsOf: "", dayLabel: "Today" };
  }
  var prev = rows[rows.length - 2];
  var last = rows[rows.length - 1];
  var day = roundMoney(last.value - prev.value);
  var yesterday = Utilities.formatDate(new Date(Date.now() - 86400000), "America/Los_Angeles", "yyyy-MM-dd");
  var dayLabel = "Since last reading";
  if (last.date === today && prev.date >= yesterday) dayLabel = "Today";
  else if (last.date !== today) dayLabel = "Latest day";
  return {
    history: rows,
    hasDay: true,
    day: day,
    dayPct: prev.value ? day / prev.value : null,
    dayAsOf: last.date,
    dayLabel: dayLabel,
  };
}

function kickHoldingsRefresh(connections) {
  var props = PropertiesService.getScriptProperties();
  var last = Number(props.getProperty("SNAP_REFRESH_AT") || 0);
  if (Date.now() - last < 2 * 60 * 1000) return { asked: false, recent: true, error: "" };
  var asked = false;
  var error = "";
  (connections || []).forEach(function (conn) {
    if (!conn || !conn.id || conn.disabled) return;
    try {
      snapRequest("post", "/authorizations/" + conn.id + "/refresh", null);
      asked = true;
    } catch (err) {
      error = String(err.message || err);
    }
  });
  if (asked) props.setProperty("SNAP_REFRESH_AT", String(Date.now()));
  return { asked: asked, recent: false, error: error };
}

function newestSync(data) {
  var latest = "";
  ((data && data.accounts) || []).forEach(function (account) {
    var stamp = String((account && account.lastSync) || "");
    if (stamp > latest) latest = stamp;
  });
  return latest;
}

function fetchBrokerageLive() {
  var out = {
    ok: true,
    connected: false,
    syncing: false,
    delayed: false,
    at: new Date().toISOString(),
    connections: [],
    accounts: [],
    series: [],
    total: 0,
    cash: 0,
    cost: 0,
    pnl: 0,
    hasPnl: false,
    warnings: [],
  };
  var connections = snapRequest("get", "/authorizations", null) || [];
  out.connected = connections.length > 0;

  connections.forEach(function (conn) {
    var row = connectionRow(conn);
    if (row.disabled) out.warnings.push(row.brokerage + " needs to be reconnected.");
    if (row.delayed) out.delayed = true;
    var accounts = [];
    try {
      accounts = snapRequest("get", "/authorizations/" + conn.id + "/accounts", null) || [];
    } catch (err) {
      out.warnings.push(row.brokerage + " accounts: " + String(err.message || err));
      out.connections.push(row);
      return;
    }
    row.accounts = accounts.length;
    out.connections.push(row);

    accounts.forEach(function (acct) {
      if (!acct) return;
      if (acct.status === "closed" || acct.status === "archived") return;
      var detail = acct;
      try {
        var fetched = snapRequest("get", "/accounts/" + acct.id, null);
        if (fetched && fetched.id) detail = fetched;
      } catch (err) {
        out.warnings.push("Account value unavailable: " + String(err.message || err));
      }
      var sync = (detail.sync_status && detail.sync_status.holdings) || {};
      var reported = moneyAmount(detail.balance && detail.balance.total);
      var account = {
        id: detail.id || acct.id,
        name: String(detail.name || row.brokerage || "Account"),
        number: maskNumber(detail.number || acct.number),
        institution: String(detail.institution_name || row.brokerage || ""),
        synced: sync.initial_sync_completed !== false,
        lastSync: String(sync.last_successful_sync || ""),
        holdingsUnavailable: Boolean(sync.holdings_unavailable),
        total: reported == null ? 0 : reported,
        cash: 0,
        positions: [],
      };
      if (!account.synced) out.syncing = true;
      try {
        var balances = snapRequest("get", "/accounts/" + acct.id + "/balances", null) || [];
        account.cash = 0;
        account.buyingPower = 0;
        balances.forEach(function (bal) {
          var cash = moneyAmount(bal && bal.cash);
          var buying = moneyAmount(bal && bal.buying_power);
          if (cash != null) account.cash += cash;
          if (buying != null) account.buyingPower += buying;
        });
      } catch (err) {
        out.warnings.push("Cash unavailable: " + String(err.message || err));
      }
      try {
        var positions = loadPositions(acct.id);
        account.positions = positions.map(positionRow).filter(function (p) {
          return p.units !== 0;
        });
      } catch (err) {
        out.warnings.push("Holdings are not available yet: " + String(err.message || err));
      }
      account.positions.forEach(function (p) {
        if (isMoneyMarketSymbol(p.symbol)) p.cashEquivalent = true;
      });
      markPositions(account.positions);
      var securityValue = 0;
      var sweepValue = 0;
      account.positions.forEach(function (p) {
        if (p.cashEquivalent) sweepValue += p.value;
        else securityValue += p.value;
      });
      var settled = account.cash;
      if (!(settled > 0) && account.buyingPower > 0 && account.buyingPower < Math.max(securityValue, 1) * 0.5) {
        settled = account.buyingPower;
      }
      var duplicateSweep =
        securityValue > 20 &&
        sweepValue > 20 &&
        Math.abs(sweepValue - securityValue) / securityValue < 0.25;
      if (duplicateSweep && settled > 0) {
        // The large SPAXX share count is the old balance from before the fund buy.
        // Settled cash is the amount still sitting in SPAXX.
        account.positions.forEach(function (p) {
          if (!p.cashEquivalent) return;
          p.units = roundMoney(settled);
          p.price = 1;
          p.value = roundMoney(settled);
        });
        sweepValue = roundMoney(settled);
      }
      account.cash = roundMoney(sweepValue > 0 ? sweepValue : settled);
      account.total = roundMoney(securityValue + account.cash);
      delete account.buyingPower;
      try {
        var series = historyRows(
          snapRequest("get", "/accounts/" + account.id + "/balanceHistory", null)
        );
        if (series.length) out.series.push(series);
      } catch (err) {
        /* Balance history is optional and off unless enabled in SnapTrade. */
      }
      out.accounts.push(account);
      out.total += account.total;
      out.cash += account.cash;
      account.positions.forEach(function (p) {
        if (p.cashEquivalent) return;
        if (p.cost != null) out.cost += p.cost;
        if (p.pnl != null) {
          out.pnl += p.pnl;
          out.hasPnl = true;
        }
        if (p.day != null) {
          out.day = roundMoney((out.day || 0) + p.day);
          out.quoteDay = true;
        }
      });
    });
  });

  out.total = roundMoney(out.total);
  out.cash = roundMoney(out.cash);
  out.cost = roundMoney(out.cost);
  out.pnl = roundMoney(out.pnl);
  if (out.quoteDay) {
    out.day = roundMoney(out.day || 0);
    var basis = out.total - out.day;
    out.dayPct = basis ? out.day / basis : null;
    out.hasDay = true;
    out.dayLabel = "Today";
  }
  out.series = mergeHistory(out.series);
  return out;
}

function readHistory() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(SNAP_HISTORY_PROP);
    var parsed = JSON.parse(String(raw || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function recordHistory(total) {
  if (!isFinite(total) || total <= 0) return readHistory();
  var today = Utilities.formatDate(new Date(), "America/Los_Angeles", "yyyy-MM-dd");
  var history = readHistory().filter(function (row) {
    return row && row.date !== today;
  });
  history = history.filter(function (row) {
    var twice = total * 2;
    return !(twice > 0 && Math.abs(row.value - twice) / twice < 0.08);
  });
  history.push({ date: today, value: Math.round(total * 100) / 100 });
  history.sort(function (a, b) {
    return String(a.date).localeCompare(String(b.date));
  });
  if (history.length > 250) history = history.slice(history.length - 250);
  PropertiesService.getScriptProperties().setProperty(SNAP_HISTORY_PROP, JSON.stringify(history));
  return history;
}

/**
 * force=false: serve the cache (up to SNAP_CACHE_SECONDS).
 * force=true: go live unless a live fetch happened in the last SNAP_MIN_LIVE_GAP_MS.
 * While nothing is connected or a first sync is running, cache only briefly so a
 * brand-new connection shows up on the next look instead of five minutes later.
 */
function readBrokerage(force) {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(SNAP_LIVE_KEY);
  if (hit) {
    var cached = JSON.parse(hit);
    var age = Date.now() - (Date.parse(cached.at || 0) || 0);
    if (!force || age < SNAP_MIN_LIVE_GAP_MS) {
      if (!(cached.quoteDay && cached.dayLabel === "Today")) {
        var cachedMove = applyDayMove(
          cached.history && cached.history.length >= 2 ? cached.history : readHistory(),
          Number(cached.total) || 0
        );
        cached.history = cachedMove.history;
        cached.hasDay = cachedMove.hasDay;
        cached.day = cachedMove.day;
        cached.dayPct = cachedMove.dayPct;
        cached.dayAsOf = cachedMove.dayAsOf;
        cached.dayLabel = cachedMove.dayLabel;
      }
      cached.cached = true;
      cached.ageSeconds = Math.round(age / 1000);
      return cached;
    }
  }
  var live = fetchBrokerageLive();
  var quoteDay = live.quoteDay
    ? { hasDay: true, day: live.day, dayPct: live.dayPct, dayLabel: "Today" }
    : null;
  if (force && live.delayed) {
    var beforeSync = newestSync(live);
    var beforeTotal = live.total;
    var kicked = kickHoldingsRefresh(live.connections);
    if (kicked.asked) {
      live.refreshing = true;
      live.warnings.push("Asking Fidelity for the latest total…");
      Utilities.sleep(8000);
      var again = fetchBrokerageLive();
      if (again && !again.error) {
        var moved =
          Math.abs((again.total || 0) - beforeTotal) > 0.009 ||
          (newestSync(again) && newestSync(again) !== beforeSync);
        live = again;
        live.refreshing = !moved;
      }
      if (live.refreshing) {
        live.warnings.push(
          "Fidelity has not sent a newer total yet. This page will check again in a few seconds. Their app can stay ahead by about a day."
        );
      }
    } else if (kicked.recent) {
      live.refreshing = true;
      live.warnings.push("Still waiting on the Fidelity update from a moment ago.");
    } else if (kicked.error && !/real-time plan|already return/i.test(kicked.error)) {
      live.warnings.push("Could not ask Fidelity for a new total: " + kicked.error);
    }
  }
  var settled = live.total > 0 && !live.syncing;
  var stored = settled ? recordHistory(live.total) : readHistory();
  var series = live.series && live.series.length >= 2 ? live.series : stored;
  var move = applyDayMove(series, live.total);
  live.history = move.history;
  if (quoteDay) {
    live.hasDay = true;
    live.day = quoteDay.day;
    live.dayPct = quoteDay.dayPct;
    live.dayLabel = "Today";
  } else {
    live.hasDay = move.hasDay;
    live.day = move.day;
    live.dayPct = move.dayPct;
    live.dayAsOf = move.dayAsOf;
    live.dayLabel = move.dayLabel;
  }
  delete live.series;
  cache.put(
    SNAP_LIVE_KEY,
    JSON.stringify(live),
    live.refreshing ? 10 : settled ? SNAP_CACHE_SECONDS : 30
  );
  return live;
}

/** Time-driven trigger: run once a day after the US close (e.g. 2–3 PM Pacific). */
function snapshotBrokerage() {
  var live = readBrokerage(true);
  Logger.log("Vault total " + live.total + " across " + live.accounts.length + " account(s)");
}

/** Raw-ish view of what SnapTrade returns, for troubleshooting from the vault page. */
function snapDebug() {
  var out = { ok: true, at: new Date().toISOString(), steps: [] };
  function step(label, fn) {
    try {
      var value = fn();
      out.steps.push({ step: label, ok: true, result: value });
      return value;
    } catch (err) {
      out.steps.push({ step: label, ok: false, error: String(err.message || err) });
      return null;
    }
  }
  function accountSummary(a) {
    return {
      id: a.id,
      name: a.name,
      number: maskNumber(a.number),
      institution: a.institution_name,
      status: a.status,
      category: a.account_category,
      sync: a.sync_status,
      total: a.balance && a.balance.total,
    };
  }
  var conns =
    step("GET /authorizations", function () {
      return (snapRequest("get", "/authorizations", null) || []).map(function (c) {
        return {
          id: c.id,
          brokerage: c.brokerage && c.brokerage.slug,
          name: c.name,
          type: c.type,
          disabled: c.disabled,
          disabledDate: c.disabled_date,
          created: c.created_date,
          freshness: c.data_freshness_mode,
        };
      });
    }) || [];
  conns.forEach(function (c) {
    var accounts =
      step("GET /authorizations/" + c.id + "/accounts", function () {
        return (snapRequest("get", "/authorizations/" + c.id + "/accounts", null) || []).map(
          accountSummary
        );
      }) || [];
    accounts.forEach(function (a) {
      if (!a || !a.id) return;
      step("GET /accounts/" + a.id, function () {
        var detail = snapRequest("get", "/accounts/" + a.id, null) || {};
        return {
          name: detail.name,
          status: detail.status,
          balance: detail.balance,
          sync: detail.sync_status,
        };
      });
    });
  });
  step("GET /accounts", function () {
    return (snapRequest("get", "/accounts", null) || []).map(accountSummary);
  });
  return out;
}

function growthTokenKey(token) {
  return "growth-auth:" + String(token || "").slice(0, 80);
}

function growthAuthed(token) {
  if (!token) return false;
  return CacheService.getScriptCache().get(growthTokenKey(token)) === "1";
}

function handleGrowth(e) {
  var p = (e && e.parameter) || {};
  var op = String(p.op || "").toLowerCase();
  var token = String(p.token || "");

  if (op === "login") {
    var expected = PropertiesService.getScriptProperties().getProperty("GROWTH_PASSWORD");
    if (!expected) return { ok: false, error: "Vault is not configured yet." };
    if (String(p.password || "") !== expected) return { ok: false, error: "Wrong password." };
    var issued = Utilities.getUuid();
    CacheService.getScriptCache().put(growthTokenKey(issued), "1", 21600);
    return { ok: true, token: issued };
  }

  if (op === "logout") {
    if (token) CacheService.getScriptCache().remove(growthTokenKey(token));
    return { ok: true };
  }

  if (!growthAuthed(token)) return { ok: false, error: "Sign in first." };

  if (op === "list" || op === "refresh") {
    try {
      return readBrokerage(op === "refresh");
    } catch (err) {
      return {
        ok: true,
        connected: false,
        connections: [],
        accounts: [],
        history: readHistory(),
        error: String(err.message || err),
      };
    }
  }

  if (op === "connect") {
    try {
      var redirect = String(p.redirect || "").slice(0, 300);
      if (!/^https:\/\/balance\.piotrjandura\.com\//.test(redirect)) redirect = "";
      var reconnect = String(p.reconnect || "");
      if (!/^[0-9a-f-]{36}$/i.test(reconnect)) reconnect = "";
      CacheService.getScriptCache().remove(SNAP_LIVE_KEY);
      return { ok: true, url: snapConnectUrl(redirect, reconnect) };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  }

  if (op === "debug") {
    return snapDebug();
  }

  return { ok: false, error: "unknown" };
}

function wantsIngest(e) {
  var p = (e && e.parameter) || {};
  if (String(p.ingest) === "1" || String(p.refresh) === "1") return true;
  return /(?:^|&)ingest=1(?:&|$)/.test(String((e && e.queryString) || ""));
}

function doGet(e) {
  if (wantsGrowth(e)) return respondJsonp(e, handleGrowth(e));
  const token = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
  if (!token) throw new Error("Set script property GITHUB_TOKEN");
  if (wantsIngest(e)) ingestVenmo();
  const notes = publicNotes(readNotesJson(token).notes);
  return respondJsonp(e, notes);
}

function doPost(e) {
  if (wantsGrowth(e)) return respondJsonp(e, handleGrowth(e));
  const token = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
  if (!token) throw new Error("Set script property GITHUB_TOKEN");

  if (wantsIngest(e)) {
    ingestVenmo();
    return ContentService.createTextOutput(
      JSON.stringify({ ok: true, ingested: true })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const incoming = parsePostedNotes(e);
    const existing = readNotesJson(token).notes;
    const notes = sanitizeNotes(mergeNotes(incoming, existing));
    writeNotesJson(token, notes);
    return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(
      ContentService.MimeType.JSON
    );
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, error: String(err) })
    ).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
