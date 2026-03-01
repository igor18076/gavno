FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev \
  && node -e "console.log('express at:', require.resolve('express'))"

COPY . .
RUN node -e "console.log('express after copy at:', require.resolve('express'))"

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
