FROM mhart/alpine-node:10.12.0

RUN npm install pm2 -g

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

ADD package.json ./
RUN apk add --no-cache git make gcc g++ python libtool autoconf automake \
    && npm install \
    && apk del make gcc g++ python libtool autoconf automake

ADD . /usr/src/app

EXPOSE 1999 2000
