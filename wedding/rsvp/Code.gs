/**
 * Wedding RSVP → Google Sheet
 *
 * Receives the JSON that wedding/rsvp/rsvp.js POSTs and appends it to a
 * spreadsheet. Deploy once, paste the URL into RSVP_ENDPOINT, done.
 *
 * 1. https://sheets.new → create a blank spreadsheet, e.g. "Wedding RSVPs".
 * 2. Extensions → Apps Script → replace everything in Code.gs with this file → Save.
 *    (The script is bound to the sheet, so no spreadsheet ID is needed.)
 * 3. Deploy → New deployment → gear icon → type "Web app":
 *      Description:     rsvp
 *      Execute as:      Me
 *      Who has access:  Anyone
 *    Click Deploy and authorise when prompted (it only touches this spreadsheet).
 * 4. Copy the Web app URL (ends in /exec) into RSVP_ENDPOINT at the top of
 *    wedding/rsvp/rsvp.js, commit, and push the site.
 * 5. Test: open the live RSVP page, respond as a sample guest, then check the
 *    "Responses" and "Latest" tabs here. Opening the /exec URL in a browser
 *    should show {"ok":true,...}.
 *
 * After editing this file: Deploy → Manage deployments → pencil → Version:
 * "New version" → Deploy. Otherwise the live URL keeps running the old code.
 *
 * Tabs maintained:
 *   Responses  append-only log: one row per guest per event per submission.
 *   Latest     one row per party + guest + event, overwritten when a party
 *              re-submits, so the headcount is simply this tab.
 *
 * Optional script property SPREADSHEET_ID lets a standalone script (not
 * created from the sheet's Extensions menu) target a specific spreadsheet.
 */

var LOG_SHEET = "Responses";
var LATEST_SHEET = "Latest";
var HEADERS = ["Received", "Submitted", "Party", "Guest", "Event", "Attending", "Source"];
var MAX_ROWS_PER_POST = 60; // a party with 30 guests × 2 events

function doGet() {
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
    var log = sheetWithHeaders(ss, LOG_SHEET);
    var latest = sheetWithHeaders(ss, LATEST_SHEET);
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

function sheetWithHeaders(ss, name) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Party + Guest + Event identify a row on the Latest tab.
function upsertLatest(sheet, row) {
  var last = sheet.getLastRow();
  if (last > 1) {
    var keys = sheet.getRange(2, 3, last - 1, 3).getValues(); // Party, Guest, Event
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

// Trim, cap length, and neutralise anything Sheets would treat as a formula.
function clean(value, max) {
  var text = String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
