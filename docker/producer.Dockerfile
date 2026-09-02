FROM node:22-alpine

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm install --omit=dev

COPY packages/ packages/
COPY apps/producer/ apps/producer/
COPY jobs_seed.csv /app/jobs_seed.csv

CMD ["npx", "tsx", "apps/producer/src/main.ts"]
