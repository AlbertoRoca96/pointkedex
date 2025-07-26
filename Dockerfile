########################  Stage 1 – build ##################################
FROM python:3.11-slim AS builder
WORKDIR /app
COPY . /app

# ---- OS packages ---------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
        wget ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# ---- Python build‑time deps ---------------------------------------------
RUN pip install --no-cache-dir \
        tensorflow pillow tensorflowjs \
        torch==2.2.1 torchvision==0.17.1 torchaudio==2.2.1 ultralytics

# ---- sanity‑check ResNet (optional testsprite.png) -----------------------
RUN printf '%s\n' \
"import tensorflow as tf, json, pathlib, numpy as np" \
"from PIL import Image" \
"model = tf.keras.models.load_model('pokedex_resnet50.h5', compile=False)" \
"with open('class_indices.json') as f: idx = {v:k for k,v in json.load(f).items()}" \
"p = pathlib.Path('testsprite.png')" \
"if p.exists():" \
"    img = Image.open(p).convert('RGB').resize((224,224))" \
"    x = tf.keras.applications.resnet50.preprocess_input(np.array(img)[None])" \
"    print('sanity‑check →', idx[int(model(x).numpy().argmax())])" \
"else:" \
"    print('sanity‑check skipped')" \
> /tmp/check.py && python /tmp/check.py

# ---- convert ResNet to TF‑JS shards -------------------------------------
RUN tensorflowjs_converter --input_format=keras \
        /app/pokedex_resnet50.h5 /app/web_model_res

########################  Stage 2 – runtime ################################
FROM python:3.11-slim
WORKDIR /app

# copy code, assets, model, detector (if present)
COPY --from=builder /app/*.py              /app/
COPY --from=builder /app/pokedex_resnet50.h5 /app/
COPY --from=builder /app/yolov5n.pt*       /app/
COPY --from=builder /app/web_model_res     /app/
COPY --from=builder /app/index.html        /app/
COPY --from=builder /app/app.js            /app/
COPY --from=builder /app/class_indices.json /app/
COPY --from=builder /app/flavor_text.json   /app/

# runtime deps
RUN pip install --no-cache-dir \
        flask flask-cors gunicorn tensorflow pillow numpy \
        torch==2.2.1 torchvision==0.17.1 ultralytics

# ngrok
RUN apt-get update && apt-get install -y --no-install-recommends \
        wget ca-certificates unzip && \
    wget -q https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz && \
    tar -xzf ngrok-v3-stable-linux-amd64.tgz && \
    mv ngrok /usr/local/bin && chmod +x /usr/local/bin/ngrok && \
    rm ngrok-v3-stable-linux-amd64.tgz && \
    rm -rf /var/lib/apt/lists/*

EXPOSE 8000
CMD gunicorn -b 0.0.0.0:8000 predict_server:app --workers 1 --threads 4 --timeout 120 & \
    sleep 2 && \
    ngrok http --authtoken="$NGROK_AUTHTOKEN" 8000

