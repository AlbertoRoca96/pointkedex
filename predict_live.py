import cv2, json, numpy as np, mss, tensorflow as tf
from tensorflow.keras.applications.resnet50 import preprocess_input
import pyttsx3
import random  # kept for future use

# -----------------------------------------------------------------------------
# Config
# -----------------------------------------------------------------------------
MODEL_PATH   = "pokedex_resnet50.h5"
LABEL_PATH   = "class_indices.json"
ROI          = {"left": 100, "top": 200, "width": 256, "height": 256}  # fallback
WINDOW_TITLE = None            # e.g. "DeSmuME" or "Pokémon - VisualBoyAdvance"
FLAVOR_PATH  = "flavor_text.json"
CONF_THRESH  = 0.05            # now 5 % confidence

# -----------------------------------------------------------------------------
# Optional: auto‑locate game window
# -----------------------------------------------------------------------------
if WINDOW_TITLE:
    try:
        import pygetwindow as gw
        w  = gw.getWindowsWithTitle(WINDOW_TITLE)[0]
        cx = w.left + w.width  // 2
        cy = w.top  + w.height // 2
        ROI = {"left": cx-128, "top": cy-128, "width": 256, "height": 256}
        print(f"[INFO] ROI autoconfig from “{WINDOW_TITLE}”: {ROI}")
    except Exception as e:
        print(f"[WARN] window “{WINDOW_TITLE}” not found ({e}); using manual ROI)

# -----------------------------------------------------------------------------
# Load model & label map
# -----------------------------------------------------------------------------
model = tf.keras.models.load_model(MODEL_PATH, compile=False)
with open(LABEL_PATH) as f:
    idx2name = {v: k for k, v in json.load(f).items()}

# -----------------------------------------------------------------------------
# Load flavour‑text DB
# -----------------------------------------------------------------------------
try:
    with open(FLAVOR_PATH, encoding="utf-8") as f:
        flavor_db = json.load(f)
    print(f"[INFO] Loaded flavour text for {len(flavor_db)} species")
except FileNotFoundError:
    flavor_db = {}
    print(f"[WARN] {FLAVOR_PATH} not found — speech disabled")

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
def preprocess_frame(bgra):
    img = cv2.resize(bgra, (224, 224))
    img = cv2.cvtColor(img, cv2.COLOR_BGRA2RGB)
    return preprocess_input(img)[None, ...]

def speak_flavor(poke_name: str):
    """Speak the first English flavour‑text entry, if present."""
    key = poke_name.lower().replace(" ", "-").replace("'", "").replace(".", "")
    texts = flavor_db.get(key)
    if not texts:
        return
    engine = pyttsx3.init()
    engine.setProperty("rate", 180)
    engine.say(texts[0])
    engine.runAndWait()
    engine.stop()

# -----------------------------------------------------------------------------
# Main capture loop
# -----------------------------------------------------------------------------
with mss.mss() as sct:
    cv2.namedWindow("Pokédex", cv2.WINDOW_GUI_NORMAL)
    while True:
        frame_bgra = np.array(sct.grab(ROI))
        probs      = model.predict(preprocess_frame(frame_bgra), verbose=0)[0]
        idx        = int(probs.argmax())
        name       = idx2name[idx]
        confidence = probs[idx]
        label      = f"{name}  {confidence*100:.1f}%"
        frame_bgr  = np.ascontiguousarray(frame_bgra[..., :3])
        cv2.rectangle(frame_bgr, (0, 0), (ROI["width"]-1, ROI["height"]-1), (0, 255, 0), 2)
        cv2.putText(frame_bgr, label, (5, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.8,
                    (0, 255, 0), 2, cv2.LINE_AA)
        cv2.imshow("Pokédex", frame_bgr)
        key = cv2.waitKey(1) & 0xFF
        if key in (ord(' '), 13):  # Space or Enter pressed
            if confidence >= CONF_THRESH and flavor_db:
                speak_flavor(name)
        elif key == 27:            # Esc quits
            break
cv2.destroyAllWindows()
