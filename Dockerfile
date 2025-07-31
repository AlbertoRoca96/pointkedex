##########################  Stage 1 – Builder  ##########################
FROM python:3.11-slim AS builder
WORKDIR /app

# ── Build-time args (injected by CI) ────────────────────
ARG MODEL_URL               # e.g. https://…/releases/download/…/pokedex_resnet50.h5
ARG ASSET_FILE=pokedex_resnet50.h5

# 1) Copy source, fetch model, install build deps, convert to TF-JS
COPY . /app
RUN set -eux; \
    apt-get update && \
    apt-get install -y --no-install-recommends \
      curl ca-certificates && \
    curl -L --fail -o "/app/${ASSET_FILE}" "${MODEL_URL}" && \
    pip install --no-cache-dir \
      tensorflow pillow tensorflowjs \
      torch==2.2.1 torchvision==0.17.1 torchaudio==2.2.1 ultralytics && \
    tensorflowjs_converter \
      --input_format=keras "/app/${ASSET_FILE}" /app/web_model_res && \
    apt-get purge -y --auto-remove curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

#########################################################################


##########################  Stage 2 – Runtime  ############################
FROM python:3.11-slim
WORKDIR /app

# Copy only the built artifacts and source
COPY --from=builder /app /app

# Install only runtime deps
RUN set -eux; \
    pip install --no-cache-dir \
      gunicorn flask flask-cors \
      tensorflow pillow numpy \
      torch==2.2.1 torchvision==0.17.1 ultralytics

# Expose the port the app binds to
ENV PORT=80
EXPOSE 80

# Launch the Flask app via Gunicorn
CMD [
  "gunicorn",
  "--bind", "0.0.0.0:${PORT}",
  "predict_server:app",
  "--workers", "2",
  "--threads", "4",
  "--timeout", "120"
]
