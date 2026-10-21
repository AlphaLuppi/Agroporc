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

# Cron : lundi 7h30 Paris = semaine, mardi-vendredi 7h30 Paris = jour,
#        retries toutes les 15 min de 7h45 à 10h00 (no-op ~2 s si complet),
#        lundi-vendredi 13h Paris = desserts (postés vers midi par le Truck Muche),
#        lundi-vendredi 10h35 Paris = images IA des plats (POC) manquantes, du lundi au vendredi
#        lundi-vendredi 11h15 Paris = recettes maison des plats (POC) manquantes, du jour seulement
#        lundi 6h45 Paris = gifs fétiches des IA rafraîchis depuis les memes du moment (meme.com)
#        (avant le run semaine de 7h30 qui génère les commentaires)
#        (après le dernier retry 10h00 et la fin des images ≤ 11h05 ; dates = plats vraiment servis)
RUN echo '30 7 * * 1 root /entrypoint.sh semaine >> /app/logs/cron.log 2>&1' > /etc/cron.d/pdj && \
    echo '45 6 * * 1 root /entrypoint.sh memes >> /app/logs/cron.log 2>&1' >> /etc/cron.d/pdj && \
    echo '30 7 * * 2-5 root /entrypoint.sh jour >> /app/logs/cron.log 2>&1' >> /etc/cron.d/pdj && \
    echo '45 7 * * 1-5 root /entrypoint.sh retry >> /app/logs/cron.log 2>&1' >> /etc/cron.d/pdj && \
    echo '0,15,30,45 8-9 * * 1-5 root /entrypoint.sh retry >> /app/logs/cron.log 2>&1' >> /etc/cron.d/pdj && \
    echo '0 10 * * 1-5 root /entrypoint.sh retry final >> /app/logs/cron.log 2>&1' >> /etc/cron.d/pdj && \
    echo '0 13 * * 1-5 root /entrypoint.sh desserts >> /app/logs/cron.log 2>&1' >> /etc/cron.d/pdj && \
    echo '35 10 * * 1-5 root /entrypoint.sh images semaine >> /app/logs/cron.log 2>&1' >> /etc/cron.d/pdj && \
    echo '15 11 * * 1-5 root /entrypoint.sh recettes >> /app/logs/cron.log 2>&1' >> /etc/cron.d/pdj && \
    echo '' >> /etc/cron.d/pdj && \
    chmod 0644 /etc/cron.d/pdj && \
    crontab /etc/cron.d/pdj

CMD ["cron", "-f"]
