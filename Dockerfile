# syntax=docker/dockerfile:1
###############################################################################
# Pointkedex – Hugging Face Space image (CPU-only, compact)
###############################################################################

############################  Stage 1 · builder  ##############################
FROM python:3.11-slim AS builder
WORKDIR /app

# ---------- environment hygiene ----------
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# ---------- build-time args ----------
ARG MODEL_NAME="pokedex_resnet50.h5"

# Hugging Face Space first
ARG HF_SPACE_REPO="AlbertoRoca96-web/pointkedex"
ARG HF_TOKEN=""
ARG HF_MODEL_URL=""

# GitHub fallback
ARG GITHUB_REPO="AlbertoRoca96/pointkedex"
ARG RELEASE_TAG="latest"
ARG GITHUB_TOKEN=""

# ---------- copy project (converter needs a few files) ----------
COPY . /app

# ---------- build-time Python & system deps ----------
RUN --mount=type=cache,target=/root/.cache/pip \
    set -eux; \
    apt-get update -yqq && \
    apt-get install -y --no-install-recommends curl ca-certificates jq && \
    pip install --no-cache-dir \
        tensorflow-cpu==2.19.0 \
        pillow \
        tensorflowjs==4.14.0 \
        torch==2.2.1 torchvision==0.17.1 torchaudio==2.2.1 ultralytics && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# ---------- download model & convert ----------
RUN set -eux; \
    got_model=""; \
    \
    space_raw="https://huggingface.co/spaces/${HF_SPACE_REPO}/resolve/main/${MODEL_NAME}"; \
    if curl --head --silent --fail -H "Authorization: Bearer ${HF_TOKEN}" "${space_raw}" >/dev/null; then \
        curl -L -H "Authorization: Bearer ${HF_TOKEN}" -o "${MODEL_NAME}" "${space_raw}"; \
        got_model="yes"; \
    fi; \
    \
    if [ -z "${got_model}" ] && [ -n "${HF_MODEL_URL}" ]; then \
        curl -L -H "Authorization: Bearer ${HF_TOKEN}" -o "${MODEL_NAME}" "${HF_MODEL_URL}"; \
        got_model="yes"; \
    fi; \
    \
    if [ -z "${got_model}" ]; then \
        if [ "${RELEASE_TAG}" = "latest" ]; then \
            api="https://api.github.com/repos/${GITHUB_REPO}/releases/latest"; \
        else \
            api="https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${RELEASE_TAG}"; \
        fi; \
        info="$(curl -s -H 'Accept: application/vnd.github+json' "${api}")"; \
        asset_url="$(echo "${info}" \
            | jq -r --arg n "${MODEL_NAME}" \
              'if type=="array" then .[]?.assets[]? else .assets[]? end \
               | select(.name==$n) | .browser_download_url')" ; \
        [ -n "${asset_url}" ] && [ "${asset_url}" != "null" ] || { \
            echo "ERROR: ${MODEL_NAME} not found anywhere!"; exit 1; }; \
        if [ -n "${GITHUB_TOKEN}" ]; then \
            curl -L -H "Authorization: token ${GITHUB_TOKEN}" -o "${MODEL_NAME}" "${asset_url}"; \
        else \
            curl -L -o "${MODEL_NAME}" "${asset_url}"; \
        fi; \
    fi; \
    \
    tensorflowjs_converter --input_format=keras "${MODEL_NAME}" web_model

############################  Stage 2 · runtime  ##############################
FROM python:3.11-slim
WORKDIR /app

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=7860 \
    TF_CPP_MIN_LOG_LEVEL=2 \
    CUDA_VISIBLE_DEVICES=-1           

# ---------- minimal system deps ----------
RUN set -eux; \
    apt-get update -yqq && \
    apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 espeak-ng libespeak-ng1 && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# ---------- runtime Python deps ----------
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir \
        gunicorn flask flask-cors tensorflow-cpu==2.19.0 pillow numpy \
        torch==2.2.1 torchvision==0.17.1 ultralytics \
        requests requests-cache

# ---------- app code & TF-JS shards ----------
COPY --from=builder /app /app

# ---------- GPU-auto-detect shim ----------
RUN printf '%s\n' \
'#!/usr/bin/env bash' \
'set -e' \
'if command -v nvidia-smi >/dev/null 2>&1; then' \
'  echo "[INFO] GPU runner detected – enabling CUDA inside container." >&2' \
'  unset CUDA_VISIBLE_DEVICES' \
'fi' \
'exec "$@"' > /entry.sh && chmod +x /entry.sh

EXPOSE 7860
ENTRYPOINT ["/entry.sh"]
CMD ["gunicorn", "-b", "0.0.0.0:7860", "predict_server:app", "--workers", "2", "--threads", "4", "--timeout", "120"]
