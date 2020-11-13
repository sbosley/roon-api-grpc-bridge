workspace(name = "roon_api_grpc_bridge")
load("@bazel_tools//tools/build_defs/repo:http.bzl", "http_archive")
load("@bazel_tools//tools/build_defs/repo:git.bzl", "git_repository")

# Protobuf/gRPC rules
git_repository(
    name = "rules_proto",
    commit = "7e4afce6fe62dbff0a4a03450143146f9f2d7488",
    remote = "https://github.com/bazelbuild/rules_proto",
    shallow_since = "1603787634 +0100",
)
load("@rules_proto//proto:repositories.bzl", "rules_proto_dependencies", "rules_proto_toolchains")
rules_proto_dependencies()
rules_proto_toolchains()

http_archive(
    name = "com_github_grpc_grpc",
    sha256 = "2060769f2d4b0d3535ba594b2ab614d7f68a492f786ab94b4318788d45e3278a",
    strip_prefix = "grpc-1.33.2",
    urls = [
        "https://github.com/grpc/grpc/archive/v1.33.2.tar.gz",
    ],
)
load("@com_github_grpc_grpc//bazel:grpc_deps.bzl", "grpc_deps")
grpc_deps()
load("@com_github_grpc_grpc//bazel:grpc_extra_deps.bzl", "grpc_extra_deps")
grpc_extra_deps()

# Node.js rules
http_archive(
    name = "build_bazel_rules_nodejs",
    sha256 = "4952ef879704ab4ad6729a29007e7094aef213ea79e9f2e94cbe1c9a753e63ef",
    urls = ["https://github.com/bazelbuild/rules_nodejs/releases/download/2.2.0/rules_nodejs-2.2.0.tar.gz"],
)

load("@build_bazel_rules_nodejs//:index.bzl", "node_repositories", "npm_install")

# preserve_symlinks = False fixes an issue with the gRPC native dependencies
# See https://github.com/bazelbuild/rules_nodejs/issues/948
node_repositories(
    package_json = ["//:package.json"],
    preserve_symlinks = False,
)

npm_install(
    name = "npm",
    package_json = "//:package.json",
    package_lock_json = "//:package-lock.json",
)
