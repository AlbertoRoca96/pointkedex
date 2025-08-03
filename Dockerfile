# syntax=docker/dockerfile:1 
FROM python:3.11-slim AS builder
WORKDIR /app

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

ARG GITHUB_TOKEN=""
ARG GITHUB_REPO="AlbertoRoca96/pointkedex"
ARG RELEASE_TAG="latest"
ARG MODEL_NAME="pokedex_resnet50.h5"
ARG USAGE_DATA_NAME="usage_data.json"

COPY . /app

RUN --mount=type=cache,target=/root/.cache/pip \
    set -eux; \
    apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates jq && \
    pip install --no-cache-dir \
        tensorflow pillow tensorflowjs \
        torch==2.2.1 torchvision==0.17.1 torchaudio==2.2.1 ultralytics && \
    rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    if [ "${RELEASE_TAG}" = "latest" ]; then \
      api="https://api.github.com/repos/${GITHUB_REPO}/releases/latest"; \
    else \
      api="https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${RELEASE_TAG}"; \
    fi; \
    header="Accept: application/vnd.github+json"; \
    auth=""; \
    if [ -n "${GITHUB_TOKEN}" ]; then \
      auth="-H \"Authorization: token ${GITHUB_TOKEN}\""; \
    fi; \
    info=$(eval "curl -s -H '${header}' ${auth} \"${api}\""); \
    # fetch model
    model_url=$(echo "$info" | jq -r ".assets[] | select(.name==\"${MODEL_NAME}\") | .browser_download_url"); \
    [ -n "$model_url" ] && [ "$model_url" != "null" ] || (echo "ERROR: model asset not found"; exit 1); \
    if [ -n "${GITHUB_TOKEN}" ]; then \
      curl -L -H "Authorization: token ${GITHUB_TOKEN}" -o "${MODEL_NAME}" "$model_url"; \
    else \
      curl -L -o "${MODEL_NAME}" "$model_url"; \
    fi; \
    tensorflowjs_converter --input_format=keras "${MODEL_NAME}" web_model; \
    # fetch usage data
    usage_url=$(echo "$info" | jq -r ".assets[] | select(.name==\"${USAGE_DATA_NAME}\") | .browser_download_url"); \
    [ -n "$usage_url" ] && [ "$usage_url" != "null" ] || (echo "ERROR: usage_data asset not found"; exit 1); \
    if [ -n "${GITHUB_TOKEN}" ]; then \
      curl -L -H "Authorization: token ${GITHUB_TOKEN}" -o "${USAGE_DATA_NAME}" "$usage_url"; \
    else \
      curl -L -o "${USAGE_DATA_NAME}" "$usage_url"; \
    fi

FROM python:3.11-slim
WORKDIR /app

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1   \
    PYTHONUNBUFFERED=1          \
    PORT=7860                   \
    CUDA_VISIBLE_DEVICES=-1     \
    TF_CPP_MIN_LOG_LEVEL=2      \
    MPLCONFIGDIR=/tmp/mpl

RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir \
        gunicorn flask flask-cors tensorflow pillow numpy \
        torch==2.2.1 torchvision==0.17.1 ultralytics

COPY --from=builder /app /app
COPY service-worker.js manifest.webmanifest /app/

EXPOSE 7860
CMD gunicorn -b 0.0.0.0:${PORT:-7860} predict_server:app --workers 2 --threads 4 --timeout 120
