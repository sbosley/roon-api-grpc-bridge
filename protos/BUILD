load("@rules_proto//proto:defs.bzl", "proto_library")
load("@io_bazel_rules_go//proto:def.bzl", "go_proto_library")

package(default_visibility = ["//visibility:public"])

proto_library(
    name = "roon_proto",
    srcs = ["roon.proto"],
    deps = [
        "@com_google_protobuf//:wrappers_proto",
    ],
)

go_proto_library(
    name = "roon_go_proto",
    compilers = ["@io_bazel_rules_go//proto:go_grpc"],
    importpath = "github.com/sbosley/roon-api-grpc-bridge/protos/roon_go_proto",
    proto = ":roon_proto",
)
