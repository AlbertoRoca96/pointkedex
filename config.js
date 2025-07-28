(() => {
  // If the page is opened with  ?api=https://your-backend/
  // use that; otherwise fall back to the hard‑coded default.
  const param = new URLSearchParams(window.location.search).get('api');

  // Always end with a slash so app.js can append "api/predict".
  const ensureSlash = url => (url.endsWith('/') ? url : url + '/');

  window.API_BASE = param
    ? ensureSlash(param)
    : 'https://pup-cloud-gvfdfae9fbcqddex.canadacentral-01.azurewebsites.net/';
})();
