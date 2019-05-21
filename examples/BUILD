load("@io_bazel_rules_go//go:def.bzl", "go_binary")

go_binary(
    name = "bridge_client",
    srcs = ["bridge_client.go"],
    deps = [
        "//protos:roon_go_proto",
        "@com_github_golang_protobuf//proto:go_default_library",
        "@org_golang_google_grpc//:go_default_library",
        "@com_github_golang_protobuf//ptypes/wrappers:go_default_library",
    ],
)

