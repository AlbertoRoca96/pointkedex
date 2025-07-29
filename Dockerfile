######################  Stage 1 – builder  ######################
FROM python:3.11-slim AS builder
WORKDIR /app

# 1) Copy your source (app code + Dockerfile) into /app
COPY . /app

# 2) Download the .h5 from your GitHub Release
#    - TAG_NAME is passed in at build time (defaults to "alroca")
ARG TAG_NAME=alroca
ARG ASSET_FILE=pokedex_resnet50.h5

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -L --fail \
      -o "/app/${ASSET_FILE}" \
      "https://github.com/${GITHUB_REPOSITORY}/releases/download/${TAG_NAME}/${ASSET_FILE}" && \
    rm -rf /var/lib/apt/lists/*

# 3) Install both TF + PyTorch stacks and convert to TF‑JS
RUN pip install --no-cache-dir \
      tensorflow pillow tensorflowjs \
      torch==2.2.1 torchvision==0.17.1 torchaudio==2.2.1 ultralytics && \
    tensorflowjs_converter \
      --input_format=keras \
      "/app/${ASSET_FILE}" \
      /app/web_model_res

######################  Stage 2 – runtime  ######################
FROM python:3.11-slim
WORKDIR /app

# Bring in your app *and* the converted web_model_res
COPY --from=builder /app /app

# Runtime dependencies
RUN pip install --no-cache-dir \
      gunicorn flask flask-cors tensorflow pillow numpy \
      torch==2.2.1 torchvision==0.17.1 ultralytics

ENV PORT=80
EXPOSE 80
CMD ["gunicorn","-b","0.0.0.0:80","predict_server:app","--workers","2","--threads","4","--timeout","120"]
