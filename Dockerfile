FROM node:9-alpine

COPY . /src
RUN cd /src && npm install && npm run build
EXPOSE 80
ENV PORT 80
WORKDIR /src
CMD ["node", "index.js"]
