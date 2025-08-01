# syntax=docker/dockerfile:1
###########################################################################
# Pointkedex – two-stage build
#   • Stage 1 (builder) : grab the model, build usage_data.json, convert .h5
#   • Stage 2 (runtime) : slim Flask/TensorFlow service
###########################################################################

########################  Stage 1 – builder  ########################
FROM python:3.11-slim AS builder
WORKDIR /app

# ---------- basic env ----------
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# ---------- build-time args ----------
ARG GITHUB_TOKEN=""                            # only if your release is private
ARG GITHUB_REPO="AlbertoRoca96/pointkedex"
ARG RELEASE_TAG="latest"                       # or a concrete tag
ARG MODEL_NAME="pokedex_resnet50.h5"

# ---------- copy source (scripts, web, etc.) ----------
COPY . /app

# ---------- tools + ML libs needed only in this stage ----------
RUN --mount=type=cache,target=/root/.cache/pip \
    set -eux; \
    apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates jq && \
    pip install --no-cache-dir \
        # heavy deps
        tensorflow pillow tensorflowjs \
        torch==2.2.1 torchvision==0.17.1 torchaudio==2.2.1 ultralytics \
        # lightweight deps used by build_usage_data.py
        requests requests-cache tqdm && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# ---------- (NEW) generate usage_data.json  ----------
RUN set -eux; \
    if [ ! -f usage_data.json ]; then \
      python3 build_usage_data.py; \
    fi

# ---------- fetch .h5 from GitHub release & convert ----------
RUN set -eux; \
    api="https://api.github.com/repos/${GITHUB_REPO}/releases"; \
    [ "${RELEASE_TAG}" = "latest" ] || api="${api}/tags/${RELEASE_TAG}"; \
    info=$(curl -s -H "Accept: application/vnd.github+json" "${api}"); \
    url=$(echo "${info}" \
          | jq -r --arg name "${MODEL_NAME}" '.assets[] | select(.name==$name) | .browser_download_url'); \
    [ -n "${url}" ] && [ "${url}" != "null" ] || { echo "ERROR: ${MODEL_NAME} not found"; exit 1; }; \
    curl -L -o "${MODEL_NAME}" "${url}"; \
    tensorflowjs_converter --input_format=keras "${MODEL_NAME}" web_model

########################  Stage 2 – runtime  ########################
FROM python:3.11-slim
WORKDIR /app

# ---------- runtime env ----------
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=7860 \
    MPLCONFIGDIR=/tmp \
    TF_CPP_MIN_LOG_LEVEL=2

# ---------- minimal system libs ----------
RUN apt-get update -yqq && \
    apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 espeak-ng libespeak-ng1 && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# ---------- runtime Python deps ----------
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir \
        gunicorn flask flask-cors tensorflow pillow numpy \
        torch==2.2.1 torchvision==0.17.1 ultralytics \
        requests requests-cache

# ---------- copy application from builder ----------
COPY --from=builder /app /app

# ---------- optional shim: fall back to CPU when no GPU runtime ----------
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
