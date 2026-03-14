.PHONY: proto-gen build-sidecar run-backend dev clean

proto-gen:
	@mkdir -p backend/app/generated
	python -m grpc_tools.protoc \
		-I proto \
		--python_out=backend/app/generated \
		--pyi_out=backend/app/generated \
		--grpc_python_out=backend/app/generated \
		proto/metrics.proto proto/alerts.proto
	@echo "Proto stubs generated in backend/app/generated/"

build-sidecar:
	cd sidecar && cargo build

run-sidecar:
	cd sidecar && cargo run -- --simulate --node-id node-0

run-backend:
	cd backend && uvicorn app.main:app --reload --port 8000

dev:
	docker compose up --build

clean:
	cd sidecar && cargo clean
	rm -f backend/app/generated/*_pb2.py backend/app/generated/*_pb2_grpc.py backend/app/generated/*_pb2.pyi
