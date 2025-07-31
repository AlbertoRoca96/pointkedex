# syntax=docker/dockerfile:1

########################## Stage 1 – builder ##########################
FROM python:3.11-slim AS builder
WORKDIR /app

# ---------- env hygiene ----------
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# ---------- args ----------
ARG GITHUB_TOKEN=""                      # optional, for private releases
ARG GITHUB_REPO="AlbertoRoca96/pointkedex"
ARG RELEASE_TAG="latest"                 # or a specific tag name
ARG MODEL_NAME="pokedex_resnet50.h5"

# ---------- copy source ----------
COPY . /app

# ---------- install build-time deps ----------
RUN --mount=type=cache,target=/root/.cache/pip \
    set -eux; \
    apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates jq && \
    pip install --no-cache-dir tensorflow pillow tensorflowjs \
        torch==2.2.1 torchvision==0.17.1 torchaudio==2.2.1 ultralytics

# ---------- fetch .h5 from GitHub Releases and convert ----------
RUN set -eux; \
    # Determine release API endpoint
    if [ "${RELEASE_TAG}" = "latest" ]; then \
        release_api="https://api.github.com/repos/${GITHUB_REPO}/releases/latest"; \
    else \
        release_api="https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${RELEASE_TAG}"; \
    fi; \
    # Prepare headers (with auth if provided)
    accept_header="Accept: application/vnd.github+json"; \
    auth_arg=""; \
    if [ -n "${GITHUB_TOKEN}" ]; then \
        auth_arg="-H Authorization: token ${GITHUB_TOKEN}"; \
    fi; \
    # Fetch release metadata
    release_info=$(curl -s -H "${accept_header}" ${auth_arg} "${release_api}"); \
    asset_url=$(echo "$release_info" | jq -r ".assets[] | select(.name==\"${MODEL_NAME}\") | .browser_download_url"); \
    if [ -z "$asset_url" ] || [ "$asset_url" = "null" ]; then \
        echo "ERROR: could not find asset ${MODEL_NAME} in release ${RELEASE_TAG} of ${GITHUB_REPO}"; \
        exit 1; \
    fi; \
    # Download the model (with auth if needed)
    if [ -n "${GITHUB_TOKEN}" ]; then \
        curl -L -H "Authorization: token ${GITHUB_TOKEN}" -o "${MODEL_NAME}" "$asset_url"; \
    else \
        curl -L -o "${MODEL_NAME}" "$asset_url"; \
    fi; \
    # Convert to TF.js format
    tensorflowjs_converter --input_format=keras "${MODEL_NAME}" web_model; \
    rm -rf /var/lib/apt/lists/*

########################## Stage 2 – runtime ##########################
FROM python:3.11-slim
WORKDIR /app

# ---------- env hygiene ----------
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=7860

# ---------- runtime deps ----------
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir gunicorn flask flask-cors \
        tensorflow pillow numpy \
        torch==2.2.1 torchvision==0.17.1 ultralytics

# ---------- copy application + model/shards ----------
COPY --from=builder /app /app

# ---------- expose & run ----------
EXPOSE 7860
CMD ["gunicorn", "-b", "0.0.0.0:${PORT}", "predict_server:app", "--workers", "2", "--threads", "4", "--timeout", "120"]
