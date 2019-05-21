workspace(name = "roon_api_grpc_bridge")
load("@bazel_tools//tools/build_defs/repo:http.bzl", "http_archive")

http_archive(
    name = "build_bazel_rules_nodejs",
    url = "https://github.com/bazelbuild/rules_nodejs/releases/download/0.28.0/rules_nodejs-0.28.0.tar.gz",
    sha256 = "4c702ffeeab2d24dd4101601b6d27cf582d2e0d4cdc3abefddd4834664669b6b",
)

load("@build_bazel_rules_nodejs//:defs.bzl", "npm_install")
npm_install(
    name = "npm",
    package_json = "//:package.json",
    package_lock_json = "//:package-lock.json",
)

http_archive(
    name = "io_bazel_rules_go",
    url = "https://github.com/bazelbuild/rules_go/releases/download/0.18.4/rules_go-0.18.4.tar.gz",
    sha256 = "3743a20704efc319070957c45e24ae4626a05ba4b1d6a8961e87520296f1b676",
)

load("@io_bazel_rules_go//go:deps.bzl", "go_rules_dependencies", "go_register_toolchains")
go_rules_dependencies() # This also loads all the protobuf rules
go_register_toolchains()

