FROM node:14-alpine
RUN apk --no-cache add git  # Not included on alpine but needed for npm install

WORKDIR /usr/app/
COPY package*.json config*.json ./
COPY protos/roon.proto ./protos/
COPY app.js ./

RUN npm install

# gRPC port
EXPOSE 50051
ENTRYPOINT [ "node", "app.js" ]
CMD ["--roon-host=host.docker.internal", "--roon-port=9300"]
