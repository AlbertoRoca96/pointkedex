"""
API using ResNet‑50 for classification.
If yolov5n.pt is present, frames are first cropped by YOLO‑Nano.
"""

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import base64, io, tensorflow as tf
from PIL import Image
import numpy as np
import json, os

app = Flask(__name__)
CORS(app)                           # already there
# ──────────────────────────────────────────────────────────────
# NEW: serve the static front‑end out of the repo root
@app.route("/")
def root():
    return send_from_directory(".", "index.html")

@app.route("/<path:path>")
def static_proxy(path):
    # anything not matched by other routes is treated as a static file
    return send_from_directory(".", path)
# ──────────────────────────────────────────────────────────────

# …existing /api/predict route stays unchanged…

def root():
    return send_from_directory('.', 'index.html')

