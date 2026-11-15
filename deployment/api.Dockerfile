FROM node:24-bookworm-slim AS website
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV VITE_ORBITFARM_LIVE_API=1 VITE_API_BASE_URL=""
RUN npm run build

FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    ORBITFARM_FRONTEND_DIR=/app/dist \
    ORBITFARM_CACHE_DIR=/var/cache/orbitfarm \
    ORBITFARM_REGIONAL_INPUT_DIR=/app/agronomy/regional_inputs
WORKDIR /app
RUN apt-get update && apt-get install --yes --no-install-recommends libexpat1 libgomp1 libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home orbitfarm \
    && mkdir -p /var/cache/orbitfarm /app/regional-inputs \
    && chown -R orbitfarm:orbitfarm /var/cache/orbitfarm /app/regional-inputs
COPY agronomy/requirements-*.txt ./agronomy/
RUN python -m pip install --no-cache-dir -r agronomy/requirements-api.txt
COPY agronomy ./agronomy
COPY data_pipeline.py AgroWise_crop_requirements_clean.csv ./
COPY --from=website /app/dist ./dist
USER orbitfarm
EXPOSE 8000
HEALTHCHECK --interval=20s --timeout=10s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/ready', timeout=8).read()"
CMD ["python", "-m", "uvicorn", "agronomy.api:app", "--host", "0.0.0.0", "--port", "8000"]
