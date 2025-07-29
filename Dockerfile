###################### Stage 1 – builder ######################
FROM python:3.11-slim AS builder
WORKDIR /app

# 1) Fetch the Keras .h5 from your GitHub Release tag "alroca"
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && curl -L -o pokedex_resnet50.h5 \
      "https://github.com/AlbertoRoca96/pointkedex/releases/download/alroca/pokedex_resnet50.h5"

# 2) Install all build‑time Python deps + TF‑JS converter
RUN pip install --no-cache-dir \
      tensorflow pillow tensorflowjs \
      torch==2.2.1 torchvision==0.17.1 torchaudio==2.2.1 ultralytics

# 3) Convert the .h5 → TF‑JS Layers Model
RUN tensorflowjs_converter \
      --input_format=keras \
      pokedex_resnet50.h5 \
      web_model_res

###################### Stage 2 – runtime ######################
FROM python:3.11-slim
WORKDIR /app

# Copy both your app code and the converted web_model_res folder
COPY --from=builder /app /app

# Install only what you need at runtime
RUN pip install --no-cache-dir \
      gunicorn flask flask-cors tensorflow pillow numpy \
      torch==2.2.1 torchvision==0.17.1 ultralytics

# Expose and launch
ENV PORT=80
EXPOSE 80
CMD ["gunicorn", "-b", "0.0.0.0:80", "predict_server:app", \
     "--workers", "2", "--threads", "4", "--timeout", "120"]
