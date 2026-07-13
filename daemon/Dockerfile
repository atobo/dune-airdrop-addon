FROM python:3.11-alpine

WORKDIR /app

# Install postgres client dependencies
RUN apk add --no-cache libpq

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY worker.py .

CMD ["python", "-u", "worker.py"]
