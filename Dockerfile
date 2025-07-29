######################  Stage 1 – build  ######################
FROM python:3.11-slim AS builder
WORKDIR /app
COPY . /app

# --- deps ---------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
        wget ca-certificates && \
    rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
        tensorflow pillow tensorflowjs \
        torch==2.2.1 torchvision==0.17.1 torchaudio==2.2.1 ultralytics

# --- TF-JS shards (optional – keeps offline model) ----------
RUN tensorflowjs_converter --input_format=keras \
        /app/pokedex_resnet50.h5 /app/web_model_res

######################  Stage 2 – runtime #####################
FROM python:3.11-slim
WORKDIR /app
COPY --from=builder /app /app

RUN pip install --no-cache-dir \
        gunicorn flask flask-cors tensorflow pillow numpy \
        torch==2.2.1 torchvision==0.17.1 ultralytics

# Expose the port App Service expects
ENV PORT=80
EXPOSE 80

CMD gunicorn -b 0.0.0.0:${PORT} predict_server:app \
             --workers 2 --threads 4 --timeout 120


