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
const $ = q => document.querySelector(q);
const show = el => el.style.display = "flex";
const hide = el => el.style.display = "none";

function mToFtIn(dm){               // decimetres → feet′in″
  const cm = dm * 10;
  const inches = cm / 2.54;
  const ft = Math.floor(inches / 12);
  const inch = Math.round(inches % 12);
  return `${ft}'${inch}"`;
}
function kgToLb(hg){                // hectograms → lb
  const kg = hg / 10;
  return `${kg.toFixed(1)} kg (${(kg*2.205).toFixed(1)} lb)`;
}
function renderStats(d){
  $("#stats-name").textContent = `${d.name}  (#${d.dex.toString().padStart(4,"0")})`;
  $("#stats-desc").textContent = d.description;
  const types = $("#stats-types"); types.innerHTML="";
  (d.types||[]).forEach(t=>{
    const s=document.createElement("span"); s.className="type"; s.textContent=t; types.appendChild(s);
  });
  const tbl=$("#stats-table"); tbl.innerHTML="";
  Object.entries(d.base_stats||{}).forEach(([k,v])=>{
    const tr=document.createElement("tr"); tr.innerHTML=`<td>${k}</td><td>${v}</td>`; tbl.appendChild(tr);
  });
  $("#stats-misc").textContent = `Abilities: ${(d.abilities||[]).join(", ")}\nHeight: ${mToFtIn(d.height)}  •  Weight: ${kgToLb(d.weight)}`;
}

/* ---------- main ---------- */
$("#start").onclick = async () => {
  if ("speechSynthesis" in window) try{ speechSynthesis.speak(new SpeechSynthesisUtterance("")); }catch{}
  $("#start").style.display="none";

  const cam=$("#cam"), work=$("#worker"), label=$("#label");
  const endpoint=(window.API_BASE||"")+"api/predict";

  async function openCam(){
    const ideal={facingMode:"environment",width:{ideal:1280},height:{ideal:720}};
    try{return await navigator.mediaDevices.getUserMedia({video:ideal});}
    catch{
      const dev=await navigator.mediaDevices.enumerateDevices();
      const rear=dev.find(d=>d.kind==="videoinput"&&/back/i.test(d.label));
      return navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:rear.deviceId},width:1280,height:720}});
    }
  }
  try{ cam.srcObject=await openCam(); await cam.play(); }catch(e){ $("#alert").textContent=e.message; return; }

  requestAnimationFrame(loop);

  async function loop(){
    if(speaking || $("#prompt").style.display==="flex" || $("#stats-panel").style.display==="flex") return;
    if(!cam.videoWidth) return requestAnimationFrame(loop);

    const p=cam.videoHeight>cam.videoWidth, s=p?cam.videoWidth:cam.videoHeight;
    work.width=work.height=s; const c=work.getContext("2d");
    if(p){ c.save(); c.translate(0,s); c.rotate(-Math.PI/2); c.drawImage(cam,(cam.videoHeight-s)/2,(cam.videoWidth-s)/2,s,s,0,0,s,s); c.restore(); }
    else { c.drawImage(cam,(cam.videoWidth-s)/2,(cam.videoHeight-s)/2,s,s,0,0,s,s); }

    const jpeg=work.toDataURL("image/jpeg",JPEG_QUAL);
    const r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({image:jpeg})});
    if(!r.ok) return requestAnimationFrame(loop);
    const {name,conf,stable}=await r.json();
    label.textContent=`${name} ${(conf*100).toFixed(1)} %`;

    const idx=labels.indexOf(name); same=idx===last?same+1:1; last=idx;
    const ready=stable===true ? stable : (same>=STABLE_N && conf>=CONF_THR);
    if(ready){ currentName=name; promptUser(name,conf); } else requestAnimationFrame(loop);
  }

  function promptUser(n,c){ $("#prompt-text").textContent=`Looks like ${n} (${(c*100).toFixed(1)}%). Show its stats?`; show($("#prompt")); }

  $("#btn-stats").onclick = async ()=>{
    hide($("#prompt"));
    const d=await fetch(`${window.API_BASE}api/pokemon/${currentName.toLowerCase()}`).then(r=>r.json());
    renderStats({...d,name:currentName});
    show($("#stats-panel"));
  };
  $("#btn-dismiss").onclick = ()=>{ hide($("#prompt")); requestAnimationFrame(loop); };
  $("#stats-close").onclick  = ()=>{ hide($("#stats-panel")); requestAnimationFrame(loop); };
};
