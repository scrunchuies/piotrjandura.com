const year = document.getElementById("year");
if (year) year.textContent = String(new Date().getFullYear());

const nav = document.querySelector(".nav");
const toggle = document.querySelector(".nav-toggle");
const links = [...document.querySelectorAll(".nav-links a")];

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

const sections = [...document.querySelectorAll("section[id]")];
const setActive = () => {
  if (!sections.length) return;
  const y = window.scrollY + 120;
  let current = sections[0]?.id;
  for (const section of sections) {
    if (section.offsetTop <= y) current = section.id;
  }
  links.forEach((link) => {
    const hash = (link.getAttribute("href") || "").split("#")[1];
    if (!hash) return;
    if (hash === current) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
};

window.addEventListener("scroll", setActive, { passive: true });
setActive();
