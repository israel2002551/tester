[app]
title = TesterMobileV1
package.name = testermobilev1
package.domain = org.wrapper.app
source.dir = .
source.include_exts = py,png,jpg,kv,atlas
version = 0.1

requirements = python3,kivy,pyjnius

# Permissions for the web
android.permissions = INTERNET, ACCESS_NETWORK_STATE

android.arch = armeabi-v7a, arm64-v8a
android.minapi = 21
android.api = 33
orientation = portrait
android.accept_sdk_license = True
