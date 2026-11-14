project(NomolNative)
cmake_minimum_required(VERSION 3.9.0)

set (PACKAGE_NAME NomolNative)
set (CMAKE_CXX_STANDARD 20)

add_library(${PACKAGE_NAME} SHARED
        src/main/cpp/cpp-adapter.cpp
)

include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/NomolNative+autolinking.cmake)

find_library(LOG_LIB log)
# The pose landmarker takes VisionCamera's Frame.
find_package(react-native-vision-camera REQUIRED)

target_link_libraries(
        ${PACKAGE_NAME}
        ${LOG_LIB}
        android
        react-native-vision-camera::VisionCamera
)
