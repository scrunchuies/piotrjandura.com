/* RSVP flow: find your party -> answer per event -> submit -> summary.
   Static site, so everything runs in the browser; responses are POSTed to a
   Google Apps Script web app (see Code.gs) and mirrored in localStorage. */
(function () {
  "use strict";

  /* Configuration (edit these) ------------------------------------------ */

  // Web app URL (ends in /exec) from deploying wedding/rsvp/Code.gs.
  // While empty, responses are only saved on the guest's device and the page
  // shows a notice with a mailto: fallback.
  var RSVP_ENDPOINT = "";

  // TODO(owner): address guests can email their response to while
  // RSVP_ENDPOINT is empty, or if sending fails. Leave empty to hide the link.
  var RSVP_FALLBACK_EMAIL = "";

  var GUESTS_URL = "guests.json";
  var STORAGE_PREFIX = "wedding-rsvp:";

  var EVENTS = [
    {
      id: "ceremony",
      title: "Ceremony",
      when: "Saturday, May 15, 2027 3:00 PM",
      venue: "Cathedral Basilica of the Sacred Heart",
      address: "89 Ridge Street, Newark, NJ 07104",
      mapUrl:
        "https://www.google.com/maps/search/?api=1&query=Cathedral+Basilica+of+the+Sacred+Heart%2C+89+Ridge+Street%2C+Newark%2C+NJ+07104",
      description: [
        "We invite you to join us in celebrating a Full Catholic Mass.",
        "Guests are kindly asked to arrive 15 to 20 minutes prior to the ceremony start time for seating, as the ceremony will begin promptly.",
      ],
    },
    {
      id: "reception",
      title: "Reception",
      when: "Saturday, May 15, 2027 6:00 PM - 11:00 PM",
      venue: "Park Avenue Club",
      address: "184 Park Ave, Florham Park, NJ 07932",
      mapUrl:
        "https://www.google.com/maps/search/?api=1&query=Park+Avenue+Club%2C+184+Park+Ave%2C+Florham+Park%2C+NJ+07932",
      description: [
        "Black-tie optional: We invite our guests to dress in formal attire for the evening. Tuxedos and floor-length gowns are welcomed, or guests may opt for a dark tailored suit with a tie or an elegant, dressy cocktail dress.",
        "We can't wait to celebrate with you at Park Avenue Club immediately following the ceremony! Join us for an evening of cocktails, dinner, and dancing.",
      ],
    },
  ];

  // Words ignored when matching ("Dr. and Mr. Fortune" -> "fortune").
  var STOPWORDS = { dr: 1, mr: 1, mrs: 1, ms: 1, miss: 1, and: 1, the: 1, family: 1, of: 1 };

  /* DOM helpers ---------------------------------------------------------- */

  function $(id) {
    return document.getElementById(id);
  }

  function append(node, children) {
    if (children == null) return;
    if (Array.isArray(children)) {
      children.forEach(function (child) {
        append(node, child);
      });
    } else if (typeof children === "string") {
      node.appendChild(document.createTextNode(children));
    } else {
      node.appendChild(children);
    }
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === false || value == null) return;
        node.setAttribute(key, value === true ? "" : value);
      });
    }
    append(node, children);
    return node;
  }

  function icon(kind) {
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.6");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    var circle = document.createElementNS(NS, "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "12");
    circle.setAttribute("r", "10");
    var path = document.createElementNS(NS, "path");
    path.setAttribute("d", kind === "yes" ? "M7.5 12.5l3 3 6-7" : "M9 9l6 6M15 9l-6 6");
    svg.appendChild(circle);
    svg.appendChild(path);
    return svg;
  }

  var searchSection = $("rsvp-search");
  var resultsSection = $("rsvp-results");
  var eventsSection = $("rsvp-events");
  var summarySection = $("rsvp-summary");
  var searchForm = $("rsvp-search-form");
  var nameInput = $("rsvp-name");
  if (!searchSection || !searchForm || !nameInput) return;

  var state = { parties: null, party: null, answers: {}, eventIndex: 0 };

  function setView(name) {
    searchSection.hidden = !(name === "search" || name === "results");
    resultsSection.hidden = name !== "results";
    eventsSection.hidden = name !== "events";
    summarySection.hidden = name !== "summary";
  }

  function focusHeading(section) {
    var heading = section.querySelector("[tabindex='-1']");
    if (heading) heading.focus();
  }

  /* Guest list ----------------------------------------------------------- */

  function loadParties() {
    if (state.parties) return Promise.resolve(state.parties);
    return fetch(GUESTS_URL, { cache: "no-cache" })
      .then(function (res) {
        if (!res.ok) throw new Error("guests.json responded " + res.status);
        return res.json();
      })
      .then(function (json) {
        var parties = Array.isArray(json.parties) ? json.parties : [];
        state.parties = parties
          .filter(function (party) {
            return party && party.id != null && Array.isArray(party.guests) && party.guests.length;
          })
          .map(function (party) {
            return {
              id: String(party.id),
              guests: party.guests.map(function (guest) {
                return String(guest).replace(/\s+/g, " ").trim();
              }),
            };
          });
        return state.parties;
      });
  }

  /* Matching ------------------------------------------------------------- */

  function normalize(text) {
    return String(text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function tokens(text, dropStopwords) {
    return normalize(text)
      .split(" ")
      .filter(function (token) {
        return token && !(dropStopwords && STOPWORDS[token]);
      });
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    var prev = [];
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      var cur = [i];
      for (var k = 1; k <= b.length; k++) {
        var cost = a[i - 1] === b[k - 1] ? 0 : 1;
        cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + cost);
      }
      prev = cur;
    }
    return prev[b.length];
  }

  // 3 = exact, 2 = prefix, 1 = close (typo), 0 = no match.
  function tokenScore(query, candidate, strict) {
    if (query === candidate) return 3;
    if (strict) return 0;
    if (query.length >= 2 && candidate.indexOf(query) === 0) return 2;
    var allowed = query.length >= 7 ? 2 : query.length >= 4 ? 1 : 0;
    return allowed && levenshtein(query, candidate) <= allowed ? 1 : 0;
  }

  // Every query token must match a distinct token of the guest's name.
  function guestScore(queryTokens, guestName, strict) {
    var guestTokens = tokens(guestName, false);
    var used = {};
    var total = 0;
    for (var i = 0; i < queryTokens.length; i++) {
      var best = 0;
      var bestIndex = -1;
      for (var j = 0; j < guestTokens.length; j++) {
        if (used[j]) continue;
        var score = tokenScore(queryTokens[i], guestTokens[j], strict);
        if (score > best) {
          best = score;
          bestIndex = j;
        }
      }
      if (!best) return 0;
      used[bestIndex] = true;
      total += best;
    }
    return total;
  }

  function findMatches(query, parties) {
    var queryTokens = tokens(query, true);
    if (!queryTokens.length) queryTokens = tokens(query, false);
    if (!queryTokens.length) return [];
    var strict = queryTokens.length < 2; // one word: exact word match only
    var matches = [];
    parties.forEach(function (party) {
      var best = null;
      party.guests.forEach(function (guest) {
        var score = guestScore(queryTokens, guest, strict);
        if (score > 0 && (!best || score > best.score)) best = { party: party, guest: guest, score: score };
      });
      if (best) matches.push(best);
    });
    matches.sort(function (a, b) {
      return b.score - a.score || a.guest.localeCompare(b.guest);
    });
    return matches;
  }

  /* Storage -------------------------------------------------------------- */

  function loadSaved(party) {
    try {
      var raw = localStorage.getItem(STORAGE_PREFIX + party.id);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function save(party, record) {
    try {
      localStorage.setItem(STORAGE_PREFIX + party.id, JSON.stringify(record));
    } catch (err) {
      /* private mode / storage full: the summary still shows */
    }
  }

  function isComplete(party, answers) {
    return EVENTS.every(function (event) {
      var forEvent = answers && answers[event.id];
      return (
        forEvent &&
        party.guests.every(function (guest, index) {
          return forEvent[index] === "yes" || forEvent[index] === "no";
        })
      );
    });
  }

  /* Formatting ----------------------------------------------------------- */

  function joinNames(names) {
    if (names.length <= 1) return names.join("");
    if (names.length === 2) return names[0] + " and " + names[1];
    return names.slice(0, -1).join(", ") + ", and " + names[names.length - 1];
  }

  function formatDate(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return "";
    return date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  }

  function responseText(party, answers) {
    var lines = ["RSVP for " + joinNames(party.guests), ""];
    EVENTS.forEach(function (event) {
      lines.push(event.title + " (" + event.when + ")");
      party.guests.forEach(function (guest, index) {
        var yes = answers[event.id] && answers[event.id][index] === "yes";
        lines.push("- " + guest + ": " + (yes ? "Will attend" : "Will not attend"));
      });
      lines.push("");
    });
    return lines.join("\n");
  }

  function mailtoHref(party, answers) {
    return (
      "mailto:" +
      RSVP_FALLBACK_EMAIL +
      "?subject=" +
      encodeURIComponent("RSVP: " + joinNames(party.guests)) +
      "&body=" +
      encodeURIComponent(responseText(party, answers))
    );
  }

  function buildPayload(party, answers, submittedAt) {
    var responses = [];
    party.guests.forEach(function (guest, index) {
      EVENTS.forEach(function (event) {
        responses.push({
          guest: guest,
          event: event.id,
          attending: answers[event.id][index] === "yes",
        });
      });
    });
    return {
      partyId: party.id,
      guests: party.guests,
      submittedAt: submittedAt,
      responses: responses,
      source: location.href,
    };
  }

  /* Views ---------------------------------------------------------------- */

  function searchAgainLink() {
    var button = el("button", { class: "link-button", type: "button" }, "Not you? Search again");
    button.addEventListener("click", function () {
      state.party = null;
      state.answers = {};
      state.eventIndex = 0;
      resultsSection.textContent = "";
      nameInput.value = "";
      setView("search");
      nameInput.focus();
    });
    return button;
  }

  function renderResults(query, matches) {
    resultsSection.textContent = "";
    if (!matches.length) {
      resultsSection.appendChild(
        el("p", { class: "rsvp-results-title" }, "We couldn't find \u201c" + query + "\u201d on our guest list.")
      );
      resultsSection.appendChild(
        el("p", { class: "rsvp-empty" }, [
          "Please check the spelling and try again, or ",
          el("a", { class: "inline-link", href: "../faq/#contact" }, "reach out to us"),
          " and we'll sort it out.",
        ])
      );
    } else {
      resultsSection.appendChild(
        el("p", { class: "rsvp-results-title" }, "Select your info below or try searching again.")
      );
      var list = el("ul", { class: "result-list" });
      matches.forEach(function (match) {
        var name = el("span", { class: "result-name" }, match.guest);
        var others = match.party.guests.filter(function (guest) {
          return guest !== match.guest;
        });
        if (others.length) name.appendChild(el("span", { class: "result-with" }, "with " + joinNames(others)));
        var select = el(
          "button",
          { class: "button button-dark", type: "button", "aria-label": "Select " + match.guest },
          "Select"
        );
        select.addEventListener("click", function () {
          selectParty(match.party);
        });
        list.appendChild(el("li", { class: "result-row" }, [name, select]));
      });
      resultsSection.appendChild(list);
    }
    setView("results");
  }

  function renderLoadError() {
    resultsSection.textContent = "";
    resultsSection.appendChild(
      el("p", { class: "rsvp-results-title" }, "We couldn't load the guest list right now.")
    );
    resultsSection.appendChild(
      el("p", { class: "rsvp-empty" }, [
        "Please try again in a moment, or ",
        el("a", { class: "inline-link", href: "../faq/#contact" }, "reach out to us"),
        " directly.",
      ])
    );
    setView("results");
  }

  function selectParty(party) {
    state.party = party;
    state.eventIndex = 0;
    var saved = loadSaved(party);
    if (saved && isComplete(party, saved.answers)) {
      state.answers = saved.answers;
      renderSummary({ savedAt: saved.submittedAt, fromStorage: true });
      return;
    }
    state.answers = (saved && saved.answers) || {};
    renderEvent();
  }

  function eventDetails(event, headingTag, headingClass) {
    return [
      el(headingTag, { class: headingClass, tabindex: "-1" }, event.title),
      el("p", { class: "event-when" }, event.when),
      el("p", { class: "venue-name" }, event.venue),
      el("p", { class: "venue-address" }, [
        el("a", { href: event.mapUrl, target: "_blank", rel: "noopener" }, event.address),
      ]),
      event.description.map(function (text) {
        return el("p", { class: "event-desc" }, text);
      }),
    ];
  }

  function renderEvent() {
    var party = state.party;
    var index = state.eventIndex;
    var event = EVENTS[index];
    var isLast = index === EVENTS.length - 1;
    eventsSection.textContent = "";

    eventsSection.appendChild(el("p", { class: "rsvp-step" }, index + 1 + " of " + EVENTS.length + " events"));
    if (index > 0) {
      var back = el("button", { class: "rsvp-back", type: "button" }, "\u2190 Back");
      back.addEventListener("click", function () {
        rememberAnswers(form, event, party);
        state.eventIndex = index - 1;
        renderEvent();
      });
      eventsSection.appendChild(el("div", null, back));
    }
    append(eventsSection, eventDetails(event, "h2", "script echo"));

    var form = el("form", { class: "rsvp-form", novalidate: true });
    var rows = el("div", { class: "guest-rows" });
    party.guests.forEach(function (guest, guestIndex) {
      var labelId = "rsvp-" + event.id + "-guest-" + guestIndex;
      var name = el("span", { class: "guest-name", id: labelId }, [
        guest,
        el("span", { class: "req", "aria-hidden": "true" }, "*"),
      ]);
      var choices = el("div", { class: "choices" });
      [
        ["yes", "Will attend"],
        ["no", "Will not attend"],
      ].forEach(function (choice) {
        var radio = el("input", {
          type: "radio",
          name: "guest-" + guestIndex,
          value: choice[0],
          required: true,
        });
        if (state.answers[event.id] && state.answers[event.id][guestIndex] === choice[0]) radio.checked = true;
        choices.appendChild(el("label", null, [radio, choice[1]]));
      });
      rows.appendChild(
        el(
          "div",
          { class: "guest-row", role: "radiogroup", "aria-labelledby": labelId, "aria-required": "true" },
          [name, choices]
        )
      );
    });
    form.appendChild(rows);

    var error = el("p", { class: "form-error", role: "alert", hidden: true }, "Please choose an answer for every guest.");
    form.appendChild(error);
    var submit = el("button", { class: "button button-dark button-wide", type: "submit" }, isLast ? "Submit all" : "Next Event");
    form.appendChild(el("div", { class: "rsvp-actions" }, [submit, searchAgainLink()]));

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var answers = rememberAnswers(form, event, party);
      var missing = party.guests.findIndex(function (guest, guestIndex) {
        return answers[guestIndex] !== "yes" && answers[guestIndex] !== "no";
      });
      if (missing !== -1) {
        error.hidden = false;
        var first = form.querySelector("input[name='guest-" + missing + "']");
        if (first) first.focus();
        return;
      }
      error.hidden = true;
      if (isLast) submitAll();
      else {
        state.eventIndex = index + 1;
        renderEvent();
      }
    });

    eventsSection.appendChild(form);
    setView("events");
    focusHeading(eventsSection);
  }

  // Copy the radios' current values into state (so Back keeps partial answers).
  function rememberAnswers(form, event, party) {
    var answers = {};
    party.guests.forEach(function (guest, guestIndex) {
      var checked = form.querySelector("input[name='guest-" + guestIndex + "']:checked");
      if (checked) answers[guestIndex] = checked.value;
    });
    state.answers[event.id] = answers;
    return answers;
  }

  function statusBadge(yes) {
    return el("span", { class: "status " + (yes ? "status-yes" : "status-no") }, [
      icon(yes ? "yes" : "no"),
      yes ? "Will Attend" : "Will Not Attend",
    ]);
  }

  function renderSummary(meta) {
    var party = state.party;
    summarySection.textContent = "";
    summarySection.appendChild(el("h2", { class: "script echo", tabindex: "-1" }, "Your RSVP Response"));

    var status = el("p", { class: "rsvp-status", role: "status" });
    if (meta.fromStorage && meta.savedAt) {
      var when = formatDate(meta.savedAt);
      status.textContent = "You responded" + (when ? " on " + when : "") + ". You can still make changes below.";
    }
    summarySection.appendChild(status);

    if (!RSVP_ENDPOINT) {
      var notice = el("div", { class: "rsvp-notice" }, [
        "Heads up: responses aren't being sent to us yet, so this one is only saved on your device. ",
      ]);
      if (RSVP_FALLBACK_EMAIL) {
        notice.appendChild(
          el("a", { class: "inline-link", href: mailtoHref(party, state.answers) }, "Email us your response")
        );
        notice.appendChild(document.createTextNode(" so we have it."));
      } else {
        notice.appendChild(document.createTextNode("Please check back soon or reach out to us directly."));
      }
      summarySection.appendChild(notice);
    }

    EVENTS.forEach(function (event) {
      var block = el("section", { class: "summary-event" }, eventDetails(event, "h3", "script script-sm echo"));
      block.querySelector("h3").removeAttribute("tabindex");
      var list = el("ul", { class: "summary-rows" });
      party.guests.forEach(function (guest, guestIndex) {
        var yes = state.answers[event.id] && state.answers[event.id][guestIndex] === "yes";
        list.appendChild(el("li", null, [el("span", null, guest), statusBadge(yes)]));
      });
      block.appendChild(list);
      summarySection.appendChild(block);
    });

    var edit = el("button", { class: "button button-dark button-wide", type: "button" }, "Edit RSVP");
    edit.addEventListener("click", function () {
      state.eventIndex = 0;
      renderEvent();
    });
    summarySection.appendChild(el("div", { class: "rsvp-actions" }, [edit, searchAgainLink()]));

    setView("summary");
    focusHeading(summarySection);
    return status;
  }

  /* Submission ----------------------------------------------------------- */

  function submitAll() {
    var party = state.party;
    var answers = state.answers;
    var submittedAt = new Date().toISOString();
    var record = { answers: answers, submittedAt: submittedAt, sent: false };
    save(party, record);

    var status = renderSummary({ savedAt: submittedAt });
    if (!RSVP_ENDPOINT) return;

    status.textContent = "Sending your response\u2026";
    var request;
    try {
      // Apps Script answers with a redirect that browsers refuse under CORS,
      // so this is fire-and-forget: an opaque response still means "delivered".
      request = fetch(RSVP_ENDPOINT, {
        method: "POST",
        mode: "no-cors",
        keepalive: true,
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(buildPayload(party, answers, submittedAt)),
      });
    } catch (err) {
      request = Promise.reject(err);
    }
    request
      .then(function () {
        record.sent = true;
        save(party, record);
        status.textContent = "Your response has been sent. Thank you!";
      })
      .catch(function () {
        status.textContent = "We couldn't send your response automatically. ";
        if (RSVP_FALLBACK_EMAIL) {
          status.appendChild(
            el("a", { class: "inline-link", href: mailtoHref(party, answers) }, "Email it to us instead")
          );
          status.appendChild(document.createTextNode("."));
        } else {
          status.appendChild(document.createTextNode("Please try again later or reach out to us directly."));
        }
      });
  }

  /* Search --------------------------------------------------------------- */

  searchForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var query = nameInput.value.replace(/\s+/g, " ").trim();
    if (!query) {
      nameInput.focus();
      return;
    }
    var button = searchForm.querySelector("button[type='submit']");
    button.disabled = true;
    loadParties()
      .then(function (parties) {
        renderResults(query, findMatches(query, parties));
      })
      .catch(function () {
        renderLoadError();
      })
      .then(function () {
        button.disabled = false;
      });
  });
})();
