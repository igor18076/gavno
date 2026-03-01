FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund \
  && node -e "console.log('express at:', require.resolve('express'))"

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
