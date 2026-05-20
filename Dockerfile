# Cron image pro stock sync (KGM potrebuje chromium -> Playwright base image).
# Web bezi na Vercelu; tenhle Dockerfile pouziva JEN Render Cron Job.
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

# Nejdriv jen manifesty kvuli cache
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# Zbytek projektu (scripts/, src/ atd.)
COPY . .

# Jistota, ze chromium build sedi k nainstalovane verzi playwrightu
RUN npx playwright install chromium

# Render Cron spusti tento command podle rozvrhu
CMD ["npm", "run", "sync:stock"]
