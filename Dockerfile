##########################
# Stage 1 — builder
##########################
FROM python:3.11-slim AS builder
WORKDIR /app

# Build-time args injected from the workflow
ARG MODEL_URL
ARG ASSET_FILE=pokedex_resnet50.h5

# 1) Copy source and pull down the .h5
COPY . .
RUN set -eux; \
    apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -L --fail -o "${ASSET_FILE}" "${MODEL_URL}" && \
    rm -rf /var/lib/apt/lists/*

# 2) Install ML libs and convert to TF-JS
RUN pip install --no-cache-dir \
        tensorflow pillow tensorflowjs \
        torch==2.2.1 torchvision==0.17.1 torchaudio==2.2.1 ultralytics && \
    tensorflowjs_converter \
        --input_format=keras "/app/${ASSET_FILE}" /app/web_model_res

##########################
# Stage 2 — runtime
##########################
FROM python:3.11-slim
WORKDIR /app

# Bring in the built model + source
COPY --from=builder /app /app

# Install only runtime dependencies
RUN pip install --no-cache-dir \
        gunicorn flask flask-cors \
        tensorflow pillow numpy \
        torch==2.2.1 torchvision==0.17.1 ultralytics

# Expose the listening port
ENV PORT=80
EXPOSE 80

# Launch the Flask app via Gunicorn
CMD ["gunicorn", "--bind", "0.0.0.0:80", "predict_server:app", "--workers", "2", "--threads", "4", "--timeout", "120"]
