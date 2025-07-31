/* ---------- tunables ---------- */
const CONF_THR   = 0.20;   // speak ≥ 20%
const STABLE_N   = 3;      // identical idx frames before lock
const RESUME_MS  = 6000;
const JPEG_QUAL  = 0.85;

/* ---------- globals ---------- */
let flavor = {};
let labels = [];
let last = -1, same = 0, speaking = false;

/* ---------- preload assets ---------- */
(async () => {
  flavor = await fetch("flavor_text.json").then(r => r.json());
  labels = Object.entries(await fetch("class_indices.json").then(r => r.json()))
                 .reduce((arr, [n, i]) => (arr[i] = n, arr), []);
})();

/* ---------- main entry ---------- */
document.getElementById("start").onclick = async () => {
  if ("speechSynthesis" in window) {
    try { speechSynthesis.speak(new SpeechSynthesisUtterance("")); } catch {}
  } else {
    alert("🔇 This device lacks speech-synthesis support.");
  }

  document.getElementById("start").style.display = "none";

  const cam    = document.getElementById("cam");
  const worker = document.getElementById("worker");
  const label  = document.getElementById("label");
  const endpoint = (window.API_BASE || "") + "api/predict";

  async function openCamera () {
    const ideal = {
      facingMode: "environment",
      width : { ideal: 1280 },
      height: { ideal: 720  }
    };
    try { return await navigator.mediaDevices.getUserMedia({ video: ideal }); }
    catch {
      const devs = await navigator.mediaDevices.enumerateDevices();
      const rear = devs.find(d => d.kind === "videoinput" && /back/i.test(d.label));
      if (!rear) throw new Error("no rear camera");
      return navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: rear.deviceId }, width: 1280, height: 720 }
      });
    }
  }

  let stream;
  try { stream = await openCamera(); }
  catch (e) { alert("❌ camera error (“" + e.message + "”)"); return; }

  cam.srcObject = stream;
  await cam.play();
  requestAnimationFrame(loop);

  async function loop () {
    if (speaking) return;

    if (!cam.videoWidth || !cam.videoHeight) {
      return requestAnimationFrame(loop);
    }

    const portrait = cam.videoHeight > cam.videoWidth;
    const s = portrait ? cam.videoWidth : cam.videoHeight;
    worker.width = worker.height = s;
    const ctx = worker.getContext("2d");

    if (portrait) {
      ctx.save();
      ctx.translate(0, s);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(
        cam,
        (cam.videoHeight - s) / 2,
        (cam.videoWidth  - s) / 2,
        s, s, 0, 0, s, s
      );
      ctx.restore();
    } else {
      ctx.drawImage(
        cam,
        (cam.videoWidth  - s) / 2,
        (cam.videoHeight - s) / 2,
        s, s, 0, 0, s, s
      );
    }

    const jpeg = worker.toDataURL("image/jpeg", JPEG_QUAL);
    let res;
    try {
      res = await fetch(endpoint, {
        method : "POST",
        headers: { "Content-Type": "application/json" },
        body   : JSON.stringify({ image: jpeg })
      });
    } catch {
      alert("❌ network error");
      return;
    }
    if (!res.ok) { alert("API error"); return; }

    const { name, conf, stable } = await res.json();
    label.textContent = `${name}  ${(conf * 100).toFixed(1)} %`;

    const idx = labels.indexOf(name);
    same = (idx === last ? same + 1 : 1);
    last = idx;

    // Use backend stable if provided; otherwise fallback to frontend logic
    const shouldSpeak = stable === true ? stable : (same >= STABLE_N && conf >= CONF_THR);
    if (shouldSpeak) speak(name);
    else requestAnimationFrame(loop);
  }

  function speak (poke) {
    if (!("speechSynthesis" in window)) return;

    const key = poke.toLowerCase().replace(/[^a-z0-9-]/g, "");
    const txt = flavor[key]?.[0];
    if (!txt) { same = 0; return requestAnimationFrame(loop); }

    speaking = true;
    speechSynthesis.cancel();

    const u = new SpeechSynthesisUtterance(txt);
    const resume = () => {
      if (!speaking) return;
      speaking = false;
      same = 0;
      requestAnimationFrame(loop);
    };
    u.onend   = resume;
    u.onerror = resume;
    setTimeout(resume, RESUME_MS);

    speechSynthesis.speak(u);
  }
};
