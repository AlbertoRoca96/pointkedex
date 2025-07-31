# syntax=docker/dockerfile:1          # enables BuildKit extras like --mount=cache

##########################  Stage 1 – builder  ##########################
FROM python:3.11-slim AS builder
WORKDIR /app

# ---------------- env hygiene ----------------
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# ---------------- args ----------------
ARG MODEL_URL                         # ex: https://huggingface.co/.../pokedex_resnet50.h5
ARG MODEL_FILE=pokedex_resnet50.h5

# ---------------- copy source first (cache) ---------------
COPY . /app

# ---------------- system + build-time deps ----------------
RUN --mount=type=cache,target=/root/.cache/pip \
    set -eux; \
    apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    pip install --no-cache-dir \
         tensorflow pillow tensorflowjs \
         torch==2.2.1 torchvision==0.17.1 torchaudio==2.2.1 ultralytics && \
    curl -L --fail -o "${MODEL_FILE}" "${MODEL_URL}" && \
    tensorflowjs_converter --input_format=keras "${MODEL_FILE}" web_model && \
    rm -rf /var/lib/apt/lists/*

##########################  Stage 2 – runtime  ##########################
FROM python:3.11-slim
WORKDIR /app

# ---------------- env hygiene ----------------
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=7860                              # Hugging Face will override if needed

# ---------------- runtime deps only ----------------
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir \
         gunicorn flask flask-cors tensorflow pillow numpy \
         torch==2.2.1 torchvision==0.17.1 ultralytics

# ---------------- bring in app + assets ----------------
COPY --from=builder /app /app            # includes .py, TF-JS shards *and* the .h5 file

# ---------------- expose & launch ----------------
EXPOSE 7860
CMD gunicorn -b 0.0.0.0:${PORT} predict_server:app \
    --workers 2 --threads 4 --timeout 120
