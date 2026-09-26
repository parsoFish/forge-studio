# Stage 1: builder — installs production deps into an isolated venv
FROM python:3.12-slim AS builder

WORKDIR /app

RUN python -m venv /venv

COPY requirements-prod.txt .
RUN /venv/bin/pip install --no-cache-dir --upgrade pip \
 && /venv/bin/pip install --no-cache-dir -r requirements-prod.txt

# Stage 2: production — lean runtime image
FROM python:3.12-slim

WORKDIR /app

COPY --from=builder /venv /venv
COPY src/ ./src/

ENV PATH="/venv/bin:$PATH"

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz')"

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
