from __future__ import annotations

import base64
import io
import json
import os
from pathlib import Path
from typing import Any, Dict

import numpy as np
import tensorflow as tf
from PIL import Image
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

# ────────────────────────────────────────────────────────
# Configuration
# ────────────────────────────────────────────────────────
ROOT_DIR       = Path(__file__).resolve().parent
MODEL_PATH     = Path(os.getenv("MODEL_PATH",  ROOT_DIR / "pokedex_resnet50.h5"))
LABELS_PATH    = Path(os.getenv("LABELS_PATH", ROOT_DIR / "class_indices.json"))
INPUT_SIZE     = (224, 224)                # ResNet-50 default size
CONF_THRESHOLD = float(os.getenv("CONF_THRESH", 0.05))

# ────────────────────────────────────────────────────────
# Load model + labels once at startup
# ────────────────────────────────────────────────────────
print("[INFO] Loading model …")
model = tf.keras.models.load_model(MODEL_PATH, compile=False)
print("[INFO] Model loaded")

def load_labels(path: Path) -> Dict[int, str]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    # Case 1: mapping index string -> name, e.g. { "0": "Bulbasaur", ... }
    if all(k.isdigit() for k in raw.keys()):
        return {int(k): v for k, v in raw.items()}
    # Case 2: mapping name -> index, invert it
    if all(isinstance(v, int) for v in raw.values()):
        return {v: k for k, v in raw.items()}
    # Fallback: try hybrid, pick numeric keys first
    result: Dict[int, str] = {}
    for k, v in raw.items():
        if k.isdigit():
            result[int(k)] = v
    if result:
        return result
    # Last resort: enumerate values
    return {i: str(v) for i, v in enumerate(raw.values())}

idx2name = load_labels(LABELS_PATH)
print(f"[INFO] Loaded {len(idx2name)} labels")

# ────────────────────────────────────────────────────────
# Flask app
# ────────────────────────────────────────────────────────
app = Flask(__name__, static_folder=str(ROOT_DIR))
CORS(app)

@app.route("/")
def root() -> Any:
    return send_from_directory(str(ROOT_DIR), "index.html")

@app.route("/<path:path>")
def static_proxy(path: str) -> Any:
    return send_from_directory(str(ROOT_DIR), path)

def _preprocess(b64_jpeg: str) -> np.ndarray:
    if "," in b64_jpeg:
        b64_jpeg = b64_jpeg.split(",", 1)[1]
    img_bytes = base64.b64decode(b64_jpeg)
    pil_img   = Image.open(io.BytesIO(img_bytes)).convert("RGB").resize(INPUT_SIZE)
    arr       = tf.keras.preprocessing.image.img_to_array(pil_img)
    arr       = tf.keras.applications.resnet50.preprocess_input(arr)
    return np.expand_dims(arr, axis=0)

@app.route('/api/predict', methods=['POST'])
@app.route('/pointkedex/api/predict', methods=['POST'])
def predict() -> Any:
    data    = request.get_json(silent=True) or {}
    img_b64 = data.get("image")

    if not img_b64:
        return jsonify({"error": "missing 'image' field"}), 400

    try:
        X        = _preprocess(img_b64)
        preds    = model.predict(X, verbose=0)
        conf     = float(np.max(preds))
        pred_idx = int(np.argmax(preds))
        name     = idx2name.get(pred_idx, "Unknown")
    except Exception as exc:
        import traceback, sys
        traceback.print_exc(file=sys.stderr)
        return jsonify({"error": str(exc)}), 500

    return jsonify({"name": name, "conf": round(conf, 4)})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=False)
