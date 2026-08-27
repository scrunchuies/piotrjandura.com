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

const normalizePath = (path) => {
  const clean = path.replace(/index\.html$/, "").replace(/\/+$/, "");
  return clean || "/";
};

const here = normalizePath(window.location.pathname);
links.forEach((link) => {
  const href = normalizePath(new URL(link.getAttribute("href"), window.location.origin).pathname);
  if (href === here) link.setAttribute("aria-current", "page");
});
