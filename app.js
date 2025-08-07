/* ---------- tunables ---------- */
const CONF_THR = 0.20;
const STABLE_N = 3;
const JPEG_QUAL = 0.85;

/* ---------- globals ---------- */
let flavor = {};
let labels = [];
let last = -1, same = 0;
let speaking = false;
let currentName = "";
let promptVisible = false;
let predictController = null;

/* ---------- preload assets ---------- */
async function loadAssets() {
  try {
    const [flavResp, classResp] = await Promise.all([
      fetch("flavor_text.json"),
      fetch("class_indices.json"),
    ]);
    flavor = flavResp.ok ? await flavResp.json() : {};
    const classIndices = classResp.ok ? await classResp.json() : {};
    labels = [];
    if (classIndices && typeof classIndices === "object") {
      Object.entries(classIndices).forEach(([name, idx]) => {
        if (typeof idx === "number") labels[idx] = name;
        else if (!isNaN(Number(name))) labels[Number(name)] = idx;
      });
    }
  } catch (e) {
    console.warn("[app.js] failed to preload assets:", e);
  }
}

/* ---------- helpers ---------- */
const $ = q => document.querySelector(q);
const show = el => el && (el.style.display = "flex");
const hide = el => el && (el.style.display = "none");
const toID = s => (typeof s === "string" ? s.toLowerCase().replace(/[^a-z0-9]/g, "") : "");
const makeUrl = path => {
  const base = (window.API_BASE || "").replace(/\/+$/, "");
  return `${base}/${path.replace(/^\/+/, "")}`;
};
const debug = (...args) => console.debug("[app.js]", ...args);

/* ----- text-to-speech helper ---------- */
function speakText(txt) {
  if (!("speechSynthesis" in window) || !txt) return;
  try { speechSynthesis.cancel(); } catch {}
  speaking = true;
  const u = new SpeechSynthesisUtterance(txt);
  u.onend = u.onerror = () => {
    speaking = false;
    requestAnimationFrame(loop);
  };
  speechSynthesis.speak(u);
}

/* ----- unit converters ---------- */
const mToFtIn = dm => {
  const inches = dm * 3.937007874;
  return `${Math.floor(inches/12)}'${Math.round(inches%12)}"`;
};
const kgToLb = hg => {
  const kg = hg/10;
  return `${kg.toFixed(1)} kg (${(kg*2.205).toFixed(1)} lb)`;
};

/* ----- NEW helpers for prettier set display ---------- */
const cleanMove = m => {
  if (typeof m !== "string") return "";
  // strip off any Type…Category…Power…Accuracy metadata
  const cut = m.match(/(Type[A-Za-z]+Category[A-Za-z]+Power[0-9]+BPAccuracy[0-9%]+)/);
  return cut ? m.slice(0, cut.index).trim() : m.trim();
};
const formatEV = ev =>
  typeof ev === "string"
    ? ev
    : Object.entries(ev || {})
        .map(([k, v]) => `${v} ${k.toUpperCase()}`)
        .join(" / ");

/* detect whether a line is a “move” vs. EV/IV/credits */
function isMoveLine(line) {
  // we assume moves always contain Type…Category markers
  return /Type[A-Za-z]+Category[A-Za-z]+Power/.test(line);
}
function isCreditsLine(line) {
  return /Written by|Quality checked|Grammar checked/.test(line);
}

/* ----- usage render helpers ---------- */
function renderUsageSummary(u) {
  const box = $("#stats-usage");
  if (!box) return;
  box.innerHTML = "";

  if (!u || (!u.moves?.length && !u.abilities?.length && !u.items?.length)) {
    box.style.display = "block";
    const msg = document.createElement("div");
    msg.textContent = "No competitive usage data yet.";
    msg.style.fontStyle = "italic";
    box.appendChild(msg);
    debug("no usage data to render", u);
    return;
  }

  box.style.display = "block";
  ["Moves", "Abilities", "Items"].forEach(label => {
    const key = label.toLowerCase();
    const list = u[key];
    if (!list?.length) return;
    const span = document.createElement("span");
    span.textContent = label + ": ";
    box.appendChild(span);
    list.slice(0, 6).forEach(v => {
      const t = document.createElement("span");
      t.className = "tag";
      t.textContent = v;
      box.appendChild(t);
    });
    box.appendChild(document.createElement("br"));
  });
}

