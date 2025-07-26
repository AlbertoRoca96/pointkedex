"""
predict_server.py
────────────────────────────────────────────────────────────────────────────
Flask backend for the webcam Pokedex demo.

• Serves *all* static front‑end assets (index.html, app.js, styles.css, etc.)
  directly from the repo root so the browser origin matches the API.
• Exposes POST /api/predict that expects JSON:
      { "image": "<base‑64‑encoded‑jpeg>" }
  and returns
      { "name": "<pokemon>", "conf": 0.87 }
"""

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
# Allow overriding paths via env vars so you can move things around without
# editing code.
ROOT_DIR          = Path(__file__).resolve().parent          # project root
MODEL_PATH        = Path(os.getenv("MODEL_PATH" , ROOT_DIR / "pokedex_resnet50.h5"))
LABELS_PATH       = Path(os.getenv("LABELS_PATH", ROOT_DIR / "class_indices.json"))
INPUT_SIZE        = (224, 224)  # ResNet‑50 default
CONF_THRESHOLD    = float(os.getenv("CONF_THRESH", 0.05))    # used on client too

# ────────────────────────────────────────────────────────
# Load model + labels once at startup
# ────────────────────────────────────────────────────────
print("[INFO] Loading model…")
model = tf.keras.models.load_model(MODEL_PATH)
print("[INFO] Model loaded")

with LABELS_PATH.open("r", encoding="utf‑8") as f:
    idx2name: Dict[int, str] = {int(k): v for k, v in json.load(f).items()}
print(f"[INFO] Loaded {len(idx2name)} labels")

# ────────────────────────────────────────────────────────
# Flask app
# ────────────────────────────────────────────────────────
app = Flask(__name__, static_folder=str(ROOT_DIR))
CORS(app)  # enable CORS *just in case* you hit it from elsewhere

# ───── Static file routes ───────────────────────────────
@app.route("/")
def root() -> Any:
    """Serve index.html at the site root."""
    return send_from_directory(str(ROOT_DIR), "index.html")


@app.route("/<path:path>")
def static_proxy(path: str) -> Any:
    """
    Serve any file that isn't matched by another route.
    Allows relative references like /app.js /styles.css /images/… etc.
    """
    return send_from_directory(str(ROOT_DIR), path)


# ───── Prediction endpoint ──────────────────────────────
def _preprocess(b64_jpeg: str) -> np.ndarray:
    """Base‑64 → numpy array shaped for ResNet‑50."""
    img_bytes = base64.b64decode(b64_jpeg)
    pil_img   = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    pil_img   = pil_img.resize(INPUT_SIZE)
    arr       = tf.keras.preprocessing.image.img_to_array(pil_img)
    arr       = tf.keras.applications.resnet50.preprocess_input(arr)
    return np.expand_dims(arr, axis=0)  # shape: (1, 224, 224, 3)


@app.route("/api/predict", methods=["POST"])
def predict() -> Any:
    data = request.get_json(silent=True) or {}
    img_b64 = data.get("image")

    if not img_b64:
        return jsonify({"error": "missing 'image' field"}), 400

    try:
        X = _preprocess(img_b64)
        preds: np.ndarray = model.predict(X, verbose=0)
        conf: float       = float(np.max(preds))
        pred_idx: int     = int(np.argmax(preds))
        name: str         = idx2name.get(pred_idx, "Unknown")
    except Exception as e:  # pylint: disable=broad-except
        # Print full stack trace to console for easier debugging.
        import traceback, sys
        traceback.print_exc(file=sys.stderr)
        return jsonify({"error": str(e)}), 500

    return jsonify({"name": name, "conf": round(conf, 4)})


# ────────────────────────────────────────────────────────
# Entry‑point for `python predict_server.py`
# (allows `python predict_server.py` without Flask CLI)
# ────────────────────────────────────────────────────────
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
