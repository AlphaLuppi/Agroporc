FROM mcr.microsoft.com/playwright/python:v1.43.0-jammy

# Fuseau horaire Paris — le cron interprète les heures en local time.
ENV TZ=Europe/Paris
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y cron tzdata && \
    ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && \
    echo $TZ > /etc/timezone && \
    rm -rf /var/lib/apt/lists/*

# Installer Node.js + Claude CLI
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g @anthropic-ai/claude-code && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/logs /app/output/historique

# Script d'entrée qui charge l'env pour cron
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Cron : lundi 7h30 Paris = semaine, mardi-vendredi 7h30 Paris = jour
RUN echo '30 7 * * 1 root /entrypoint.sh semaine >> /app/logs/cron.log 2>&1' > /etc/cron.d/pdj && \
    echo '30 7 * * 2-5 root /entrypoint.sh jour >> /app/logs/cron.log 2>&1' >> /etc/cron.d/pdj && \
    echo '' >> /etc/cron.d/pdj && \
    chmod 0644 /etc/cron.d/pdj && \
    crontab /etc/cron.d/pdj

CMD ["cron", "-f"]
