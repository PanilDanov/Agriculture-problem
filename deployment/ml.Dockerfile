FROM python:3.11-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN apt-get update && apt-get install --yes --no-install-recommends libgomp1 libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10002 --create-home orbitfarm
COPY yield_prediction ./yield_prediction
RUN python -m pip install --no-cache-dir './yield_prediction[candidates]'
USER orbitfarm
EXPOSE 8001
HEALTHCHECK --interval=20s --timeout=15s --start-period=40s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/ready', timeout=12).read()"
CMD ["python", "-m", "yield_prediction.service", "--host", "0.0.0.0", "--port", "8001"]
