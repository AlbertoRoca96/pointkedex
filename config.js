/* config.js – decide which back-end to call */

(() => {
  const qp = new URLSearchParams(window.location.search);
  const override = qp.get('api');

  const ensureSlash = url => (url.endsWith('/') ? url : url + '/');

  const HF_SPACE = 'https://AlbertoRoca96-web-pointkedex.hf.space/';

  const sameOrigin = location.origin.includes('.hf.space')
    ? ensureSlash(location.origin)
    : null;

  window.API_BASE = ensureSlash(
    override || sameOrigin || HF_SPACE
  );

  console.log('[config] API_BASE set to', window.API_BASE);
})();
