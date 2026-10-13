#!/bin/sh -e
# Rebuilds libc++ and libc++abi for wasm32-wasip1 with optimization, as drop-in replacements for
# the ones bundled in @yowasp/clang. Their build (YoWASP/clang build.sh) passes no
# CMAKE_BUILD_TYPE for the runtimes, so the bundled libraries are unoptimized, which makes
# cin/cout/to_string 5-20x slower than they should be.
#
# Same source commit and the same CMake options as YoWASP, plus -O2.
# Output: src/cpp/libcxx/libc++.a and libc++abi.a. Run from anywhere: libcxx/build.sh

cd "$(dirname "$0")"
HERE=$(pwd)
WORK=$HERE/.work
mkdir -p "$WORK"
cd "$WORK"

# The LLVM commit @yowasp/clang 22.0.0-git20542-10 was built from (`clang --version`).
LLVM_COMMIT=9560ae0f2cc440e4fc891fddbc119da6f56daa59
WASI_VER=29
WASI_SDK=wasi-sdk-${WASI_VER}.0-$(uname -m | sed 's/aarch64/arm64/')-$(uname -s | tr A-Z a-z | sed 's/darwin/macos/')
WASI_SDK_PATH=$WORK/$WASI_SDK
WASI_TARGET=wasm32-wasip1

if [ ! -d llvm-src/.git ]; then
  git init -q llvm-src
  git -C llvm-src remote add origin https://codeberg.org/YoWASP/llvm-project.git
fi
if [ "$(git -C llvm-src rev-parse HEAD 2>/dev/null)" != "$LLVM_COMMIT" ]; then
  git -C llvm-src fetch --depth 1 --filter=blob:none origin $LLVM_COMMIT
  git -C llvm-src sparse-checkout set --no-cone /runtimes /libcxx /libcxxabi /cmake /llvm/cmake \
    /llvm/utils/llvm-lit /llvm/utils/lit /libc/shared /libc/src/__support /libc/hdr \
    /libc/include/llvm-libc-macros /libc/include/llvm-libc-types /libunwind/include \
    /third-party/benchmark/CMakeLists.txt
  git -C llvm-src checkout -q FETCH_HEAD
fi

if [ ! -d "$WASI_SDK" ]; then
  curl -sSL https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${WASI_VER}/${WASI_SDK}.tar.gz | tar xzf -
fi

WASI_CFLAGS="--sysroot ${WASI_SDK_PATH}/share/wasi-sysroot -mcpu=lime1"
cat >Toolchain-WASI.cmake <<END
set(CMAKE_SYSTEM_NAME WASI)
set(CMAKE_SYSTEM_VERSION 1)
set(CMAKE_SYSTEM_PROCESSOR wasm32)
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)
set(CMAKE_C_COMPILER ${WASI_SDK_PATH}/bin/clang)
set(CMAKE_C_COMPILER_TARGET ${WASI_TARGET})
set(CMAKE_CXX_COMPILER ${WASI_SDK_PATH}/bin/clang++)
set(CMAKE_CXX_COMPILER_TARGET ${WASI_TARGET})
set(CMAKE_LINKER ${WASI_SDK_PATH}/bin/wasm-ld)
set(CMAKE_AR ${WASI_SDK_PATH}/bin/ar)
set(CMAKE_RANLIB ${WASI_SDK_PATH}/bin/ranlib)
set(CMAKE_C_FLAGS "${WASI_CFLAGS}")
set(CMAKE_CXX_FLAGS "${WASI_CFLAGS}")
set(CMAKE_EXE_LINKER_FLAGS "--sysroot ${WASI_SDK_PATH}/share/wasi-sysroot")
END

rm -rf libcxx-build prefix
# Options copied from YoWASP's build.sh; the only addition is the build type.
cmake -B libcxx-build -S llvm-src/runtimes \
  -DCMAKE_TOOLCHAIN_FILE="$WORK/Toolchain-WASI.cmake" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_FLAGS_RELEASE="-O2 -DNDEBUG" \
  -DCMAKE_CXX_FLAGS_RELEASE="-O2 -DNDEBUG" \
  -DLLVM_ENABLE_RUNTIMES:STRING="libcxx;libcxxabi" \
  -DLIBCXX_ENABLE_THREADS:BOOL=ON \
  -DLIBCXX_BUILD_EXTERNAL_THREAD_LIBRARY:BOOL=ON \
  -DLIBCXX_ENABLE_SHARED:BOOL=OFF \
  -DLIBCXX_ENABLE_EXCEPTIONS:BOOL=OFF \
  -DLIBCXX_ENABLE_FILESYSTEM:BOOL=ON \
  -DLIBCXX_ENABLE_EXPERIMENTAL_LIBRARY:BOOL=OFF \
  -DLIBCXX_ENABLE_ABI_LINKER_SCRIPT:BOOL=OFF \
  -DLIBCXX_CXX_ABI=libcxxabi \
  -DLIBCXX_CXX_ABI_INCLUDE_PATHS="$WORK/llvm-src/libcxxabi/include" \
  -DLIBCXX_HAS_MUSL_LIBC:BOOL=ON \
  -DLIBCXX_ABI_VERSION=2 \
  -DLIBCXXABI_ENABLE_THREADS:BOOL=ON \
  -DLIBCXXABI_BUILD_EXTERNAL_THREAD_LIBRARY:BOOL=ON \
  -DLIBCXXABI_ENABLE_PIC:BOOL=OFF \
  -DLIBCXXABI_ENABLE_SHARED:BOOL=OFF \
  -DLIBCXXABI_ENABLE_EXCEPTIONS:BOOL=OFF \
  -DLIBCXXABI_USE_LLVM_UNWINDER:BOOL=OFF \
  -DLIBCXXABI_SILENT_TERMINATE:BOOL=ON \
  -DLIBCXX_LIBDIR_SUFFIX=/${WASI_TARGET} \
  -DLIBCXXABI_LIBDIR_SUFFIX=/${WASI_TARGET} \
  -DLIBCXX_INCLUDE_TESTS=OFF \
  -DLIBCXX_INCLUDE_BENCHMARKS=OFF \
  -DLIBCXXABI_INCLUDE_TESTS=OFF \
  -DCMAKE_INSTALL_PREFIX="$WORK/prefix"
cmake --build libcxx-build --target install -j "$(sysctl -n hw.ncpu 2>/dev/null || nproc)"

mkdir -p "$HERE/../src/cpp/libcxx"
cp "prefix/lib/${WASI_TARGET}/libc++.a" "prefix/lib/${WASI_TARGET}/libc++abi.a" "$HERE/../src/cpp/libcxx/"
ls -la "$HERE/../src/cpp/libcxx/"
