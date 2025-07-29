######################  Stage 1 – builder  ######################
FROM python:3.11-slim AS builder
WORKDIR /app

# copy source *and* the h5 that the workflow downloaded
COPY . /app
#           └── includes pokedex_resnet50.h5 in repo root

# install both TF + PyTorch stacks once (they share many deps)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    pip install --no-cache-dir \
      tensorflow pillow tensorflowjs \
      torch==2.2.1 torchvision==0.17.1 torchaudio==2.2.1 ultralytics

# convert the Keras model to TensorFlow‑JS format
RUN tensorflowjs_converter \
        --input_format=keras \
        /app/pokedex_resnet50.h5 \
        /app/web_model_res

######################  Stage 2 – runtime  ######################
FROM python:3.11-slim
WORKDIR /app

# bring everything across (including web_model_res directory)
COPY --from=builder /app /app

RUN pip install --no-cache-dir \
      gunicorn flask flask-cors tensorflow pillow numpy \
      torch==2.2.1 torchvision==0.17.1 ultralytics

ENV PORT=80
EXPOSE 80
CMD ["gunicorn","-b","0.0.0.0:80","predict_server:app",
     "--workers","2","--threads","4","--timeout","120"]
