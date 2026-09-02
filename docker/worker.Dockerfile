FROM node:22-alpine

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm install --omit=dev

COPY packages/ packages/
COPY apps/worker/ apps/worker/

CMD ["npx", "tsx", "apps/worker/src/main.ts"]
