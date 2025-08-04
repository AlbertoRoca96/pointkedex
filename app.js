/* ---------- tunables ---------- */
const CONF_THR  = 0.20;   // min confidence to accept
const STABLE_N  = 3;      // identical frames required
const JPEG_QUAL = 0.85;   // transmitted JPEG quality
const RERENDER_COOLDOWN_MS = 2000; // don't re-render same name more often than this

/* ---------- globals ---------- */
let flavor        = {};
let labels        = [];
let lastIdx       = -1;
let same          = 0;
let speaking      = false;
let currentName   = "";
let promptVisible = false;
let predictCtrl   = null;
let allUsage      = {};          // cache of usage_data.json
let currentTiers  = new Set();   // active tier filters
let lastRenderedName = "";
let lastRenderTime = 0;

/* ---------- helpers ---------- */
const $      = q => document.querySelector(q);
const show   = el => el && (el.style.display = "flex");
const hide   = el => el && (el.style.display = "none");
const toID   = s => (typeof s === "string" ? s.toLowerCase().replace(/[^a-z0-9]/g, "") : "");
const makeUrl = p => `${(window.API_BASE || "").replace(/\/+$/, "")}/${p.replace(/^\/+/, "")}`;

/* ---------- asset loading ---------- */
async function loadAssets() {
  try {
    const [flavResp, clsResp, usageResp] = await Promise.all([
      fetch("flavor_text.json"),
      fetch("class_indices.json"),
      fetch("usage_data.json"),
    ]);

    if (!flavResp.ok)  console.warn("[loadAssets] flavor_text.json",  flavResp.status);
    if (!clsResp.ok)   console.warn("[loadAssets] class_indices.json", clsResp.status);
    if (!usageResp.ok) console.warn("[loadAssets] usage_data.json",   usageResp.status);

    flavor = flavResp.ok ? await flavResp.json() : {};
    const classIdx = clsResp.ok ? await clsResp.json() : {};
    labels = [];

    /* class_indices may be {name: idx} or {idx: name} */
    if (classIdx && typeof classIdx === "object") {
      Object.entries(classIdx).forEach(([k, v]) => {
        const name = isNaN(Number(k)) ? k : v;
        const idx  = isNaN(Number(k)) ? v : Number(k);
        labels[idx] = name;
      });
    }

    allUsage = usageResp.ok ? await usageResp.json() : {};
    console.log("[loadAssets] usage entries:", Object.keys(allUsage).length);
  } catch (e) {
    console.warn("[loadAssets] failed:", e);
    allUsage = {};
    flavor = {};
    labels = [];
  }
}

/* ---------- flavor text utility ---------- */
function getFlavorText(name) {
  if (!flavor || !name) return "";
  const f = flavor[name];
  if (!f) return "";
  if (typeof f === "string") return f;
  if (Array.isArray(f) && f.length) return f[Math.floor(Math.random() * f.length)];
  if (typeof f === "object") {
    if (f.default) return f.default;
    // pick first value
    const vals = Object.values(f);
    if (vals.length) return typeof vals[0] === "string" ? vals[0] : JSON.stringify(vals[0]);
  }
  return "";
}

/* ---------- parsing helper (preserved) ---------- */
function parseMoveBlob(blob = "") {
  const out = { name:"", effect:"", type:"", category:"", power:null, accuracy:null, priority:null, raw:blob };
  const m = (re, f = x => x) => { const r = blob.match(re); return r ? f(r[1]) : null; };
  out.name     = m(/^([A-Za-z0-9 \-]+)/,  x=>x.trim())                 || "";
  out.effect   = m(/^[A-Za-z0-9 \-]+(.*?)Type/, x=>x.trim())           || "";
  out.type     = m(/Type([A-Za-z]+)/i)                                 || "";
  out.category = m(/Category([A-Za-z]+)/i)                             || "";
  out.power    = m(/Power(\d+)/i,        x=>parseInt(x,10));
  out.accuracy = m(/Accuracy(\d+)%/i,    x=>`${x}%`);
  out.priority = m(/Priority(\d+)/i,     x=>parseInt(x,10));
  return out;
}

