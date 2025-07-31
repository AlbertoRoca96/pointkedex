/* config.js – decide which back-end to call */

(() => {
  // 1) Check for ?api=https://foo.bar/ override in the address bar.
  const qp = new URLSearchParams(window.location.search);
  const override = qp.get('api');

  // 2) Helper: always end URLs with one trailing slash.
  const ensureSlash = url => (url.endsWith('/') ? url : url + '/');

  // 3) Default to your Hugging Face Space.
  //    Change only the sub-domain if you rename the Space later.
  const HF_SPACE = 'https://AlbertoRoca96-web-pointkedex-api.hf.space/';

  // 4) If this page is being served *inside* that Space, you can derive the
  //    origin dynamically (useful when you `docker run` locally):
  const sameOrigin = location.origin.includes('.hf.space')
    ? ensureSlash(location.origin)
    : null;

  // 5) Pick the winner in priority order: query-param → same-origin → default.
  window.API_BASE = ensureSlash(
    override || sameOrigin || HF_SPACE
  );

  // 6) For debugging:
  console.log('[config] API_BASE set to', window.API_BASE);
})();
