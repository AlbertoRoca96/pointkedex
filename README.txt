# Pointkedex – Dockerized webcam Pokédex with server-side fallback
This project serves a small static web page that:

1. Opens the device’s rear camera in the browser (`index.html`).
2. Runs a ResNet-50 model in TensorFlow.js to recognise the Pokémon in view (`app.js`).
3. Reads out the first English Pokédex flavour-text line when the prediction is stable (`flavor_text.json`).
4. Falls back to a lightweight Flask API (`predict_server.py`) that loads the same **pokedex_resnet50.h5** model in Python and returns predictions if you prefer server-side accuracy (TF-JS stays available for offline use).

Everything is wrapped in a two-stage Docker image (`Dockerfile`) and exposed to the internet through **ngrok**.

---

## File roles
| file | purpose |
|------|---------|
| **index.html** | Minimal single-page app: camera `<video>`, prediction label bar, “Tap to start” button, silent 20 ms WAV to satisfy iOS auto-play rules, and the `<script>` tags that pull in TensorFlow.js and `app.js`. |
| **app.js** | Front-end logic: waits for the first user gesture, unlocks speech synthesis, loads `web_model/model.json` plus label/ flavour files, streams camera frames, centre-crops and preprocesses them exactly like Keras (`BGR – mean`), performs prediction, throttles speech so it triggers only after *STABLE_N* identical frames above *CONF_THR*, pauses the video loop during TTS, then resumes. |
| **predict_server.py** | Simple Flask + CORS API with one route `/api/predict`. It accepts base-64 JPEG or PNG, preprocesses with Keras’ `preprocess_input`, and returns the top-1 Pokémon name and confidence as JSON. This gives identical results to your desktop `predict_live.py`. |
| **Dockerfile** | Stage 1 installs TensorFlow / Pillow / tensorflowjs, runs an on-build sanity check (optional `testsprite.png` sprite), converts the `.h5` model to TF-JS shards, then copies all web assets and `predict_server.py` into a fresh slim image. Stage 2 installs ngrok, starts **gunicorn** to serve both the static files *and* the Flask API, waits two seconds, then opens an ngrok tunnel on port 8000. |

---

## Deployment options

### 1. One-click public URL with ngrok (already included)
You’ve already got this! Build & run the Docker image and it automatically spins up **ngrok** exposing port 8000 to the world. A public tunnel URL appears in the container logs.

```bash
export NGROK_AUTHTOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
docker build -t pointkedex-ngrok .
docker run -it --rm -e NGROK_AUTHTOKEN=$NGROK_AUTHTOKEN -p 8000:8000 pointkedex-ngrok
```

### 2. Permanent URL via GitHub Pages
Want a stable `https://<user>.github.io/pointkedex`? Push this repo to GitHub and enable Pages → **Deploy from gh-pages branch**.
A pre-configured GitHub Actions workflow (`.github/workflows/deploy.yml`) will automatically copy the static site (HTML, CSS, JS, model, etc.) to that branch whenever you push **main**.

No model shards bigger than 100 MB are committed, so you stay within Pages limits. Replace `web_model/*.bin` exclusion logic in the workflow if you need more shards.

---

## Local build & run

```bash
# clone or copy this folder (index.html, app.js, Dockerfile, predict_server.py, web_model …)

# 1) set your ngrok token once per machine
export NGROK_AUTHTOKEN=30EbfYq2QiR4NqAtprwTc1mrtXX_7vDgybPSuuq4fab8Wx2hL

# 2) build the image (~450 MB including TensorFlow)
docker build -t pokedex-ngrok .

# 3) run, forward host port 8000 so you can test locally if desired
docker run -it --rm \
    -e NGROK_AUTHTOKEN="$NGROK_AUTHTOKEN" \
    -p 8000:8000 pokedex-ngrok

