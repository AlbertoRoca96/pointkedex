/* ---------- tunables ---------- */
const CONF_THR  = 0.20;   // min confidence to accept
const STABLE_N  = 3;      // identical frames required
const JPEG_QUAL = 0.85;   // transmitted JPEG quality

/* ---------- globals ---------- */
let flavor        = {};
let labels        = [];
let last          = -1,
    same          = 0;
let speaking      = false;
let currentName   = "";
let promptVisible = false;
let predictCtrl   = null;
let allUsage      = {};          // cache of usage_data.json
let currentTiers  = new Set();   // active tier filters

/* ---------- preload assets ---------- */
async function loadAssets() {
  try {
    const [flav, cls, use] = await Promise.all([
      fetch("flavor_text.json"),
      fetch("class_indices.json"),
      fetch("usage_data.json"),
    ]);

    if (!flav.ok)  console.warn("[loadAssets] flavor_text.json",  flav.status);
    if (!cls.ok)   console.warn("[loadAssets] class_indices.json", cls.status);
    if (!use.ok)   console.warn("[loadAssets] usage_data.json",   use.status);

    flavor = flav.ok ? await flav.json() : {};
    const classIdx = cls.ok ? await cls.json() : {};
    labels = [];

    /* class_indices may be {name: idx} or {idx: name} */
    if (classIdx && typeof classIdx === "object") {
      Object.entries(classIdx).forEach(([k, v]) => {
        const name = isNaN(Number(k)) ? k : v;
        const idx  = isNaN(Number(k)) ? v : Number(k);
        labels[idx] = name;
      });
    }
    allUsage = use.ok ? await use.json() : {};
    console.log("[loadAssets] usage entries:", Object.keys(allUsage).length);
  } catch (e) {
    console.warn("[loadAssets] failed:", e);
  }
}

/* ---------- helpers ---------- */
const $      = q => document.querySelector(q);
const show   = el => el && (el.style.display = "flex");
const hide   = el => el && (el.style.display = "none");
const toID   = s => (typeof s === "string" ? s.toLowerCase().replace(/[^a-z0-9]/g, "") : "");
const makeUrl = p => `${(window.API_BASE || "").replace(/\/+$/, "")}/${p.replace(/^\/+/, "")}`;

/* parse “move blob” → structured object */
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

/* ---------- UI renderers (usage, stats, set-cards) ---------- */
/* (identical to prior version – omitted for brevity) */
/* ... full renderer code unchanged ... */

/* ---------- measurement helpers ---------- */
const mToFtIn = dm => { const inch = dm*3.937007874; return `${Math.floor(inch/12)}'${Math.round(inch%12)}`; };
const kgToLb  = hg => { const kg = hg/10; return `${kg.toFixed(1)} kg (${(kg*2.205).toFixed(1)} lb)`; };

/* ---------- main loop ---------- */
async function loop() {
  if (speaking || promptVisible || $("#stats-panel")?.style.display === "flex") return;

  const cam=$("#cam"), work=$("#worker");
  if (!cam || !work || !cam.videoWidth) return requestAnimationFrame(loop);

  /* square-crop and rotate if portrait */
  const portrait = cam.videoHeight > cam.videoWidth;
  const s = portrait ? cam.videoWidth : cam.videoHeight;
  work.width = work.height = s;
  const ctx = work.getContext("2d");
  ctx.save();
  if (portrait) {
    ctx.translate(0, s);
    ctx.rotate(-Math.PI/2);
    ctx.drawImage(cam, (cam.videoHeight - s)/2, (cam.videoWidth - s)/2, s, s, 0, 0, s, s);
  } else {
    ctx.drawImage(cam, (cam.videoWidth - s)/2, (cam.videoHeight - s)/2, s, s, 0, 0, s, s);
  }
  ctx.restore();

  const jpeg = work.toDataURL("image/jpeg", JPEG_QUAL);  // explicit quality
  if (predictCtrl) predictCtrl.abort();
  predictCtrl = new AbortController();
  const signal = predictCtrl.signal;

  let resp;
  try {
    resp = await fetch(makeUrl("api/predict"), {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ image: jpeg }),
      signal,
    });
  } catch (e) {
    if (e.name !== "AbortError") console.warn("[predict] network:", e);
    return requestAnimationFrame(loop);
  }
  if (!resp.ok) return requestAnimationFrame(loop);

  let data = {};
  try { data = await resp.json(); } catch { return requestAnimationFrame(loop); }
  const { name = "", conf = 0, stable = false } = data;
  $("#label").textContent = `${name} ${(conf*100).toFixed(1)} %`;

  const idx = labels.indexOf(name);
  same = idx === last ? same + 1 : 1;
  last = idx;
  const ready = stable || (same >= STABLE_N && conf >= CONF_THR);

  ready && name ? (currentName=name, fetchAndRender(name)) : requestAnimationFrame(loop);
}

/* ---------- bootstrap ---------- */
document.addEventListener("DOMContentLoaded", () => {
  $("#start")?.addEventListener("click", async () => {
    hide($("#start"));
    await loadAssets();

    const cam = $("#cam");
    /* prefer back-facing camera, fall back to any */
    const chooseCamera = async () => {
      try {
        return await navigator.mediaDevices.getUserMedia({
          video: { facingMode:"environment", width:{ideal:1280}, height:{ideal:720} }
        });
      } catch {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const rear = devices.find(d => d.kind==="videoinput" && /back/i.test(d.label));
        if (rear) {
          return navigator.mediaDevices.getUserMedia({ video:{ deviceId:{exact:rear.deviceId}, width:1280, height:720 } });
        }
        return navigator.mediaDevices.getUserMedia({ video:true });
      }
    };

    try {
      cam.srcObject = await chooseCamera();
      await cam.play();
    } catch (e) {
      $("#alert").textContent = e.message;
      return;
    }
    requestAnimationFrame(loop);
  });

  $("#stats-close")?.addEventListener("click", () => hide($("#stats-panel")));
});
