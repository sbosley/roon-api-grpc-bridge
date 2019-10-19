load("@build_bazel_rules_nodejs//:defs.bzl", "nodejs_binary")

nodejs_binary(
    name = "bridge-server",
    data = [
        "@npm//grpc",
        "@npm//@grpc/proto-loader",
        "@npm//commander",
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
