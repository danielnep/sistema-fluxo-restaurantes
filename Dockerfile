FROM node:22-alpine
WORKDIR /app
COPY package.json server.mjs ./
COPY public ./public
RUN mkdir -p /data
ENV NODE_ENV=production PORT=3050 DB_PATH=/data/fluxo.sqlite
EXPOSE 3050
VOLUME ["/data"]
CMD ["npm","start"]
