######################  Stage 1 – build  ######################
FROM python:3.11-slim AS builder
WORKDIR /app

# 1) Copy everything (make sure pokedex_resnet50.h5 is in your repo)
COPY . /app

# 2) Install OS deps & Python libs
RUN apt-get update && \
    apt-get install -y --no-install-recommends wget ca-certificates && \
    rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
      tensorflow pillow tensorflowjs \
      torch==2.2.1 torchvision==0.17.1 torchaudio==2.2.1 ultralytics

# 3) Only run TF‑JS conversion if the .h5 file is actually present
RUN \
  if [ -f /app/pokedex_resnet50.h5 ]; then \
    echo "🔄 Converting Keras .h5 → TF‑JS format…"; \
    tensorflowjs_converter \
      --input_format=keras \
      /app/pokedex_resnet50.h5 \
      /app/web_model_res; \
  else \
    echo "⚠️  Model file pokedex_resnet50.h5 not found — skipping conversion"; \
  fi

######################  Stage 2 – runtime #####################
FROM python:3.11-slim
WORKDIR /app

# Copy over everything (including /app/web_model_res if it exists)
COPY --from=builder /app /app

RUN pip install --no-cache-dir \
      gunicorn flask flask-cors tensorflow pillow numpy \
      torch==2.2.1 torchvision==0.17.1 ultralytics

# Expose port 80 & run:
ENV PORT=80
EXPOSE 80
CMD ["gunicorn","-b","0.0.0.0:80","predict_server:app","--workers","2","--threads","4","--timeout","120"]
