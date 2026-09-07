FROM node:24-alpine

WORKDIR /usr/src

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run buildReact

ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]