/* ---------- rendering / prediction display ---------- */
async function fetchAndRender(name, conf) {
  try {
    // Update the label (confidence display)
    const labelEl = $("#label");
    if (labelEl) labelEl.textContent = `${name} ${(conf * 100).toFixed(1)} %`;

    // Flavor text
    const flavorText = getFlavorText(name);
    // Usage data
    const usage = allUsage[name] || {};

    // Render into set-cards (fallback placeholder if missing)
    let cards = document.getElementById("set-cards");
    if (!cards) {
      // create a fallback container if none exists
      cards = document.createElement("div");
      cards.id = "set-cards";
      cards.style.padding = "10px";
      cards.style.maxWidth = "600px";
      cards.style.margin = "8px auto";
      cards.style.background = "#fff";
      cards.style.border = "1px solid #ccc";
      cards.style.fontFamily = "monospace";
      document.body.appendChild(cards);
    }
    cards.innerHTML = ""; // clear previous

    // Header
    const hdr = document.createElement("div");
    hdr.style.marginBottom = "8px";
    hdr.innerHTML = `<strong>Prediction:</strong> ${name} (${(conf * 100).toFixed(1)}%)`;
    cards.appendChild(hdr);

    // Flavor
    if (flavorText) {
      const flavDiv = document.createElement("div");
      flavDiv.style.marginBottom = "6px";
      flavDiv.textContent = `Flavor: ${flavorText}`;
      cards.appendChild(flavDiv);
    }

    // Usage summary
    const usageDiv = document.createElement("div");
    usageDiv.style.marginBottom = "6px";
    if (Object.keys(usage).length === 0) {
      usageDiv.textContent = "No usage data available for this prediction.";
    } else {
      // Pretty-print a limited view
      const pre = document.createElement("pre");
      pre.style.maxHeight = "250px";
      pre.style.overflow = "auto";
      pre.textContent = JSON.stringify(usage, null, 2);
      usageDiv.appendChild(pre);
    }
    cards.appendChild(usageDiv);

    // Optionally add a timestamp / last updated
    const foot = document.createElement("div");
    foot.style.fontSize = "0.8em";
    foot.style.color = "#666";
    foot.textContent = `Rendered at ${new Date().toLocaleTimeString()}`;
    cards.appendChild(foot);
  } catch (e) {
    console.warn("[fetchAndRender] error:", e);
  } finally {
    // Schedule next loop after render
    requestAnimationFrame(loop);
  }
}

/* ---------- measurement helpers ---------- */
const mToFtIn = dm => { const inch = dm * 3.937007874; return `${Math.floor(inch / 12)}'${Math.round(inch % 12)}`; };
const kgToLb  = hg => { const kg = hg / 10; return `${kg.toFixed(1)} kg (${(kg * 2.205).toFixed(1)} lb)`; };

/* ---------- main loop ---------- */
async function loop() {
  if (speaking || promptVisible || $("#stats-panel")?.style.display === "flex") {
    return requestAnimationFrame(loop);
  }

  const cam = $("#cam"), work = $("#worker");
  if (!cam || !work || !cam.videoWidth) return requestAnimationFrame(loop);

  // Square-crop and rotate if portrait
  const portrait = cam.videoHeight > cam.videoWidth;
  const s = portrait ? cam.videoWidth : cam.videoHeight;
  work.width = work.height = s;
  const ctx = work.getContext("2d");
  ctx.save();
  if (portrait) {
    ctx.translate(0, s);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(cam, (cam.videoHeight - s) / 2, (cam.videoWidth - s) / 2, s, s, 0, 0, s, s);
  } else {
    ctx.drawImage(cam, (cam.videoWidth - s) / 2, (cam.videoHeight - s) / 2, s, s, 0, 0, s, s);
  }
  ctx.restore();

  const jpeg = work.toDataURL("image/jpeg", JPEG_QUAL);
  if (predictCtrl) predictCtrl.abort();
  predictCtrl = new AbortController();
  const signal = predictCtrl.signal;

  let resp;
  try {
    resp = await fetch(makeUrl("api/predict"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: jpeg }),
      signal,
    });
  } catch (e) {
    if (e.name !== "AbortError") console.warn("[predict] network error:", e);
    return requestAnimationFrame(loop);
  }

  if (!resp || !resp.ok) {
    return requestAnimationFrame(loop);
  }

  let data = {};
  try {
    data = await resp.json();
  } catch (e) {
    return requestAnimationFrame(loop);
  }

  const { name = "", conf = 0, stable = false } = data;
  $("#label") && ($("#label").textContent = `${name} ${(conf * 100).toFixed(1)} %`);

  // Determine index for stability tracking
  const idx = labels.indexOf(name);
  same = idx === lastIdx ? same + 1 : 1;
  lastIdx = idx;
  const ready = stable || (same >= STABLE_N && conf >= CONF_THR);

  if (ready && name) {
    const now = Date.now();
    const shouldReRender = name !== lastRenderedName || (now - lastRenderTime) > RERENDER_COOLDOWN_MS;
    if (shouldReRender) {
      lastRenderedName = name;
      lastRenderTime = now;
      currentName = name;
      await fetchAndRender(name, conf);
    } else {
      // don't spam rendering; continue loop
      requestAnimationFrame(loop);
    }
  } else {
    requestAnimationFrame(loop);
  }
}

/* ---------- camera selection helpers ---------- */
async function chooseCamera() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }
    });
  } catch {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const rear = devices.find(d => d.kind === "videoinput" && /back/i.test(d.label));
      if (rear) {
        return navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: rear.deviceId }, width: 1280, height: 720 }
        });
      }
    } catch (e) {
      console.warn("[chooseCamera] fallback enumeration failed:", e);
    }
    // last resort
    return navigator.mediaDevices.getUserMedia({ video: true });
  }
}

/* ---------- bootstrap ---------- */
document.addEventListener("DOMContentLoaded", () => {
  $("#start")?.addEventListener("click", async () => {
    hide($("#start"));
    await loadAssets();

    const cam = $("#cam");
    try {
      cam.srcObject = await chooseCamera();
      await cam.play();
    } catch (e) {
      $("#alert") && ($("#alert").textContent = e.message);
      console.warn("[camera] failed to start:", e);
      return;
    }

    requestAnimationFrame(loop);
  });

  $("#stats-close")?.addEventListener("click", () => hide($("#stats-panel")));
});
