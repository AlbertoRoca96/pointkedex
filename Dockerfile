##########################  Stage 1 – builder  ##########################
FROM python:3.11-slim AS builder
WORKDIR /app

# ── Build‑time arguments (all injected from the workflow) ──────────────
ARG MODEL_URL                     # full https://…/releases/download/… URL
ARG ASSET_FILE=pokedex_resnet50.h5

# 1) Copy your source code (predict_server.py, etc.)
COPY . /app

# 2) Fetch the *.h5 model from the Release
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -L --fail -o "/app/${ASSET_FILE}" "${MODEL_URL}" && \
    rm -rf /var/lib/apt/lists/*

# 3) Install ML stacks once and convert to TF‑JS
RUN pip install --no-cache-dir \
        tensorflow pillow tensorflowjs \
        torch==2.2.1 torchvision==0.17.1 torchaudio==2.2.1 ultralytics && \
    tensorflowjs_converter \
        --input_format=keras \
        "/app/${ASSET_FILE}" \
        /app/web_model_res
#########################################################################


##########################  Stage 2 – runtime  ##########################
FROM python:3.11-slim
WORKDIR /app

# Bring application + web_model_res over from the builder stage
COPY --from=builder /app /app

# Runtime dependencies only
RUN pip install --no-cache-dir \
        gunicorn flask flask-cors tensorflow pillow numpy \
        torch==2.2.1 torchvision==0.17.1 ultralytics

ENV PORT=80
EXPOSE 80
CMD ["gunicorn","-b","0.0.0.0:80","predict_server:app","--workers","2","--threads","4","--timeout","120"]
