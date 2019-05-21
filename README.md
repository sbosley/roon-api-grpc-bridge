# Roon API gRPC Bridge
This project is a [Roon Extension](https://github.com/RoonLabs/node-roon-api). Running this extension starts a [gRPC](https://grpc.io/) server that acts as a bridge to RoonBrowseApi, RoonImageApi, and RoonTransportApi for a single paired core. gRPC services are defined using [protocol buffers](https://developers.google.com/protocol-buffers/), which allows generating idiomatic client libraries for the service in [9+ languages](https://grpc.io/docs/). This project includes a protobuf service definition matching the Roon client APIs, allowing API consumers to use an idiomatic client library in their preferred language to interact with the Roon API, rather than being restricted to using Node.js. 

## Setup
This project and its examples are built with [Bazel](https://bazel.build). To build and run from source, you will need to first install Bazel for your platform using the instructions provided [here](https://docs.bazel.build/versions/master/install.html). Bazel will manage its own versions of all the project's dependencies (including the Node.js runtime for the server and Go SDK + protobuf compiler for the examples), so in theory you shouldn't need to install anything else.

As an alternative, if you don't need to run the examples and would prefer not to install Bazel, you can run the extension using Node.js directly.

## Bridge Server
The service definition can be found in `protos/roon.proto`. The `protos/BUILD` file contains an example of using Bazel to generate a service client library for Go. If you want to use the service definition from another language/platform, you can either use Bazel to define additional language-specific build rules depending on the `//protos:roon_proto` target, or invoke the gRPC proto compiler for your preferred language manually on the `roon.proto` file. See the [gRPC Docs](https://grpc.io/docs/) for instructions on getting started for various platforms.

## Running with Bazel
To run the bridge server using Bazel, run the following from the repository root:
```
bazel run //:bridge-server
```
The gRPC API started by the extension will listen on port 50051 by default. The port may alternatively be specified with the `--port` argument:
```
bazel run //:bridge-server -- --port 1234
```
Bazel will install and manage its own instance of Node.js along with the bridge-server's npm dependencies, so this is the easiest way to get up and running without any additional setup.

## Running with Node
To run using an existing Node.js installation, first install the bridge server dependencies using `npm install`. Then from the repository root, run:
```
node .
# Or, to have gRPC listen on a custom port:
node . --port 1234
```

## Extension authorization
The first time you run the bridge server, you will need to authorize it in Roon. This can be done from Settings>Extensions.

## Running the example
The `examples` directory contains an example Go client calling the gRPC API. The example calls `ListAllZones` and logs the output, then does a series of `Browse` and `Load` calls to demonstrate playing an album from the Roon library in the given zone (it chooses the first in the album list for demo purposes).
To run the example using Bazel, run the following from the repository root:
```
bazel run //examples:bridge_client
```
