const year = document.getElementById("year");
if (year) year.textContent = String(new Date().getFullYear());

const nav = document.querySelector(".nav");
const toggle = document.querySelector(".nav-toggle");
const links = [...document.querySelectorAll(".nav-links a")];
const sections = [...document.querySelectorAll("section[id]")];

const closeNav = () => {
  nav?.classList.remove("is-open");
  toggle?.setAttribute("aria-expanded", "false");
  toggle?.setAttribute("aria-label", "Open menu");
};

toggle?.addEventListener("click", () => {
  const open = nav.classList.toggle("is-open");
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
});

links.forEach((link) => link.addEventListener("click", closeNav));
window.addEventListener("resize", () => {
  if (window.innerWidth > 900) closeNav();
});

const setActive = () => {
  const y = window.scrollY + 120;
  let current = sections[0]?.id;
  for (const section of sections) {
    if (section.offsetTop <= y) current = section.id;
  }
  links.forEach((link) => {
    link.style.color =
      link.getAttribute("href") === `#${current}` ? "var(--brass)" : "";
  });
};

window.addEventListener("scroll", setActive, { passive: true });
setActive();

const finishIntro = () => {
  document.body.classList.remove("is-introing", "intro-play");
  document.body.classList.add("intro-done");
};

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (reduced) {
  finishIntro();
} else {
  requestAnimationFrame(() => document.body.classList.add("intro-play"));
  window.setTimeout(finishIntro, 4200);
}
