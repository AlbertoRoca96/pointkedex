/* ---------- tunables ---------- */
const CONF_THR = 0.20;
const STABLE_N = 3;
const RESUME_MS = 6000;
const JPEG_QUAL = 0.85;

/* ---------- globals ---------- */
let flavor = {}, labels = [];
let last = -1, same = 0, speaking = false;
let currentName = "";

/* ---------- preload assets ---------- */
(async () => {
  flavor = await fetch("flavor_text.json").then(r => r.json());
  labels = Object.entries(await fetch("class_indices.json").then(r => r.json()))
                 .reduce((a,[n,i]) => (a[i]=n, a), []);
})();

/* ---------- helpers ---------- */
const $   = q => document.querySelector(q);
const show = el => el.style.display = "flex";
const hide = el => el.style.display = "none";

/* ----- text-to-speech helper (unchanged) ---------- */
function speakText(txt){
  if(!("speechSynthesis" in window) || !txt) return;
  try{ speechSynthesis.cancel(); }catch{}
  speaking = true;
  const u = new SpeechSynthesisUtterance(txt);
  u.onend = u.onerror = () => { speaking = false; requestAnimationFrame(loop); };
  speechSynthesis.speak(u);
}

/* ----- unit converters ---------- */
const mToFtIn = dm => {
  const inches = dm * 3.937007874;
  return `${Math.floor(inches/12)}'${Math.round(inches%12)}"`;
};
const kgToLb = hg => {
  const kg = hg / 10;
  return `${kg.toFixed(1)} kg (${(kg*2.205).toFixed(1)} lb)`;
};

/* ----- renderers ---------- */
function renderUsage(u){
  const box = $("#stats-usage");
  box.innerHTML = "";

  /* nothing came back (or slug not present) */
  if(!u || (!u.moves?.length && !u.abilities?.length && !u.items?.length)){
    box.style.display = "none";
    return;
  }
  box.style.display = "block";

  const sect = (label,list)=> {
    if(!list?.length) return;
    const span = document.createElement("span");
    span.textContent = label+": ";
    box.appendChild(span);
    list.slice(0,6).forEach(v=>{
      const t=document.createElement("span");
      t.className="tag";
      t.textContent=v;
      box.appendChild(t);
    });
    box.appendChild(document.createElement("br"));
  };
  sect("Moves"    , u.moves);
  sect("Abilities", u.abilities);
  sect("Items"    , u.items);
}

function renderStats(d){
  $("#stats-name").textContent =
    `${d.name}  (#${String(d.dex).padStart(4,"0")})`;
  $("#stats-desc").textContent = d.description;

  const types = $("#stats-types"); types.innerHTML="";
  (d.types||[]).forEach(t=>{
    const s=document.createElement("span");
    s.className="type";
    s.textContent=t;
    types.appendChild(s);
  });

  $("#stats-abilities").textContent =
    `Abilities: ${(d.abilities||[]).join(", ")}`;

  const tbl=$("#stats-table"); tbl.innerHTML="";
  Object.entries(d.base_stats||{}).forEach(([k,v])=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${k}</td><td>${v}</td>`;
    tbl.appendChild(tr);
  });

  $("#stats-misc").textContent =
    `Height: ${mToFtIn(d.height)}   •   Weight: ${kgToLb(d.weight)}`;

  /* fetch & render competitive usage ------------- */
  fetch(`${window.API_BASE}api/usage/${d.name.toLowerCase()}`)
    .then(r=>r.ok?r.json():{})
    .then(renderUsage)
    .catch(()=>{});
}

/* ---------- main ---------- */
$("#start").onclick = async () => {
  if ("speechSynthesis" in window)
    try{ speechSynthesis.speak(new SpeechSynthesisUtterance("")); }catch{}
  $("#start").style.display = "none";

  const cam=$("#cam"), work=$("#worker"), label=$("#label");
  const endpoint = (window.API_BASE||"") + "api/predict";

  async function openCam(){
    const ideal={facingMode:"environment",width:{ideal:1280},height:{ideal:720}};
    try{ return await navigator.mediaDevices.getUserMedia({video:ideal}); }
    catch{
      const dev=await navigator.mediaDevices.enumerateDevices();
      const rear=dev.find(d=>d.kind==="videoinput" && /back/i.test(d.label));
      return navigator.mediaDevices.getUserMedia({
        video:{deviceId:{exact:rear.deviceId},width:1280,height:720}
      });
    }
  }
  try{ cam.srcObject = await openCam(); await cam.play(); }
  catch(e){ $("#alert").textContent = e.message; return; }

  requestAnimationFrame(loop);

  async function loop(){
    if(speaking || $("#prompt").style.display==="flex"
                 || $("#stats-panel").style.display==="flex")
        return;

    if(!cam.videoWidth) return requestAnimationFrame(loop);

    const p = cam.videoHeight > cam.videoWidth;
    const s = p ? cam.videoWidth : cam.videoHeight;
    work.width = work.height = s;
    const ctx = work.getContext("2d");
    if(p){
      ctx.save(); ctx.translate(0,s); ctx.rotate(-Math.PI/2);
      ctx.drawImage(cam,(cam.videoHeight-s)/2,(cam.videoWidth-s)/2,s,s,0,0,s,s);
      ctx.restore();
    }else{
      ctx.drawImage(cam,(cam.videoWidth-s)/2,(cam.videoHeight-s)/2,s,s,0,0,s,s);
    }

    const jpeg = work.toDataURL("image/jpeg",JPEG_QUAL);
    const r = await fetch(endpoint,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({image:jpeg})
    });
    if(!r.ok) return requestAnimationFrame(loop);

    const {name,conf,stable} = await r.json();
    label.textContent = `${name} ${(conf*100).toFixed(1)} %`;

    const idx = labels.indexOf(name);
    same = idx===last ? same+1 : 1;   last = idx;
    const ready = stable===true ? true : (same>=STABLE_N && conf>=CONF_THR);
    if(ready){ currentName=name; promptUser(name,conf); }
    else requestAnimationFrame(loop);
  }

  function promptUser(n,c){
    $("#prompt-text").textContent =
      `Looks like ${n} (${(c*100).toFixed(1)}%). Show its stats?`;
    show($("#prompt"));
  }

  $("#btn-stats").onclick = async ()=>{
    hide($("#prompt"));
    const d = await fetch(
      `${window.API_BASE}api/pokemon/${currentName.toLowerCase()}`
    ).then(r=>r.json());
    renderStats({...d, name:currentName});
    show($("#stats-panel"));

    const speakTxt = d.description
                 || (flavor[currentName.toLowerCase()]?.[0] || "");
    speakText(speakTxt);
  };
  $("#btn-dismiss").onclick = ()=>{ hide($("#prompt")); requestAnimationFrame(loop); };
  $("#stats-close").onclick  = ()=>{ hide($("#stats-panel")); requestAnimationFrame(loop); };
};
