FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev

COPY server.js .

RUN addgroup -S app && adduser -S app -G app \
  && chown -R app:app /app

USER app

EXPOSE 3000

CMD ["npm", "start"]
