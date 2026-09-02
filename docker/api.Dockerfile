FROM node:22-alpine

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm install --omit=dev

COPY packages/ packages/
COPY apps/api/ apps/api/
COPY jobs_seed.csv /app/jobs_seed.csv

EXPOSE 3000

CMD ["npx", "tsx", "apps/api/src/main.ts"]
