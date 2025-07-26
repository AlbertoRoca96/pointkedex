(() => {
  const urlParam = new URLSearchParams(window.location.search).get("api");
  window.API_BASE = urlParam || "";   // "" == same origin
})();
