/* Shared behaviour for every page: nav "current page" marker + home countdown. */
(function () {
  "use strict";

  var WEDDING = { year: 2027, month: 5, day: 15, hour: 15, minute: 0, tz: "America/New_York" };

  /* Nav ---------------------------------------------------------------- */

  function stripIndex(pathname) {
    return pathname.replace(/index\.html$/, "");
  }

  function markCurrentNavLink() {
    var links = document.querySelectorAll(".site-nav a");
    var here = stripIndex(location.pathname);
    var match = null;
    for (var i = 0; i < links.length; i++) {
      var path = stripIndex(new URL(links[i].getAttribute("href"), location.href).pathname);
      if (path === here) match = links[i];
    }
    if (!match) return; // keep whatever the markup says
    for (var j = 0; j < links.length; j++) {
      if (links[j] === match) links[j].setAttribute("aria-current", "page");
      else links[j].removeAttribute("aria-current");
    }
  }

  /* Time zone helpers -------------------------------------------------- */

  // Offset (ms) of `tz` from UTC at the instant `ms`.
  function tzOffsetMs(ms, tz) {
    var dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    var parts = {};
    dtf.formatToParts(new Date(ms)).forEach(function (p) {
      parts[p.type] = p.value;
    });
    var asUtc = Date.UTC(
      +parts.year,
      +parts.month - 1,
      +parts.day,
      +parts.hour % 24,
      +parts.minute,
      +parts.second
    );
    return asUtc - ms;
  }

  // Wall-clock time in `tz` -> UTC instant (ms).
  function zonedTimeToUtc(y, mo, d, h, mi, tz) {
    var wall = Date.UTC(y, mo - 1, d, h, mi, 0);
    try {
      var guess = wall;
      for (var i = 0; i < 2; i++) guess = wall - tzOffsetMs(guess, tz);
      return guess;
    } catch (err) {
      return wall + 4 * 60 * 60 * 1000; // EDT fallback (UTC-4)
    }
  }

  /* Countdown ---------------------------------------------------------- */

  function part(value, unit) {
    var span = document.createElement("span");
    var num = document.createElement("b");
    num.textContent = String(value);
    span.appendChild(num);
    span.appendChild(document.createTextNode(" " + unit + (value === 1 ? "" : "s")));
    return span;
  }

  function startCountdown(el) {
    var start = zonedTimeToUtc(WEDDING.year, WEDDING.month, WEDDING.day, WEDDING.hour, WEDDING.minute, WEDDING.tz);
    var dayStart = zonedTimeToUtc(WEDDING.year, WEDDING.month, WEDDING.day, 0, 0, WEDDING.tz);
    var dayEnd = zonedTimeToUtc(WEDDING.year, WEDDING.month, WEDDING.day + 1, 0, 0, WEDDING.tz);
    var timer = null;

    function render() {
      var now = Date.now();
      el.textContent = "";
      if (now >= dayEnd) {
        el.textContent = "We're married! Thank you for celebrating with us.";
        if (timer) clearInterval(timer);
        return;
      }
      if (now >= dayStart) {
        el.textContent =
          now < start
            ? "Today's the day! See you at the Cathedral Basilica at 3:00 pm."
            : "Today's the day! We can't wait to celebrate with you.";
        return;
      }
      var diff = start - now;
      var days = Math.floor(diff / 86400000);
      var hours = Math.floor((diff % 86400000) / 3600000);
      var minutes = Math.floor((diff % 3600000) / 60000);
      var seconds = Math.floor((diff % 60000) / 1000);
      el.appendChild(part(days, "day"));
      el.appendChild(part(hours, "hour"));
      el.appendChild(part(minutes, "minute"));
      el.appendChild(part(seconds, "second"));
    }

    render();
    timer = setInterval(render, 1000);
  }

  /* Hero carousel ------------------------------------------------------ */

  function startCarousel(root) {
    var slides = Array.prototype.slice.call(root.querySelectorAll(".carousel-track img"));
    if (slides.length < 2) return;

    var dotsWrap = root.querySelector(".carousel-dots");
    var prevBtn = root.querySelector(".carousel-prev");
    var nextBtn = root.querySelector(".carousel-next");
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var index = 0;
    var timer = null;
    var dots = [];
    var INTERVAL = 3200;

    function show(i, dir) {
      var next = ((i % slides.length) + slides.length) % slides.length;
      if (next === index) return;

      if (dir == null) {
        var forward = (next - index + slides.length) % slides.length;
        var backward = (index - next + slides.length) % slides.length;
        dir = forward <= backward ? 1 : -1;
      }

      var current = slides[index];
      var incoming = slides[next];

      incoming.style.transition = "none";
      incoming.style.transform = dir > 0 ? "translateX(100%)" : "translateX(-100%)";
      incoming.offsetHeight;
      incoming.style.transition = "";

      current.style.transform = dir > 0 ? "translateX(-100%)" : "translateX(100%)";
      incoming.style.transform = "translateX(0)";

      current.classList.remove("is-active");
      incoming.classList.add("is-active");
      index = next;

      for (var s = 0; s < dots.length; s++) {
        if (s === index) dots[s].setAttribute("aria-current", "true");
        else dots[s].removeAttribute("aria-current");
      }
    }

    function pause() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    function play() {
      if (reduce) return;
      pause();
      timer = setInterval(function () {
        show(index + 1, 1);
      }, INTERVAL);
    }

    if (dotsWrap) {
      slides.forEach(function (slide, i) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute("role", "tab");
        btn.setAttribute("aria-label", "Photo " + (i + 1) + " of " + slides.length);
        btn.addEventListener("click", function () {
          show(i);
          pause();
          play();
        });
        dotsWrap.appendChild(btn);
        dots.push(btn);
      });
      if (dots[0]) dots[0].setAttribute("aria-current", "true");
    }

    if (prevBtn) {
      prevBtn.addEventListener("click", function () {
        show(index - 1, -1);
        pause();
        play();
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener("click", function () {
        show(index + 1, 1);
        pause();
        play();
      });
    }

    var startX = 0;
    root.addEventListener(
      "touchstart",
      function (e) {
        if (e.changedTouches && e.changedTouches[0]) startX = e.changedTouches[0].clientX;
      },
      { passive: true }
    );
    root.addEventListener(
      "touchend",
      function (e) {
        if (!e.changedTouches || !e.changedTouches[0]) return;
        var dx = e.changedTouches[0].clientX - startX;
        if (Math.abs(dx) < 40) return;
        show(index + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
        pause();
        play();
      },
      { passive: true }
    );

    root.addEventListener("focusout", function () {
      if (!root.contains(document.activeElement)) play();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) pause();
      else play();
    });

    play();
  }

  /* Init --------------------------------------------------------------- */

  markCurrentNavLink();
  var countdown = document.querySelector("[data-countdown]");
  if (countdown) startCountdown(countdown);
  var carousel = document.querySelector("[data-carousel]");
  if (carousel) startCarousel(carousel);
})();
