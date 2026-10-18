# Packaged models

The shared worker uses the lockfile version of `@mediapipe/tasks-vision` and pinned Google model bundles:

- [Face Landmarker float16 version 1](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task)
- [Pose Landmarker Lite float16 version 1](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task)

SHA-256 digests are committed in `packages/analysis/model-checksums.json`. Preparation verifies them and packages identical models/WASM in both products. MediaPipe software is Apache-2.0; consult upstream package/model terms and model cards before redistribution or changing assets. Runtime copyright/license comments are retained.

These geometric landmark models are not validated lie, emotion, identity or deepfake classifiers. CPU inference runs in a classic worker, with up to three faces/poses and a bounded observation window.

Guides: [Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js), [Pose Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js).

`fixtures/portrait.jpg` is Google's public [MediaPipe portrait test asset](https://storage.googleapis.com/mediapipe-assets/portrait.jpg), used only to generate browser-test input and verify actual inference. Test data is never displayed as user analysis, and measurements are not claims about the pictured person.
