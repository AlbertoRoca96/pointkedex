######################  Stage 1 – builder  ######################
FROM python:3.11-slim AS builder
WORKDIR /app

# Copy your application code (excluding the model, 
# since we'll pull it from GitHub)
COPY . /app

# Install curl for fetching the model, plus downgrade any leftover apt lists
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Download the .h5 directly from your 'alroca' release
RUN curl -L --fail -o pokedex_resnet50.h5 \
      https://github.com/AlbertoRoca96/pointkedex/releases/download/alroca/pokedex_resnet50.h5

# Install both TensorFlow & PyTorch stacks, then convert to TF‑JS
RUN pip install --no-cache-dir \
      tensorflow pillow tensorflowjs \
      torch==2.2.1 torchvision==0.17.1 torchaudio==2.2.1 ultralytics && \
    tensorflowjs_converter \
      --input_format=keras \
      pokedex_resnet50.h5 \
      /app/web_model_res

######################  Stage 2 – runtime  ######################
FROM python:3.11-slim
WORKDIR /app

# Bring in all sources plus the converted web_model_res folder
COPY --from=builder /app /app

# Install your lightweight runtime dependencies
RUN pip install --no-cache-dir \
      gunicorn flask flask-cors tensorflow pillow numpy \
      torch==2.2.1 torchvision==0.17.1 ultralytics

ENV PORT=80
EXPOSE 80

CMD ["gunicorn","-b","0.0.0.0:80","predict_server:app","--workers","2","--threads","4","--timeout","120"]
