workspace(name = "roon_api_grpc_bridge")
load("@bazel_tools//tools/build_defs/repo:http.bzl", "http_archive")
load("@bazel_tools//tools/build_defs/repo:git.bzl", "git_repository")

# Protobuf/gRPC rules
git_repository(
    name = "rules_proto",
    commit = "f7a30f6f80006b591fa7c437fe5a951eb10bcbcf",
    remote = "https://github.com/bazelbuild/rules_proto",
    shallow_since = "1612880706 +0100",
)
load("@rules_proto//proto:repositories.bzl", "rules_proto_dependencies", "rules_proto_toolchains")
rules_proto_dependencies()
rules_proto_toolchains()

# http_archive(
#     name = "com_github_grpc_grpc",
#     sha256 = "c2dc8e876ea12052d6dd16704492fd8921df8c6d38c70c4708da332cf116df22",
#     strip_prefix = "grpc-1.37.0",
#     urls = [
#         "https://github.com/grpc/grpc/archive/v1.37.0.tar.gz",
#     ],
# )
http_archive(
    name = "com_github_grpc_grpc",
    sha256 = "8eb9d86649c4d4a7df790226df28f081b97a62bf12c5c5fe9b5d31a29cd6541a",
    strip_prefix = "grpc-1.36.4",
    urls = [
        "https://github.com/grpc/grpc/archive/v1.36.4.tar.gz",
    ],
)
load("@com_github_grpc_grpc//bazel:grpc_deps.bzl", "grpc_deps")
grpc_deps()
load("@com_github_grpc_grpc//bazel:grpc_extra_deps.bzl", "grpc_extra_deps")
grpc_extra_deps()

# Node.js rules
http_archive(
    name = "build_bazel_rules_nodejs",
    sha256 = "a160d9ac88f2aebda2aa995de3fa3171300c076f06ad1d7c2e1385728b8442fa",
    urls = ["https://github.com/bazelbuild/rules_nodejs/releases/download/3.4.1/rules_nodejs-3.4.1.tar.gz"],
)

load("@build_bazel_rules_nodejs//:index.bzl", "node_repositories", "npm_install")

# preserve_symlinks = False fixes an issue with the gRPC native dependencies
# See https://github.com/bazelbuild/rules_nodejs/issues/948
node_repositories(
    node_version = "14.15.0",
    package_json = ["//:package.json"],
    preserve_symlinks = False,
)

npm_install(
    name = "npm",
    package_json = "//:package.json",
    package_lock_json = "//:package-lock.json",
)
