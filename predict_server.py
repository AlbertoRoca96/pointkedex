from __future__ import annotations

import base64
import io
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, Tuple

import numpy as np
import tensorflow as tf
from PIL import Image
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

# -----------------------
# Configuration (env overridable)
# -----------------------
ROOT_DIR = Path(__file__).resolve().parent
MODEL_PATH = Path(os.getenv("MODEL_PATH", ROOT_DIR / "pokedex_resnet50.h5"))
LABELS_PATH = Path(os.getenv("LABELS_PATH", ROOT_DIR / "class_indices.json"))
INPUT_SIZE = (224, 224)  # ResNet50 default
CONF_THRESHOLD = float(os.getenv("CONF_THRESH", 0.05))
PORT = int(os.getenv("PORT", "5000"))

# Reduce TensorFlow verbosity (but still show errors)
tf.get_logger().setLevel("ERROR")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")  # suppress INFO/WARNING from TF C++ backend

# -----------------------
# Utility
# -----------------------
def safe_load_labels(path: Path) -> Dict[int, str]:
    """
    Load label mapping and normalize it to int -> name.

    Accepts either:
      * { "0": "Bulbasaur", "1": "Ivysaur", ... }
      * { "Bulbasaur": 0, ... }  (reverse) and inverts it
    """
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[ERROR] Failed to read labels file '{path}': {e}", file=sys.stderr)
        return {}

    idx2name: Dict[int, str] = {}
    # Case 1: keys are strings of integers
    if all(isinstance(k, str) and k.isdigit() for k in raw.keys()):
        for k, v in raw.items():
            try:
                idx = int(k)
                idx2name[idx] = str(v)
            except Exception:
                continue
    # Case 2: values are integers (name -> index), invert
    elif all(isinstance(v, (int, str)) for v in raw.values()):
        for k, v in raw.items():
            try:
                idx = int(v)
                idx2name[idx] = str(k)
            except Exception:
                continue
    else:
        # Fallback: try to coerce as much as possible
        for k, v in raw.items():
            try:
                if isinstance(k, str) and k.isdigit():
                    idx2name[int(k)] = str(v)
                elif isinstance(v, (int, str)) and str(v).isdigit():
                    idx2name[int(v)] = str(k)
            except Exception:
                continue

    return idx2name


def preprocess_image(b64_jpeg: str) -> np.ndarray:
    """Convert base64 JPEG (with or without data-URL prefix) to model input tensor."""
    if "," in b64_jpeg:
        b64_jpeg = b64_jpeg.split(",", 1)[1]

    try:
        img_bytes = base64.b64decode(b64_jpeg)
        pil_img = (
            Image.open(io.BytesIO(img_bytes))
            .convert("RGB")
            .resize(INPUT_SIZE, Image.BILINEAR)
        )
        arr = tf.keras.preprocessing.image.img_to_array(pil_img)
        arr = tf.keras.applications.resnet50.preprocess_input(arr)
        return np.expand_dims(arr, axis=0)  # shape (1, H, W, C)
    except Exception as e:
        raise ValueError(f"failed to preprocess image: {e}") from e


# -----------------------
# Load model and labels
# -----------------------
print("[INFO] Loading model …")
try:
    model = tf.keras.models.load_model(MODEL_PATH, compile=False)
    print("[INFO] Model loaded")
except Exception as e:
    print(f"[ERROR] Could not load model from {MODEL_PATH}: {e}", file=sys.stderr)
    raise

idx2name = safe_load_labels(LABELS_PATH)
if not idx2name:
    print(f"[WARNING] No labels loaded from {LABELS_PATH}; predictions will show 'Unknown' names", file=sys.stderr)
else:
    print(f"[INFO] Loaded {len(idx2name)} labels")

# -----------------------
# Flask app setup
# -----------------------
app = Flask(__name__, static_folder=str(ROOT_DIR))
CORS(app)  # allow cross-origin if frontend is hosted elsewhere


@app.route("/healthz", methods=["GET"])
def health() -> Any:
    return jsonify({"status": "ok"})


@app.route("/")
def root() -> Any:
    return send_from_directory(str(ROOT_DIR), "index.html")


@app.route("/<path:path>")
def static_proxy(path: str) -> Any:
    return send_from_directory(str(ROOT_DIR), path)


@app.route("/api/predict", methods=["POST"])
@app.route("/pointkedex/api/predict", methods=["POST"])
def predict() -> Any:
    data = request.get_json(silent=True) or {}
    img_b64 = data.get("image")
    if not img_b64:
        return jsonify({"error": "missing 'image' field"}), 400

    try:
        X = preprocess_image(img_b64)
        preds = model.predict(X, verbose=0)
        conf = float(np.max(preds))
        pred_idx = int(np.argmax(preds))
        name = idx2name.get(pred_idx, "Unknown")

        if conf < CONF_THRESHOLD:
            # low confidence; can choose to mark unknown
            name = "Unknown"
        return jsonify({"name": name, "conf": round(conf, 4)})
    except Exception as exc:  # broad catch to return helpful payload
        import traceback

        traceback.print_exc(file=sys.stderr)
        return jsonify({"error": str(exc)}), 500


# -----------------------
# Entrypoint (for direct python execution)
# -----------------------
if __name__ == "__main__":
    # When run directly, use Flask's builtin server (not for high scale)
    print(f"[INFO] Starting app on 0.0.0.0:{PORT}")
    app.run(host="0.0.0.0", port=PORT, debug=False)
