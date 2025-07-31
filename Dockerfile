########################## Stage 1 – Builder ##########################
FROM python:3.11-slim AS builder
WORKDIR /app

ARG MODEL_URL                 # e.g. https://…/releases/download/…/pokedex_resnet50.h5
ARG ASSET_FILE=pokedex_resnet50.h5

# 1) Copy source + fetch model
COPY . /app
RUN set -eux; \
    apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -L --fail -o "/app/${ASSET_FILE}" "${MODEL_URL}" && \
    rm -rf /var/lib/apt/lists/*

# 2) Install ML libs & convert to TF-JS
RUN pip install --no-cache-dir \
        tensorflow pillow tensorflowjs \
        torch==2.2.1 torchvision==0.17.1 torchaudio==2.2.1 ultralytics && \
    tensorflowjs_converter \
        --input_format=keras "/app/${ASSET_FILE}" /app/web_model_res

########################## Stage 2 – Runtime ##########################
FROM python:3.11-slim
WORKDIR /app

# Copy everything from the builder stage
COPY --from=builder /app /app

# Install only runtime deps
RUN pip install --no-cache-dir \
        gunicorn flask flask-cors \
        tensorflow pillow numpy \
        torch==2.2.1 torchvision==0.17.1 ultralytics

# Expose port and set default
ENV PORT=80
EXPOSE 80

# Shell form so $PORT expands correctly, no JSON parsing errors
CMD gunicorn --bind 0.0.0.0:${PORT} predict_server:app \
    --workers 2 --threads 4 --timeout 120
