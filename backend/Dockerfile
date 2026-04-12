FROM python:3.14-slim
WORKDIR /app

# Install dependencies first (layer caching)
COPY backend/pyproject.toml .
RUN pip install --no-cache-dir .

# Copy proto definitions
COPY proto/ /app/proto/

# Copy application source
COPY backend/app/ /app/app/

# Generate protobuf stubs (overwrites any checked-in stubs)
RUN mkdir -p /app/app/generated && \
    python -m grpc_tools.protoc \
      -I /app/proto \
      --python_out=/app/app/generated \
      --pyi_out=/app/app/generated \
      --grpc_python_out=/app/app/generated \
      /app/proto/metrics.proto /app/proto/alerts.proto

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
