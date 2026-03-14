FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir uv
COPY backend/pyproject.toml .
RUN uv pip install --system -e .
COPY proto/ /app/proto/
COPY backend/ /app/
RUN mkdir -p /app/app/generated && \
    python -m grpc_tools.protoc \
      -I /app/proto \
      --python_out=/app/app/generated \
      --pyi_out=/app/app/generated \
      --grpc_python_out=/app/app/generated \
      /app/proto/metrics.proto /app/proto/alerts.proto
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
