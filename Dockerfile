# specify the node base image with your desired version node:<version>
FROM node:11
WORKDIR /usr/app/
COPY package*.json config*.json ./
COPY protos/roon.proto ./protos/
COPY app.js ./
RUN npm install

# gRPC port
EXPOSE 50051
CMD ["node", "app.js", "--docker-mac"]
