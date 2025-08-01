# syntax=docker/dockerfile:1
###############################################################################
# Pointkedex container
#   • Stage 1 (builder): fetch .h5 from GitHub release → convert to TF-JS
#   • Stage 2 (runtime): slim Flask/TensorFlow app
###############################################################################

########################
# ── Stage 1 : builder ─
########################
FROM python:3.11-slim AS builder
WORKDIR /app

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

ARG GITHUB_TOKEN=""
ARG GITHUB_REPO="AlbertoRoca96/pointkedex"
ARG RELEASE_TAG="latest"                 # or a tag name
ARG MODEL_NAME="pokedex_resnet50.h5"

COPY . /app

# base tools + heavy ML deps required only for conversion
RUN set -eux; \
    apt-get update -yqq && \
    apt-get install -y --no-install-recommends curl ca-certificates jq && \
    pip install --no-cache-dir \
        tensorflow pillow tensorflowjs \
        torch==2.2.1 torchvision==0.17.1 torchaudio==2.2.1 ultralytics && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# --- download model from GitHub release & convert to web_model/ -------------
RUN set -eux; \
    if [ "${RELEASE_TAG}" = "latest" ]; then \
        api="https://api.github.com/repos/${GITHUB_REPO}/releases/latest"; \
    else \
        api="https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${RELEASE_TAG}"; \
    fi; \
    info=$(curl -s -H "Accept: application/vnd.github+json" "${api}"); \
    url=$(echo "${info}" | jq -r --arg name "${MODEL_NAME}" '.assets[] | select(.name==$name) | .browser_download_url'); \
    [ -n "${url}" ] && [ "${url}" != "null" ] || { echo "ERROR: ${MODEL_NAME} not found in release"; exit 1; }; \
    curl -L -o "${MODEL_NAME}" "${url}"; \
    tensorflowjs_converter --input_format=keras "${MODEL_NAME}" web_model

#########################
# ── Stage 2 : runtime ──
#########################
FROM python:3.11-slim
WORKDIR /app

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=7860 \
    MPLCONFIGDIR=/tmp \                  # silence matplotlib cache warnings
    TF_CPP_MIN_LOG_LEVEL=2

# light system libs (espeak for TTS; GL for Pillow-opencv)
RUN set -eux; \
    apt-get update -yqq && \
    apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 espeak-ng libespeak-ng1 && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# runtime Python deps (keep in sync with predict_server.py)
RUN pip install --no-cache-dir \
        gunicorn flask flask-cors tensorflow pillow numpy \
        torch==2.2.1 torchvision==0.17.1 ultralytics

# copy everything prepared by builder (code, model, web_model/, assets…)
COPY --from=builder /app /app

# optional shim: fall back to CPU if container runs without NVIDIA runtime
RUN printf '%s\n' \
'#!/usr/bin/env bash' \
'set -e' \
'if ! command -v nvidia-smi >/dev/null 2>&1; then' \
'  echo "[INFO] NVIDIA runtime not detected – forcing CPU path."' \
'  export CUDA_VISIBLE_DEVICES=""' \
'fi' \
'exec "$@"' > /entry.sh && chmod +x /entry.sh

VOLUME ["/dev/shm"]
ENTRYPOINT ["/entry.sh"]
CMD ["gunicorn", "-b", "0.0.0.0:7860", "predict_server:app", "--workers", "2", "--threads", "4", "--timeout", "120"]
