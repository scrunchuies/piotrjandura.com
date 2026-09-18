/**
 * Wedding RSVP → Google Sheet
 *
 * Guest list AND responses live in this spreadsheet. The website reads
 * Guests via JSONP and writes RSVPs via POST.
 *
 * One-time setup (about two minutes):
 * 1. Open https://sheets.new and name it "Wedding RSVPs".
 * 2. Extensions → Apps Script. Delete the stub code, paste THIS file, Save.
 * 3. Click Run (setupSheets) and authorise when Google asks.
 * 4. Deploy → New deployment → type "Web app"
 *      Execute as:     Me
 *      Who has access: Anyone
 *    Deploy, then copy the URL that ends in /exec.
 * 5. Paste that URL into RSVP_ENDPOINT in wedding/rsvp/rsvp.js, commit, push.
 *
 * After later edits: Deploy → Manage deployments → pencil → New version → Deploy.
 *
 * Tabs:
 *   Guests     party id + one guest name per row (edit this; the site reads it)
 *   Responses  append-only log of every submission
 *   Latest     one row per party + guest + event (overwritten on re-RSVP)
 */

var GUESTS_SHEET = "Guests";
var LOG_SHEET = "Responses";
var LATEST_SHEET = "Latest";
var GUEST_HEADERS = ["Party", "Guest"];
var RESPONSE_HEADERS = ["Received", "Submitted", "Party", "Guest", "Event", "Attending", "Source"];
var MAX_ROWS_PER_POST = 60;

function setupSheets() {
  var ss = openSpreadsheet();
  sheetWithHeaders(ss, GUESTS_SHEET, GUEST_HEADERS);
  sheetWithHeaders(ss, LOG_SHEET, RESPONSE_HEADERS);
  sheetWithHeaders(ss, LATEST_SHEET, RESPONSE_HEADERS);
  seedGuestsIfEmpty(ss.getSheetByName(GUESTS_SHEET));
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Wedding RSVP")
    .addItem("Set up sheets", "setupSheets")
    .addToUi();
}

function doGet(e) {
  var callback = e && e.parameter && e.parameter.callback;
  if (callback) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(callback)) {
      return jsonResponse({ ok: false, error: "bad callback" });
    }
    var payload = { parties: readGuestParties() };
    return ContentService.createTextOutput(callback + "(" + JSON.stringify(payload) + ")").setMimeType(
      ContentService.MimeType.JAVASCRIPT
    );
  }
  return jsonResponse({ ok: true, service: "wedding-rsvp" });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var payload = parseBody(e);
    var rows = normalizeRows(payload);
    if (!rows.length) return jsonResponse({ ok: false, error: "No responses in request" });

    var ss = openSpreadsheet();
    var log = sheetWithHeaders(ss, LOG_SHEET, RESPONSE_HEADERS);
    var latest = sheetWithHeaders(ss, LATEST_SHEET, RESPONSE_HEADERS);
    var received = new Date();

    rows.forEach(function (r) {
      var row = [received, r.submittedAt, r.partyId, r.guest, r.event, r.attending ? "Yes" : "No", r.source];
      log.appendRow(row);
      upsertLatest(latest, row);
    });
    return jsonResponse({ ok: true, count: rows.length });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function openSpreadsheet() {
  var id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("No spreadsheet: bind this script to a sheet or set SPREADSHEET_ID");
  return ss;
}

function sheetWithHeaders(ss, name, headers) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function seedGuestsIfEmpty(sheet) {
  if (sheet.getLastRow() > 1) return;
  [
    ["sample-fortune", "Sarah Fortune"],
    ["sample-fortune", "Tom Fortune"],
    ["sample-doe", "Jane Doe"],
    ["sample-doe", "John Doe"],
    ["sample-doe", "Jamie Doe"],
    ["sample-test", "Test Guest"],
  ].forEach(function (row) {
    sheet.appendRow(row);
  });
}

function readGuestParties() {
  var ss = openSpreadsheet();
  var sheet = ss.getSheetByName(GUESTS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  var byId = {};
  var order = [];
  values.forEach(function (row) {
    var id = String(row[0] || "").replace(/\s+/g, " ").trim();
    var guest = String(row[1] || "").replace(/\s+/g, " ").trim();
    if (!id || !guest) return;
    if (!byId[id]) {
      byId[id] = { id: id, guests: [] };
      order.push(id);
    }
    if (byId[id].guests.indexOf(guest) === -1) byId[id].guests.push(guest);
  });
  return order.map(function (id) {
    return byId[id];
  });
}

function upsertLatest(sheet, row) {
  var last = sheet.getLastRow();
  if (last > 1) {
    var keys = sheet.getRange(2, 3, last - 1, 3).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (
        String(keys[i][0]) === String(row[2]) &&
        String(keys[i][1]) === String(row[3]) &&
        String(keys[i][2]) === String(row[4])
      ) {
        sheet.getRange(i + 2, 1, 1, row.length).setValues([row]);
        return;
      }
    }
  }
  sheet.appendRow(row);
}

function parseBody(e) {
  var raw = "";
  if (e && e.postData && e.postData.contents) raw = e.postData.contents;
  else if (e && e.parameter && e.parameter.payload) raw = e.parameter.payload;
  try {
    var parsed = JSON.parse(String(raw || "{}"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    throw new Error("Body is not JSON");
  }
}

function normalizeRows(payload) {
  var partyId = clean(payload.partyId, 80);
  var submittedAt = clean(payload.submittedAt, 40);
  var source = clean(payload.source, 200);
  var responses = Array.isArray(payload.responses) ? payload.responses.slice(0, MAX_ROWS_PER_POST) : [];
  var rows = [];
  responses.forEach(function (r) {
    if (!r) return;
    var guest = clean(r.guest, 120);
    var event = clean(r.event, 40);
    if (!partyId || !guest || !event) return;
    rows.push({
      partyId: partyId,
      submittedAt: submittedAt,
      guest: guest,
      event: event,
      attending: r.attending === true || /^(true|yes|1)$/i.test(String(r.attending)),
      source: source,
    });
  });
  return rows;
}

function clean(value, max) {
  var text = String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
