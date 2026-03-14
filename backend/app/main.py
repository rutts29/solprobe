from fastapi import FastAPI

app = FastAPI(title="SolProbe API", version="0.1.0")


@app.get("/api/v1/health")
async def health():
    return {"status": "ok", "connected_sidecars": 0}
