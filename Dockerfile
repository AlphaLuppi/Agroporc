FROM python:3.12-slim

# Dépendances système pour Playwright/Chromium
RUN apt-get update && apt-get install -y \
    curl \
    cron \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN playwright install chromium --with-deps

COPY . .

# Cron job : tous les jours à 9h, output vers /app/logs/
RUN mkdir -p /app/logs
RUN echo "0 9 * * 1-5 root cd /app && python main.py >> /app/logs/plats-du-jour.log 2>&1" > /etc/cron.d/plats-du-jour
RUN chmod 0644 /etc/cron.d/plats-du-jour
RUN crontab /etc/cron.d/plats-du-jour

CMD ["cron", "-f"]
