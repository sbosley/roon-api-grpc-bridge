load("@build_bazel_rules_nodejs//:index.bzl", "nodejs_binary")

nodejs_binary(
    name = "bridge-server",
    data = [
        "@npm//@grpc/grpc-js",
        "@npm//@grpc/proto-loader",
        "@npm//commander",
        "@npm//loglevel",
        "@npm//node-roon-api",
        "@npm//node-roon-api-status",
        "@npm//node-roon-api-transport",
        "@npm//node-roon-api-browse",
        "@npm//node-roon-api-image",
        "@//protos:roon.proto",
        "app.js",
    ],
    entry_point = ":app.js",
)
