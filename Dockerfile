##########################  Stage 1 – builder  ##########################
FROM python:3.11-slim AS builder
WORKDIR /app

# ── Build-time args (injected by GH Actions) ───────────────────────────
ARG MODEL_URL                     # e.g. https://…/releases/download/alroca/pokedex_resnet50.h5
ARG ASSET_FILE=pokedex_resnet50.h5

# 1) Copy source + fetch model
COPY . /app
RUN set -eux; \
    apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -L --fail -o "/app/${ASSET_FILE}" "${MODEL_URL}" && \
    rm -rf /var/lib/apt/lists/*

# 2) Install build-only deps & convert to TF-JS
RUN pip install --no-cache-dir \
        tensorflow pillow tensorflowjs \
        torch==2.2.1 torchvision==0.17.1 torchaudio==2.2.1 ultralytics && \
    tensorflowjs_converter \
        --input_format=keras \
        "/app/${ASSET_FILE}" \
        /app/web_model_res

#########################################################################

##########################  Stage 2 – runtime  ##########################
FROM python:3.11-slim
WORKDIR /app

# Copy everything over from builder
COPY --from=builder /app /app

# Runtime‐only deps
RUN pip install --no-cache-dir \
        gunicorn flask flask-cors tensorflow pillow numpy \
        torch==2.2.1 torchvision==0.17.1 ultralytics

# Expose & launch
ENV PORT=80
EXPOSE 80

# **Note**: JSON‐array form must be one “instruction”.  Multi‐line BREAKS Docker parsing.
CMD ["gunicorn","--bind","0.0.0.0:80","predict_server:app","--workers","2","--threads","4","--timeout","120"]
