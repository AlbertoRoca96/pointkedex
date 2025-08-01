FROM python:3.11-slim AS builder
WORKDIR /app

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

ARG GITHUB_TOKEN=""
ARG GITHUB_REPO="AlbertoRoca96/pointkedex"
ARG RELEASE_TAG="latest"
ARG MODEL_NAME="pokedex_resnet50.h5"

COPY . /app

RUN --mount=type=cache,target=/root/.cache/pip \
    set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends curl ca-certificates jq; \
    pip install --no-cache-dir tensorflow-cpu pillow tensorflowjs; \
    rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    if [ "$RELEASE_TAG" = "latest" ]; then \
      api="https://api.github.com/repos/$GITHUB_REPO/releases/latest"; \
    else \
      api="https://api.github.com/repos/$GITHUB_REPO/releases/tags/$RELEASE_TAG"; \
    fi; \
    header="Accept: application/vnd.github+json"; \
    auth=""; \
    if [ -n "$GITHUB_TOKEN" ]; then \
      auth="-H \"Authorization: token $GITHUB_TOKEN\""; \
    fi; \
    info=$(eval "curl -s -H \"$header\" $auth \"$api\""); \
    url=$(echo "$info" | jq -r ".assets[] | select(.name==\"$MODEL_NAME\") | .browser_download_url"); \
    [ -n "$url" ] && [ "$url" != "null" ] || (echo "asset not found"; exit 1); \
    if [ -n "$GITHUB_TOKEN" ]; then \
      curl -L -H "Authorization: token $GITHUB_TOKEN" -o "$MODEL_NAME" "$url"; \
    else \
      curl -L -o "$MODEL_NAME" "$url"; \
    fi; \
    tensorflowjs_converter --input_format=keras "$MODEL_NAME" web_model

FROM python:3.11-slim
WORKDIR /app

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=7860 \
    CUDA_VISIBLE_DEVICES=-1 \
    TF_CPP_MIN_LOG_LEVEL=2 \
    MPLCONFIGDIR=/tmp/matplotlib

RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir gunicorn flask flask-cors tensorflow-cpu pillow numpy

COPY --from=builder /app /app

EXPOSE 7860
CMD gunicorn -b 0.0.0.0:${PORT} predict_server:app --workers 2 --threads 4 --timeout 120
