// Runs before React hydrates. Reads persisted theme from localStorage and
// applies it to <html> so first paint matches the user's preference —
// prevents the dark → light (or vice versa) flash on load.
(function () {
  try {
    var t = localStorage.getItem("solprobe-theme");
    if (t !== "light" && t !== "dark") t = "dark";
    document.documentElement.setAttribute("data-theme", t);
    document.documentElement.classList.toggle("dark", t === "dark");
  } catch {}
})();
