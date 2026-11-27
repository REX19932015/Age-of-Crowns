FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY server.js season.js world.js ./
COPY lib ./lib
COPY data ./data
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
