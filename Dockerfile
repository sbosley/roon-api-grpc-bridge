FROM node:14-alpine
RUN apk --no-cache add git  # Not included on alpine but needed for npm install

WORKDIR /usr/app/
COPY package*.json config*.json ./
COPY protos/roon.proto ./protos/
COPY app.js ./

RUN npm install

# gRPC port
EXPOSE 50051
CMD ["node", "app.js", "--docker-mac"]
