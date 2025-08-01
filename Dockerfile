# syntax=docker/dockerfile:1
###############################################################################
# Pointkedex – Hugging Face Space image (CPU-only, ~650 MB smaller)
###############################################################################

############################  Stage 1: builder  ###############################
FROM python:3.11-slim AS builder
WORKDIR /app

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

ARG GITHUB_TOKEN=""
ARG GITHUB_REPO="AlbertoRoca96/pointkedex"
ARG RELEASE_TAG="latest"
ARG MODEL_NAME="pokedex_resnet50.h5"

# copy source so tensorflowjs_converter etc. are available
COPY . /app

RUN set -eux; \
    apt-get update -yqq && \
    apt-get install -y --no-install-recommends curl ca-certificates jq && \
    pip install --no-cache-dir \
        tensorflow-cpu==2.19.0 pillow tensorflowjs \
        torch==2.2.1 torchvision==0.17.1 torchaudio==2.2.1 ultralytics && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# ─── fetch model asset from GitHub release ───────────────────────────────────
RUN set -eux; \
    api="https://api.github.com/repos/${GITHUB_REPO}/releases"; \
    [ "${RELEASE_TAG}" = "latest" ] || api="${api}/tags/${RELEASE_TAG}"; \
    data=$(curl -s -H 'Accept: application/vnd.github+json' "${api}"); \
    url=$(echo "${data}" | jq -r --arg n "${MODEL_NAME}" \
         '.[0].assets[]? | select(.name==$n) | .browser_download_url'); \
    [ -n "${url}" ] && [ "${url}" != "null" ] || \
        { echo "ERROR: ${MODEL_NAME} not found in release"; exit 1; }; \
    if [ -n "${GITHUB_TOKEN}" ]; then \
        curl -L -H "Authorization: token ${GITHUB_TOKEN}" -o "${MODEL_NAME}" "${url}"; \
    else \
        curl -L -o "${MODEL_NAME}" "${url}"; \
    fi; \
    tensorflowjs_converter --input_format=keras "${MODEL_NAME}" web_model

############################  Stage 2: runtime  ###############################
FROM python:3.11-slim
WORKDIR /app

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=7860 \
    TF_CPP_MIN_LOG_LEVEL=2 \
    CUDA_VISIBLE_DEVICES=-1          # <- make TF stick to CPU

RUN set -eux; \
    apt-get update -yqq && \
    apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 espeak-ng libespeak-ng1 && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
        gunicorn flask flask-cors tensorflow-cpu==2.19.0 pillow numpy \
        torch==2.2.1 torchvision==0.17.1 ultralytics \
        requests requests-cache

COPY --from=builder /app /app

# tiny shim: if HF later moves this Space to a GPU runner we can re-enable CUDA
RUN printf '%s\n' \
'#!/usr/bin/env bash' \
'set -e' \
'if command -v nvidia-smi >/dev/null 2>&1; then' \
'  echo "[INFO] GPU runner detected – enabling CUDA inside container."' \
'  unset CUDA_VISIBLE_DEVICES' \
'fi' \
'exec "$@"' > /entry.sh && chmod +x /entry.sh

EXPOSE 7860
ENTRYPOINT ["/entry.sh"]
CMD ["gunicorn", "-b", "0.0.0.0:7860", "predict_server:app", "--workers", "2", "--threads", "4", "--timeout", "120"]
