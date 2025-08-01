from __future__ import annotations
import base64, io, json, os, re, sys, time
from collections import deque
from pathlib import Path
from typing import Any, Dict, Tuple

import numpy as np
import tensorflow as tf
from PIL import Image
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

# ────────────────────────────
# Config / paths
# ────────────────────────────
ROOT        = Path(__file__).resolve().parent
MODEL_PATH  = Path(os.getenv("MODEL_PATH",  ROOT / "pokedex_resnet50.h5"))
LABEL_PATH  = Path(os.getenv("LABELS_PATH", ROOT / "class_indices.json"))
DEX_PATH    = Path(os.getenv("DEX_PATH",   ROOT / "pokedex_data.json"))
USAGE_PATH  = Path(os.getenv("USAGE_PATH", ROOT / "usage_data.json"))

INPUT_SIZE  = (224, 224)
CONF_THRESH = float(os.getenv("CONF_THRESH", 0.05))

THRESH_CONF = 0.20       # ≥20 % conf
STABLE_CNT  = 3          # …for 3 frames

# ────────────────────────────
# Load model & data once
# ────────────────────────────
print("[⇢] loading model…", file=sys.stderr)
model = tf.keras.models.load_model(MODEL_PATH, compile=False)
print("[✓] model ready", file=sys.stderr)

def load_labels() -> Dict[int, str]:
    raw = json.loads(LABEL_PATH.read_text('utf-8'))
    if all(k.isdigit() for k in raw):
        return {int(k): v for k, v in raw.items()}
    if all(isinstance(v, int) for v in raw.values()):
        return {v: k for k, v in raw.items()}
    raise ValueError("class_indices.json schema unknown")

IDX2NAME = load_labels()
POKEDEX  = json.loads(DEX_PATH.read_text('utf-8'))
USAGE    = json.loads(USAGE_PATH.read_text('utf-8')) if USAGE_PATH.exists() else {}
print(f"[✓] {len(IDX2NAME)} labels, {len(POKEDEX)} dex entries, {len(USAGE)} usage", file=sys.stderr)

# helper to normalise show-down ids  -------------------------
_RX_ID = re.compile(r"[^a-z0-9]+")
def ps_id(name: str) -> str:
    return _RX_ID.sub("", name.lower())

# ────────────────────────────
# Flask
# ────────────────────────────
app = Flask(__name__, static_folder=str(ROOT))
CORS(app)

_recent: Dict[str, deque[Tuple[int, float]]] = {}
def cid() -> str:                       # client id for stability tracking
    return request.headers.get("X-Client-ID", request.remote_addr or "anon")

# ---------- static files ----------
@app.route("/")
def root(): return send_from_directory(str(ROOT), "index.html")
@app.route("/<path:p>")
def static_file(p: str): return send_from_directory(str(ROOT), p)

# ---------- image classifier ----------
def preprocess(b64: str) -> np.ndarray:
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    rgb = Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB").resize(INPUT_SIZE)
    arr = tf.keras.preprocessing.image.img_to_array(rgb)
    arr = tf.keras.applications.resnet50.preprocess_input(arr)
    return arr[None]

@app.route('/api/predict', methods=['POST'])
@app.route('/pointkedex/api/predict', methods=['POST'])
def predict() -> Any:
    img = (request.get_json(silent=True) or {}).get("image")
    if not img:
        return jsonify({"error": "missing image"}), 400
    try:
        prob = model.predict(preprocess(img), verbose=0)[0]
        conf = float(prob.max())
        idx  = int(prob.argmax())
        name = IDX2NAME.get(idx, "Unknown")
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    dq = _recent.setdefault(cid(), deque(maxlen=STABLE_CNT))
    dq.append((idx, conf))
    stable = len(dq)==STABLE_CNT and all(i==idx for i,_ in dq) and all(c>=THRESH_CONF for _,c in dq)
    return jsonify({"name": name, "conf": round(conf,4), "stable": stable})

# ---------- pokédex stats ----------
@app.route('/api/pokemon/<slug>')
@app.route('/pointkedex/api/pokemon/<slug>')
def pokemon(slug: str) -> Any:
    data = POKEDEX.get(slug.lower())
    if not data:
        return jsonify({"error": "not found"}), 404
    return jsonify(data)

# ---------- competitive usage ----------
@app.route('/api/usage/<slug>')
@app.route('/pointkedex/api/usage/<slug>')
def usage(slug: str) -> Any:
    data = USAGE.get(slug.lower()) or USAGE.get(ps_id(slug))  # ← fallback
    # always return JSON (empty dict if unavailable) so client code is happy
    return jsonify(data or {})

# ------------------------------------------------------------
if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
