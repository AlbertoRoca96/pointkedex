# syntax=docker/dockerfile:1
###############################################################################
# Pointkedex – Hugging Face Space image (CPU-only)                 2025-08-01 #
###############################################################################

############################  Stage 1 – builder  ##############################
FROM python:3.11-slim AS builder
WORKDIR /app

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# ─── build-time arguments ────────────────────────────────────────────────────
ARG GITHUB_REPO="AlbertoRoca96/pointkedex"
ARG RELEASE_TAG="latest"                       
ARG MODEL_NAME="pokedex_resnet50.h5"

ARG HF_TOKEN=""                                
ARG HF_MODEL_URL=""                            

# need code here only for tensorflowjs_converter
COPY . /app

# ---------- build tools & CPU ML libs ---------------------------------------
RUN --mount=type=cache,target=/root/.cache/pip \
    set -eux; \
    apt-get update -yqq && \
    apt-get install -y --no-install-recommends curl ca-certificates jq && \
    pip install --no-cache-dir \
        tensorflow-cpu==2.19.0 pillow tensorflowjs \
        torch==2.2.1 torchvision==0.17.1 torchaudio==2.2.1 ultralytics && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# ---------- fetch the Keras model -------------------------------------------
RUN set -eux; \
    if [ -n "${HF_MODEL_URL}" ]; then \
        echo "→ downloading model from Hugging Face"; \
        hdr="Authorization: Bearer ${HF_TOKEN}"; \
        curl -L -H "${hdr}" -o "${MODEL_NAME}" "${HF_MODEL_URL}"; \
    else \
        echo "→ downloading model from GitHub release"; \
        if [ "${RELEASE_TAG}" = "latest" ]; then \
            api="https://api.github.com/repos/${GITHUB_REPO}/releases/latest"; \
        else \
            api="https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${RELEASE_TAG}"; \
        fi; \
        info="$(curl -s -H 'Accept: application/vnd.github+json' "${api}")"; \
        url="$(echo "${info}" | jq -r --arg n "${MODEL_NAME}" \
               '.assets[] | select(.name==$n) | .browser_download_url')"; \
        [ -n "${url}" ] && [ "${url}" != "null" ] \
            || { echo "ERROR: ${MODEL_NAME} not found in release"; exit 1; }; \
        curl -L -o "${MODEL_NAME}" "${url}"; \
    fi && \
    tensorflowjs_converter --input_format=keras "${MODEL_NAME}" web_model

############################  Stage 2 – runtime  ##############################
FROM python:3.11-slim
WORKDIR /app

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=7860 \
    TF_CPP_MIN_LOG_LEVEL=2 \
    CUDA_VISIBLE_DEVICES=-1             

# ---------- tiny system deps -------------------------------------------------
RUN set -eux; \
    apt-get update -yqq && \
    apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 espeak-ng libespeak-ng1 && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# ---------- Python runtime deps ---------------------------------------------
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir \
        gunicorn flask flask-cors tensorflow-cpu==2.19.0 pillow numpy \
        torch==2.2.1 torchvision==0.17.1 ultralytics \
        requests requests-cache

COPY --from=builder /app /app

# ---------- shim: re-enable CUDA automatically on GPU runners ---------------
RUN printf '%s\n' \
'#!/usr/bin/env bash' \
'set -e' \
'if command -v nvidia-smi >/dev/null 2>&1; then' \
'  echo "[INFO] GPU runtime detected – enabling CUDA inside container." >&2' \
'  unset CUDA_VISIBLE_DEVICES' \
'fi' \
'exec "$@"' > /entry.sh && chmod +x /entry.sh

EXPOSE 7860
ENTRYPOINT ["/entry.sh"]
CMD ["gunicorn", "-b", "0.0.0.0:7860", "predict_server:app", "--workers", "2", "--threads", "4", "--timeout", "120"]
