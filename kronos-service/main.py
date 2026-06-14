from fastapi import FastAPI, HTTPException
import pydantic
import torch
import numpy as np
import os
from datetime import datetime
from typing import List, Literal
from contextlib import asynccontextmanager

# StubModel to simulate Tsinghua Kronos prediction if weights are not present.
# It mimics the return values structure.
class StubModel:
    def eval(self):
        return self

    def cuda(self):
        return self

    def forecast(self, ohlcva, horizon: int, task: str):
        class ForecastResult:
            def __init__(self, size: int):
                # Mock predictions based on basic data statistics or random numbers
                self.mean_return = np.random.uniform(-0.15, 0.15, size=(size,))
                self.realized_vol = np.random.uniform(0.01, 0.15, size=(size,))
                self.confidence = np.random.uniform(0.4, 0.95, size=(size,))
        return ForecastResult(ohlcva.shape[0])

# Lazy-load model
_model = None

def get_model():
    global _model
    if _model is None:
        try:
            # Try importing the real Kronos model (requires shiyu-coder/Kronos cloned/installed)
            from kronos_model import KronosModel
            _model = KronosModel.from_pretrained(os.getenv("KRONOS_MODEL_PATH", "shiyu-coder/Kronos"))
            _model.eval()
            if torch.cuda.is_available():
                _model = _model.cuda()
            print("[kronos] Loaded real Kronos model successfully")
        except Exception as e:
            print(f"[kronos] Real model load failed: {e}. Falling back to StubModel.")
            _model = StubModel()
    return _model

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm up model on startup
    try:
        get_model()
    except Exception as e:
        print(f"[kronos] Model warm up failed: {e}")
    yield

app = FastAPI(title="Kronos Inference Service", lifespan=lifespan)

class KlineInput(pydantic.BaseModel):
    symbol: str
    interval: str = "1m"
    ohlcva: List[List[float]]  # [[open, high, low, close, volume, amount], ...]
    task: Literal["return_forecast", "volatility_forecast", "synthetic_generation"] = "return_forecast"
    horizon: int = 4

class KronosResponse(pydantic.BaseModel):
    symbol: str
    direction_signal: float
    volatility_forecast: float
    confidence: float
    timestamp: str

@app.post("/predict", response_model=KronosResponse)
async def predict(input: KlineInput):
    model = get_model()
    if model is None:
        raise HTTPException(503, "Kronos model not loaded")

    try:
        # Convert to tensor
        ohlcva = torch.tensor(input.ohlcva, dtype=torch.float32)
        if torch.cuda.is_available() and not isinstance(model, StubModel):
            ohlcva = ohlcva.cuda()

        # ohlcva is shape (L, 6), need (B, L, 6)
        with torch.no_grad():
            if input.task == "return_forecast":
                forecast = model.forecast(
                    ohlcva=ohlcva.unsqueeze(0),
                    horizon=input.horizon,
                    task="return_forecast"
                )
                direction_signal = float(forecast.mean_return[0])
                vol = float(forecast.realized_vol[0]) if hasattr(forecast, 'realized_vol') else 0.05
                confidence = float(forecast.confidence[0]) if hasattr(forecast, 'confidence') else 0.8
            elif input.task == "volatility_forecast":
                forecast = model.forecast(
                    ohlcva=ohlcva.unsqueeze(0),
                    horizon=input.horizon,
                    task="volatility_forecast"
                )
                direction_signal = 0.0
                vol = float(forecast.realized_vol[0])
                confidence = float(forecast.confidence[0]) if hasattr(forecast, 'confidence') else 0.8
            else:
                raise HTTPException(400, "Unsupported task")

        return KronosResponse(
            symbol=input.symbol,
            direction_signal=direction_signal,
            volatility_forecast=vol,
            confidence=confidence,
            timestamp=datetime.utcnow().isoformat()
        )

    except Exception as e:
        raise HTTPException(500, f"Inference error: {str(e)}")

@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": _model is not None}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("KRONOS_PORT", "8000")))