function buildTierTabs(fullSets) {
  let tabs = $("#usage-tabs"), content = $("#usage-content");
  if (!tabs) {
    tabs = document.createElement("div");
    tabs.id = "usage-tabs";
    tabs.classList.add("tab-strip");
    $("#stats-panel .card").appendChild(tabs);
  }
  if (!content) {
    content = document.createElement("div");
    content.id = "usage-content";
    $("#stats-panel .card").appendChild(content);
  }
  tabs.innerHTML = "";
  content.innerHTML = "";

  const tiers = Object.keys(fullSets || {}).sort();
  if (!tiers.length) return;

  function activate(tier) {
    tabs.querySelectorAll("button").forEach(b => b.classList.remove("active"));
    const btn = tabs.querySelector(`button[data-tier='${tier}']`);
    if (btn) btn.classList.add("active");
    renderTierSets(fullSets[tier], content);
  }

  tiers.forEach((t, i) => {
    const b = document.createElement("button");
    b.classList.add("tab-btn");
    b.textContent = t;
    b.dataset.tier = t;
    b.addEventListener("click", () => activate(t));
    tabs.appendChild(b);
    if (i === 0) activate(t);
  });
}

function renderTierSets(list, container) {
  container.innerHTML = "";
  if (!Array.isArray(list) || !list.length) {
    const p = document.createElement("p");
    p.textContent = "No sets for this tier.";
    p.style.fontStyle = "italic";
    container.appendChild(p);
    return;
  }

  list.forEach(set => {
    // split out moves vs metadata vs credits
    const moves = set.moves.filter(isMoveLine);
    const metadata = set.moves.filter(m => !isMoveLine(m) && !isCreditsLine(m));
    const credits = set.moves.filter(isCreditsLine);

    const card = document.createElement("div");
    card.classList.add("set-card");

    // header
    const header = document.createElement("div");
    header.classList.add("set-card-header");
    const title = document.createElement("div");
    title.classList.add("set-card-title");
    title.textContent = set.name || "";
    header.appendChild(title);
    card.appendChild(header);

    // body grid
    const body = document.createElement("div");
    body.classList.add("set-card-body");

    // moves column
    const movesCol = document.createElement("div");
    if (moves.length) {
      const ol = document.createElement("ol");
      moves.forEach(m => {
        const li = document.createElement("li");
        li.textContent = cleanMove(m);
        // tooltip shows remainder (type/category/etc.)
        const extra = m.slice(cleanMove(m).length).trim();
        if (extra) li.title = extra;
        ol.appendChild(li);
      });
      movesCol.appendChild(ol);
    }
    body.appendChild(movesCol);

    // metadata column
    const metaCol = document.createElement("div");
    const dl = document.createElement("dl");
    dl.classList.add("set-meta");
    metadata.forEach(line => {
      // e.g. "Jolly" or "252 Atk" or "4 SpD" or "Dark / Fighting / Fire"
      let [key, val] = ["", line];
      // guess key by pattern:
      if (/^[0-9]+ /.test(line)) key = "EVs/IVs";
      else if (/^(Adamant|Jolly|Timid)/i.test(line)) key = "Nature";
      else key = ""; 
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      if (key) {
        dt.textContent = key + ":";
        dd.textContent = val;
        dl.appendChild(dt);
        dl.appendChild(dd);
      } else {
        // unkeyed metadata (e.g. ability, tera type) live under their own dt
        const parts = val.split(/Holder's|Type/).map(s=>s.trim()).filter(Boolean);
        parts.forEach(p => {
          const dtk = document.createElement("dt");
          const ddv = document.createElement("dd");
          dtk.textContent = "Info:";
          ddv.textContent = p;
          dl.appendChild(dtk);
          dl.appendChild(ddv);
        });
      }
    });
    metaCol.appendChild(dl);
    body.appendChild(metaCol);

    card.appendChild(body);

    // credits block
    if (credits.length) {
      const credDiv = document.createElement("div");
      credDiv.style.padding = "8px 12px";
      credDiv.style.borderTop = "1px solid #555";
      credDiv.style.fontSize = ".75rem";
      credits.forEach(c => {
        const p = document.createElement("p");
        p.textContent = c;
        credDiv.appendChild(p);
      });
      card.appendChild(credDiv);
    }

    container.appendChild(card);
  });
}

/* ----- main stats renderer ---------- */
function renderStats(d) {
  $("#stats-name").textContent = `${d.name}  (#${String(d.dex).padStart(4,"0")})`;
  $("#stats-desc").textContent = d.description || "";

  const types = $("#stats-types");
  types.innerHTML = "";
  (d.types||[]).forEach(t => {
    const s = document.createElement("span");
    s.className = "type";
    s.textContent = t;
    types.appendChild(s);
  });

  $("#stats-abilities").textContent = `Abilities: ${(d.abilities||[]).join(", ")}`;

  const tbl = $("#stats-table");
  tbl.innerHTML = "";
  Object.entries(d.base_stats||{}).forEach(([k,v]) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${k}</td><td>${v}</td>`;
    tbl.appendChild(tr);
  });

  $("#stats-misc").textContent = `Height: ${mToFtIn(d.height)}   •   Weight: ${kgToLb(d.weight)}`;

  const slug = toID(d.name);
  debug("fetching usage for", d.name, "slug:", slug);
  fetch(makeUrl(`api/usage/${slug}`))
    .then(r => r.ok ? r.json() : {})
    .then(u => {
      renderUsageSummary(u);
      buildTierTabs(u.full_sets || {});
    })
    .catch(e => console.warn("[usage] error for slug", slug, e));
}

/* ---------- core loop ---------- */
async function loop() {
  if (speaking || promptVisible || $("#stats-panel")?.style.display==="flex") return;

  const cam = $("#cam"), work = $("#worker"), label = $("#label");
  if (!cam || !work || !label || !cam.videoWidth) {
    return requestAnimationFrame(loop);
  }

  const portrait = cam.videoHeight > cam.videoWidth;
  const s = portrait ? cam.videoWidth : cam.videoHeight;
  work.width = work.height = s;
  const ctx = work.getContext("2d");

  if (portrait) {
    ctx.save();
    ctx.translate(0, s);
    ctx.rotate(-Math.PI/2);
    ctx.drawImage(cam,
      (cam.videoHeight-s)/2,
      (cam.videoWidth-s)/2,
      s,s,0,0,s,s
    );
    ctx.restore();
  } else {
    ctx.drawImage(cam,
      (cam.videoWidth-s)/2,
      (cam.videoHeight-s)/2,
      s,s,0,0,s,s
    );
  }

  const jpeg = work.toDataURL("image/jpeg", JPEG_QUAL);
  const endpoint = makeUrl("api/predict");

  if (predictController) predictController.abort();
  predictController = new AbortController();
  const signal = predictController.signal;

  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({image: jpeg}),
      signal,
    });
  } catch (e) {
    if (e.name === "AbortError") return;
    console.warn("[predict] network error", e);
    return requestAnimationFrame(loop);
  }

  if (!res.ok) return requestAnimationFrame(loop);

  let data;
  try {
    data = await res.json();
  } catch {
    console.warn("[predict] parse error");
    return requestAnimationFrame(loop);
  }

  const {name="", conf=0, stable=false} = data;
  label.textContent = `${name} ${(conf*100).toFixed(1)} %`;

  const idx = labels.indexOf(name);
  same = idx===last ? same+1 : 1;
  last = idx;
  const ready = stable || (same>=STABLE_N && conf>=CONF_THR);

  if (ready && name) {
    currentName = name;
    promptUser(name, conf);
  } else {
    requestAnimationFrame(loop);
  }
}

/* ---------- prompt + UI wiring ---------- */
function promptUser(n,c){
  $("#prompt-text").textContent = `Looks like ${n} (${(c*100).toFixed(1)}%). Show its stats?`;
  show($("#prompt"));
  promptVisible = true;
}

/* ---------- main ---------- */
$("#start").onclick = async () => {
  if ("speechSynthesis" in window)
    try{ speechSynthesis.speak(new SpeechSynthesisUtterance("")); }catch{}

  hide($("#start"));
  await loadAssets();

  const cam = $("#cam");
  const openCam = async () => {
    const ideal = {facingMode:"environment", width:{ideal:1280}, height:{ideal:720}};
    try { return await navigator.mediaDevices.getUserMedia({video:ideal}); }
    catch {
      const dev = await navigator.mediaDevices.enumerateDevices();
      const rear = dev.find(d=>d.kind==="videoinput"&&/back/i.test(d.label));
      if (rear) return navigator.mediaDevices.getUserMedia({
        video:{deviceId:{exact:rear.deviceId}, width:1280, height:720}
      });
      return navigator.mediaDevices.getUserMedia({video:true});
    }
  };

  try { cam.srcObject = await openCam(); await cam.play(); }
  catch (e) { $("#alert").textContent = e.message; return; }

  requestAnimationFrame(loop);
};

$("#btn-stats").onclick = async ()=>{
  hide($("#prompt")); promptVisible = false;
  const slug = toID(currentName);
  debug("stats requested for", currentName, "slug:", slug);
  let d = {};
  try {
    const r = await fetch(makeUrl(`api/pokemon/${slug}`));
    if (r.ok) d = await r.json();
    else console.warn("pokemon fetch failed", r.status);
  } catch (e) { console.warn("pokemon fetch error", e); }
  renderStats({...d, name:currentName});
  show($("#stats-panel"));

  const txt = d.description || (flavor[currentName.toLowerCase()]?.[0]||"");
  speakText(txt);
};

$("#btn-dismiss").onclick = ()=>{
  hide($("#prompt"));
  promptVisible = false;
  requestAnimationFrame(loop);
};

$("#stats-close").onclick = ()=>{
  hide($("#stats-panel"));
  requestAnimationFrame(loop);
};
