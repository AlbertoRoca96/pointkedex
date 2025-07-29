######################  Stage 1 – builder  ######################
FROM python:3.11-slim AS builder
WORKDIR /app

# -- Build‑time ARG so the URL can be injected from the workflow
ARG MODEL_URL
ENV MODEL_FILE=pokedex_resnet50.h5

# 1) Grab source **except** the model (keeps context tiny)
COPY . /app

# 2) Fetch the release asset (fail fast if 404)
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -L --fail -o "$MODEL_FILE" "$MODEL_URL"

# 3) Install deps and convert to TF‑JS
RUN pip install --no-cache-dir \
      tensorflow pillow tensorflowjs \
      torch==2.2.1 torchvision==0.17.1 torchaudio==2.2.1 ultralytics && \
    tensorflowjs_converter \
        --input_format=keras \
        "$MODEL_FILE" \
        /app/web_model_res

######################  Stage 2 – runtime  ######################
FROM python:3.11-slim
WORKDIR /app

COPY --from=builder /app /app
RUN pip install --no-cache-dir \
      gunicorn flask flask-cors tensorflow pillow numpy \
      torch==2.2.1 torchvision==0.17.1 ultralytics

ENV PORT=80
EXPOSE 80
CMD ["gunicorn","-b","0.0.0.0:80","predict_server:app","--workers","2","--threads","4","--timeout","120"]

