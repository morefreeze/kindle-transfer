FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-package-lock
COPY . .
EXPOSE 3456
CMD ["node", "server.js"]
