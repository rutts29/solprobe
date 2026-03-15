FROM rust:1.85 AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y protobuf-compiler && rm -rf /var/lib/apt/lists/*
COPY proto/ /app/proto/
COPY sidecar/ /app/sidecar/
WORKDIR /app/sidecar
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/sidecar/target/release/solprobe-sidecar /usr/local/bin/
ENTRYPOINT ["solprobe-sidecar"]
