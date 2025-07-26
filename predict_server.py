"""
API using ResNet‑50 for classification.
If yolov5n.pt is present, frames are first cropped by YOLO‑Nano.
"""

import base64, io, json, os, numpy as np
from PIL import Image
import tensorflow as tf
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

# ---------- load ResNet‑50 -------------------------------------------------
CLS_PATH   = "pokedex_resnet50.h5"
classifier = tf.keras.models.load_model(CLS_PATH, compile=False)
PREPROC_FN = tf.keras.applications.resnet50.preprocess_input
print("[INFO] Loaded ResNet‑50 weights")

with open("class_indices.json") as f:
    idx2name = {v: k for k, v in json.load(f).items()}

# ---------- optional YOLO‑Nano detector -----------------------------------
detector = None
if os.path.exists("yolov5n.pt"):
    try:
        import torch
        detector = torch.hub.load("ultralytics/yolov5", "custom",
                                  path="yolov5n.pt", trust_repo=True)
        print("[INFO] YOLO‑Nano loaded for cropping")
    except Exception as e:
        print("[WARN] could not load YOLO detector:", e)

def crop_with_yolo(rgb: np.ndarray) -> np.ndarray:
    if detector is None:
        return rgb
    try:
        out = detector(rgb, size=320)
        boxes = out.xyxy[0].cpu().numpy()
        if len(boxes) == 0:
            return rgb
        x1, y1, x2, y2, *_ = boxes[boxes[:, 4].argmax()]
        x1, y1, x2, y2 = map(int, (x1, y1, x2, y2))
        h, w = rgb.shape[:2]
        pad  = int(0.05 * max(x2 - x1, y2 - y1))
        x1, y1 = max(0, x1 - pad), max(0, y1 - pad)
        x2, y2 = min(w, x2 + pad), min(h, y2 + pad)
        return rgb[y1:y2, x1:x2]
    except Exception as e:
        print("[WARN] YOLO failed:", e)
        return rgb

def preprocess(rgb: np.ndarray) -> np.ndarray:
    rgb = tf.image.resize(rgb, (224, 224)).numpy()
    rgb = PREPROC_FN(rgb)
    return rgb[None]

# ---------- Flask ---------------------------------------------------------
app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

@app.route('/api/predict', methods=['POST'])
def api_predict():
    b64 = request.json.get('image', '').split(',')[-1]
    try:
        img = Image.open(io.BytesIO(base64.b64decode(b64))).convert('RGB')
    except Exception as e:
        return jsonify({"error": f"bad image ({e})"}), 400

    rgb  = np.array(img)
    rgb  = crop_with_yolo(rgb)
    prob = classifier(preprocess(rgb), training=False).numpy()[0]
    idx  = int(prob.argmax())
    return jsonify({"name": idx2name[idx], "conf": float(prob[idx])})

@app.route('/')
def root():
    return send_from_directory('.', 'index.html')

