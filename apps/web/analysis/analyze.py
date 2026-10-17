#!/usr/bin/env python3
"""CPU-friendly, local video analysis worker for Behavior Analyzer.

The worker intentionally produces measurements and cautious observations. It does
not infer truthfulness, deception, intent, or a person's internal mental state.
MediaPipe, librosa, and faster-whisper are optional at runtime so a report can
still be produced from ffprobe/audio/video metadata when one model is unavailable.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import statistics
import subprocess
import sys
import wave
from pathlib import Path
from typing import Any

try:
    import cv2  # type: ignore
except Exception:
    cv2 = None

try:
    import numpy as np  # type: ignore
except Exception:
    np = None


STAGES = {
    "Reading media": 10,
    "Extracting audio": 17,
    "Detecting subject": 25,
    "Analyzing face": 37,
    "Analyzing eyes": 47,
    "Analyzing body": 57,
    "Analyzing voice": 68,
    "Transcribing speech": 76,
    "Calculating baseline": 84,
    "Building timeline": 92,
    "Preparing report": 97,
}


def progress(stage: str, value: int | None = None) -> None:
    print("PROGRESS " + json.dumps({"stage": stage, "progress": value or STAGES.get(stage, 0)}), flush=True)


def finite(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
        return number if math.isfinite(number) else default
    except (TypeError, ValueError):
        return default


def rounded(value: Any, digits: int = 3) -> float:
    return round(finite(value), digits)


def clamp(value: Any, low: float, high: float) -> float:
    return min(high, max(low, finite(value)))


def mean_or(values: Any, default: float = 0.0) -> float:
    values = list(values)
    return statistics.mean(values) if values else default


def pstdev_or(values: Any, default: float = 0.0) -> float:
    values = list(values)
    return statistics.pstdev(values) if len(values) > 1 else default


def run_command(command: list[str], timeout: int = 180, check: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=check)


def ffprobe(input_path: str) -> dict[str, Any]:
    result = run_command([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration,format_name,size:stream=codec_type,width,height,r_frame_rate,sample_rate,channels",
        "-of", "json", input_path,
    ], timeout=60)
    if result.returncode != 0:
        raise RuntimeError("FFmpeg could not read this file. Check that it is a valid MP4, MOV, or WebM video.")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("The media metadata was not readable.") from exc


def parse_rate(value: Any) -> float:
    if isinstance(value, str) and "/" in value:
        numerator, denominator = value.split("/", 1)
        denominator_value = finite(denominator)
        return finite(numerator) / denominator_value if denominator_value else 0.0
    return finite(value)


def media_info(probe: dict[str, Any], max_minutes: float) -> tuple[dict[str, Any], float, bool]:
    streams = probe.get("streams") or []
    format_info = probe.get("format") or {}
    duration = finite(format_info.get("duration"))
    if duration <= 0:
        duration = max((finite(stream.get("duration")) for stream in streams), default=0.0)
    if duration <= 0:
        raise RuntimeError("The video duration could not be determined.")
    if duration > max_minutes * 60:
        raise RuntimeError(f"Videos must be {max_minutes:g} minutes or shorter.")
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), {})
    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), {})
    media = {
        "width": int(finite(video.get("width"))),
        "height": int(finite(video.get("height"))),
        "frameRate": rounded(parse_rate(video.get("r_frame_rate")), 2),
        "hasAudio": bool(audio),
        "audioSampleRate": int(finite(audio.get("sample_rate"))),
        "audioChannels": int(finite(audio.get("channels"))),
        "format": str(format_info.get("format_name") or ""),
        "sizeBytes": int(finite(format_info.get("size"))),
    }
    return media, duration, bool(audio)


def extract_audio(input_path: str, output_path: str, has_audio: bool) -> bool:
    if not has_audio:
        return False
    result = run_command([
        "ffmpeg", "-y", "-v", "error", "-i", input_path, "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", output_path,
    ], timeout=240)
    return result.returncode == 0 and Path(output_path).exists()


def distance(a: Any, b: Any) -> float:
    return math.sqrt((finite(getattr(a, "x", 0)) - finite(getattr(b, "x", 0))) ** 2 + (finite(getattr(a, "y", 0)) - finite(getattr(b, "y", 0))) ** 2)


def mean_point(points: list[Any]) -> tuple[float, float]:
    if not points:
        return 0.5, 0.5
    return (sum(finite(point.x) for point in points) / len(points), sum(finite(point.y) for point in points) / len(points))


def face_observation(landmarks: Any, refine: bool = True) -> dict[str, float]:
    points = landmarks.landmark
    left_open = distance(points[159], points[145]) / max(0.001, distance(points[33], points[133]))
    right_open = distance(points[386], points[374]) / max(0.001, distance(points[362], points[263]))
    left_eye = mean_point([points[33], points[133]])
    right_eye = mean_point([points[362], points[263]])
    if refine and len(points) >= 478:
        left_iris = mean_point(points[468:473])
        right_iris = mean_point(points[473:478])
        left_gaze_x = (left_iris[0] - min(points[33].x, points[133].x)) / max(0.001, abs(points[33].x - points[133].x))
        right_gaze_x = (right_iris[0] - min(points[362].x, points[263].x)) / max(0.001, abs(points[362].x - points[263].x))
        left_gaze_y = (left_iris[1] - min(points[159].y, points[145].y)) / max(0.001, abs(points[159].y - points[145].y))
        right_gaze_y = (right_iris[1] - min(points[386].y, points[374].y)) / max(0.001, abs(points[386].y - points[374].y))
        gaze_x = (left_gaze_x + right_gaze_x) / 2
        gaze_y = (left_gaze_y + right_gaze_y) / 2
    else:
        gaze_x, gaze_y = 0.5, 0.5
    mouth_open = distance(points[13], points[14]) / max(0.001, distance(points[61], points[291]))
    mouth_width = distance(points[61], points[291])
    brow_activity = (abs(points[70].y - points[159].y) + abs(points[300].y - points[386].y)) / 2
    nose = points[1]
    face_center_x = (points[234].x + points[454].x) / 2
    face_center_y = (points[10].y + points[152].y) / 2
    yaw = (nose.x - face_center_x) * 180
    pitch = (nose.y - face_center_y) * 180
    return {
        "eyeOpen": clamp((left_open + right_open) / 2, 0, 2),
        "leftEyeOpen": clamp(left_open, 0, 2),
        "rightEyeOpen": clamp(right_open, 0, 2),
        "gazeX": clamp(gaze_x, 0, 1),
        "gazeY": clamp(gaze_y, 0, 1),
        "mouthOpen": clamp(mouth_open, 0, 2),
        "mouthWidth": clamp(mouth_width, 0, 1),
        "browActivity": clamp(brow_activity * 10, 0, 2),
        "headYaw": clamp(yaw, -90, 90),
        "headPitch": clamp(pitch, -90, 90),
        "faceActivity": clamp((mouth_open * 0.45 + brow_activity * 8 + abs(yaw) / 90 * 0.25), 0, 2),
        "faceVisible": 1.0,
    }


def pose_observation(landmarks: Any) -> dict[str, float]:
    points = landmarks.landmark
    required = [points[i] for i in (11, 12, 23, 24)]
    visible = sum(1 for point in required if finite(getattr(point, "visibility", 0)) > 0.45) / len(required)
    left_shoulder, right_shoulder = points[11], points[12]
    left_hip, right_hip = points[23], points[24]
    shoulder_center = mean_point([left_shoulder, right_shoulder])
    hip_center = mean_point([left_hip, right_hip])
    torso_angle = math.degrees(math.atan2(shoulder_center[0] - hip_center[0], max(0.001, hip_center[1] - shoulder_center[1])))
    shoulder_motion = abs(left_shoulder.x - right_shoulder.x) + abs(left_shoulder.y - right_shoulder.y)
    return {
        "bodyVisible": visible,
        "torsoAngle": clamp(torso_angle, -90, 90),
        "shoulderSpan": clamp(distance(left_shoulder, right_shoulder), 0, 2),
        "bodyCenterX": clamp((shoulder_center[0] + hip_center[0]) / 2, 0, 1),
        "bodyCenterY": clamp((shoulder_center[1] + hip_center[1]) / 2, 0, 1),
        "shoulderActivity": clamp(shoulder_motion, 0, 2),
    }


def difference_percent(value: float, baseline: float) -> float:
    if abs(baseline) < 0.0001:
        return 0.0
    return rounded((value - baseline) / abs(baseline) * 100, 1)


def process_video(input_path: str, duration: float, face_fps: float, pose_fps: float) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, float]]:
    if cv2 is None:
        return [], [], {"faceDetected": 0, "bodyDetected": 0}
    try:
        import mediapipe as mp  # type: ignore
    except Exception:
        return [], [], {"faceDetected": 0, "bodyDetected": 0}

    face_samples: list[dict[str, Any]] = []
    pose_samples: list[dict[str, Any]] = []
    capture = cv2.VideoCapture(input_path)
    if not capture.isOpened():
        return [], [], {"faceDetected": 0, "bodyDetected": 0}
    fps = finite(capture.get(cv2.CAP_PROP_FPS), 25)
    fps = max(1, fps)
    next_face = 0.0
    next_pose = 0.0
    face_interval = 1 / max(0.5, face_fps)
    pose_interval = 1 / max(0.5, pose_fps)
    frame_index = 0
    frame_total = max(1, int(capture.get(cv2.CAP_PROP_FRAME_COUNT)))
    try:
        with mp.solutions.face_mesh.FaceMesh(static_image_mode=False, max_num_faces=1, refine_landmarks=True, min_detection_confidence=0.5, min_tracking_confidence=0.5) as face_mesh, mp.solutions.pose.Pose(static_image_mode=False, model_complexity=0, smooth_landmarks=True, min_detection_confidence=0.5, min_tracking_confidence=0.5) as pose:
            while True:
                ok, frame = capture.read()
                if not ok:
                    break
                timestamp = frame_index / fps
                frame_index += 1
                if timestamp >= next_face or timestamp >= next_pose:
                    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    if timestamp >= next_face:
                        face_result = face_mesh.process(rgb)
                        if face_result.multi_face_landmarks:
                            sample = face_observation(face_result.multi_face_landmarks[0], True)
                            sample["timestamp"] = round(timestamp, 3)
                            face_samples.append(sample)
                        next_face += face_interval
                    if timestamp >= next_pose:
                        pose_result = pose.process(rgb)
                        if pose_result.pose_landmarks:
                            sample = pose_observation(pose_result.pose_landmarks)
                            sample["timestamp"] = round(timestamp, 3)
                            pose_samples.append(sample)
                        next_pose += pose_interval
                if frame_index % max(1, int(fps * 3)) == 0:
                    progress("Analyzing face", 25 + min(10, int(frame_index / frame_total * 10)))
    finally:
        capture.release()
    return add_motion(face_samples, "faceActivity"), add_motion(pose_samples, "bodyCenterX"), {
        "faceDetected": len(face_samples),
        "bodyDetected": len(pose_samples),
    }


def add_motion(samples: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    previous = None
    for sample in samples:
        if previous is not None:
            if key == "faceActivity":
                sample["headMovement"] = abs(sample.get("headYaw", 0) - previous.get("headYaw", 0)) + abs(sample.get("headPitch", 0) - previous.get("headPitch", 0))
                sample["facialChange"] = abs(sample.get("faceActivity", 0) - previous.get("faceActivity", 0))
            else:
                sample["bodyMovement"] = abs(sample.get("bodyCenterX", 0) - previous.get("bodyCenterX", 0)) + abs(sample.get("bodyCenterY", 0) - previous.get("bodyCenterY", 0))
                sample["headMovement"] = 0.0
        else:
            sample["headMovement"] = 0.0
            sample["facialChange"] = 0.0
            sample["bodyMovement"] = 0.0
        previous = sample
    return samples


def category_for_gaze(sample: dict[str, Any]) -> str:
    x, y = finite(sample.get("gazeX"), 0.5), finite(sample.get("gazeY"), 0.5)
    if x < 0.34: return "left"
    if x > 0.66: return "right"
    if y < 0.34: return "up"
    if y > 0.66: return "down"
    return "center"


def make_face_and_eye_events(samples: list[dict[str, Any]], duration: float) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
    if not samples:
        empty = {"averageGazeActivity": 0, "gazeShiftsPerMinute": 0, "blinkRate": 0, "averageEyeOpenness": 0, "faceVisiblePercentage": 0}
        return [], [], empty, {"facialActivity": 0, "mouthActivity": 0, "eyebrowActivity": 0, "headYawAverage": 0, "headPitchAverage": 0, "faceVisiblePercentage": 0}
    gaze_events: list[dict[str, Any]] = []
    face_events: list[dict[str, Any]] = []
    states = [category_for_gaze(sample) for sample in samples]
    shifts = sum(1 for index in range(1, len(states)) if states[index] != states[index - 1])
    blink_count = 0
    in_blink = False
    gaze_away_start: float | None = None
    gaze_away_state: str | None = None
    for index, (sample, state) in enumerate(zip(samples, states)):
        closed = finite(sample.get("eyeOpen")) < 0.22
        if closed and not in_blink:
            blink_count += 1
        in_blink = closed
        if state != "center" and gaze_away_start is None:
            gaze_away_start, gaze_away_state = finite(sample.get("timestamp")), state
        if state == "center" and gaze_away_start is not None:
            end = finite(sample.get("timestamp"))
            if end - gaze_away_start >= 0.65:
                gaze_events.append({"timestamp": rounded(gaze_away_start, 1), "endTimestamp": rounded(end, 1), "category": "eyes", "event": "gaze_away", "label": f"Gaze away ({gaze_away_state})", "duration": rounded(end - gaze_away_start, 1), "confidence": 0.7})
            gaze_away_start, gaze_away_state = None, None
        if index > 0 and state != states[index - 1]:
            gaze_events.append({"timestamp": finite(sample.get("timestamp")), "category": "eyes", "event": "gaze_shift", "label": "Gaze shift", "value": 1, "confidence": 0.67})
    if gaze_away_start is not None:
        end = duration
        if end - gaze_away_start >= 0.65:
            gaze_events.append({"timestamp": rounded(gaze_away_start, 1), "endTimestamp": rounded(end, 1), "category": "eyes", "event": "gaze_away", "label": f"Gaze away ({gaze_away_state})", "duration": rounded(end - gaze_away_start, 1), "confidence": 0.7})
    gaze_mean = statistics.mean(abs(finite(sample.get("gazeX"), 0.5) - 0.5) * 2 for sample in samples)
    eye_open = statistics.mean(finite(sample.get("eyeOpen")) for sample in samples)
    face_visible = statistics.mean(finite(sample.get("faceVisible")) for sample in samples) * 100
    blink_rate = blink_count / max(duration, 1) * 60
    direction_counts = {direction: states.count(direction) / len(states) * 100 for direction in ("center", "left", "right", "up", "down")}
    left_right_repeats = sum(1 for index in range(1, len(states)) if {states[index], states[index - 1]} == {"left", "right"})
    head_gaze_alignment = mean_or((1 if ((finite(sample.get("headYaw")) >= 0 and finite(sample.get("gazeX"), 0.5) >= 0.5) or (finite(sample.get("headYaw")) < 0 and finite(sample.get("gazeX"), 0.5) < 0.5)) else 0 for sample in samples)) * 100
    gaze_summary = {"averageGazeActivity": rounded(gaze_mean), "gazeShiftsPerMinute": rounded(shifts / max(duration, 1) * 60, 1), "blinkRate": rounded(blink_rate, 1), "averageEyeOpenness": rounded(eye_open), "leftEyeOpenness": rounded(statistics.mean(finite(sample.get("leftEyeOpen")) for sample in samples)), "rightEyeOpenness": rounded(statistics.mean(finite(sample.get("rightEyeOpen")) for sample in samples)), "fixationDurationSeconds": rounded(duration / max(1, shifts + 1), 1), "gazeAwayEvents": len([event for event in gaze_events if event["event"] == "gaze_away"]), "repeatedLeftRightMovements": left_right_repeats, "headGazeAlignmentPercentage": rounded(head_gaze_alignment, 1), "gazeCenterPercentage": rounded(direction_counts["center"], 1), "gazeLeftPercentage": rounded(direction_counts["left"], 1), "gazeRightPercentage": rounded(direction_counts["right"], 1), "gazeUpPercentage": rounded(direction_counts["up"], 1), "gazeDownPercentage": rounded(direction_counts["down"], 1), "faceVisiblePercentage": rounded(face_visible, 1)}
    face_summary = {"facialActivity": rounded(statistics.mean(finite(sample.get("faceActivity")) for sample in samples)), "mouthActivity": rounded(statistics.mean(finite(sample.get("mouthOpen")) for sample in samples)), "eyebrowActivity": rounded(statistics.mean(finite(sample.get("browActivity")) for sample in samples)), "headYawAverage": rounded(statistics.mean(finite(sample.get("headYaw")) for sample in samples), 1), "headPitchAverage": rounded(statistics.mean(finite(sample.get("headPitch")) for sample in samples), 1), "faceVisiblePercentage": rounded(face_visible, 1)}
    if blink_count:
        gaze_events.append({"timestamp": finite(samples[0].get("timestamp")), "category": "eyes", "event": "blink_rate", "label": "Blink rate measured", "value": rounded(blink_rate, 1), "confidence": 0.68})
    if shifts >= max(3, int(duration / 15)):
        gaze_events.append({"timestamp": finite(samples[0].get("timestamp")), "category": "eyes", "event": "gaze_activity_increased", "label": "Gaze activity increased", "value": shifts, "confidence": 0.65})
    if face_summary["facialActivity"] > 0.55:
        face_events.append({"timestamp": finite(samples[0].get("timestamp")), "category": "face", "event": "facial_activity_high", "label": "High facial activity", "value": face_summary["facialActivity"], "confidence": 0.64})
    elif face_summary["facialActivity"] < 0.2:
        face_events.append({"timestamp": finite(samples[0].get("timestamp")), "category": "face", "event": "facial_activity_low", "label": "Low facial activity", "value": face_summary["facialActivity"], "confidence": 0.64})
    return gaze_events, face_events, gaze_summary, face_summary


def read_wav(audio_path: str) -> tuple[int, list[float]]:
    with wave.open(audio_path, "rb") as audio:
        rate = audio.getframerate()
        frames = audio.readframes(audio.getnframes())
    if np is not None:
        values = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
        return rate, values.tolist()
    values = []
    for index in range(0, len(frames) - 1, 2):
        raw = int.from_bytes(frames[index:index + 2], "little", signed=True)
        values.append(raw / 32768.0)
    return rate, values


def audio_analysis(audio_path: str, duration: float) -> tuple[list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]]:
    if not Path(audio_path).exists():
        return [], {"averagePitch": 0, "pitchVariation": 0, "averageVolume": 0, "volumeVariation": 0, "speakingRate": 0, "averagePauseDuration": 0, "voiceActivityPercentage": 0}, []
    rate, values = read_wav(audio_path)
    window = max(1, int(rate * 0.5))
    series: list[dict[str, Any]] = []
    rms_values: list[float] = []
    for start in range(0, len(values), window):
        chunk = values[start:start + window]
        if not chunk: continue
        rms = math.sqrt(sum(value * value for value in chunk) / len(chunk))
        rms_values.append(rms)
        series.append({"timestamp": rounded(start / rate, 2), "rms": rounded(rms, 4), "value": rounded(20 * math.log10(max(rms, 0.00001)), 1)})
    noise_floor = statistics.median(rms_values) if rms_values else 0.0
    threshold = max(0.008, noise_floor * 1.8)
    speaking = [value >= threshold for value in rms_values]
    segments: list[tuple[float, float]] = []
    active_start: float | None = None
    for index, active in enumerate(speaking + [False]):
        at = index * 0.5
        if active and active_start is None: active_start = at
        if not active and active_start is not None:
            if at - active_start >= 0.35: segments.append((active_start, min(at, duration)))
            active_start = None
    pauses: list[tuple[float, float]] = []
    for before, after in zip(segments, segments[1:]):
        if after[0] - before[1] >= 0.5: pauses.append((before[1], after[0]))
    events: list[dict[str, Any]] = []
    for start, end in pauses:
        pause_duration = end - start
        if pause_duration >= 1.2:
            events.append({"timestamp": rounded(start, 1), "endTimestamp": rounded(end, 1), "category": "voice", "event": "long_pause", "label": "Long pause", "duration": rounded(pause_duration, 1), "confidence": 0.78})
    active_duration = sum(end - start for start, end in segments)
    avg_volume = mean_or((20 * math.log10(max(value, 0.00001)) for value in rms_values), -60)
    volume_variation = pstdev_or((20 * math.log10(max(value, 0.00001)) for value in rms_values), 0)
    pitch_values: list[float] = []
    try:
        import librosa  # type: ignore
        if np is not None and values:
            audio = np.asarray(values, dtype=np.float32)
            for start in range(0, len(audio), rate):
                chunk = audio[start:start + rate]
                if len(chunk) < 2048: continue
                pitch = librosa.yin(chunk, fmin=60, fmax=420, sr=rate, frame_length=2048, hop_length=1024)
                valid = [finite(value) for value in pitch if 60 <= finite(value) <= 420]
                if valid: pitch_values.append(statistics.median(valid))
                if len(pitch_values) >= 300: break
    except Exception:
        pitch_values = []
    average_pitch = statistics.mean(pitch_values) if pitch_values else 0
    pitch_variation = statistics.pstdev(pitch_values) if len(pitch_values) > 1 else 0
    average_pause = mean_or((end - start for start, end in pauses), 0)
    summary = {"averagePitch": rounded(average_pitch, 1), "pitchVariation": rounded(pitch_variation, 1), "averageVolume": rounded(avg_volume, 1), "volumeVariation": rounded(volume_variation, 1), "speakingRate": 0, "averagePauseDuration": rounded(average_pause, 1), "longPauseCount": len(events), "speakingSections": len(segments), "silenceSeconds": rounded(max(0, duration - active_duration), 1), "voiceActivityPercentage": rounded(active_duration / max(duration, 1) * 100, 1)}
    for point in series: point["value"] = point.pop("value")
    return events, summary, series


def transcribe(audio_path: str, model_name: str) -> list[dict[str, Any]]:
    if not Path(audio_path).exists(): return []
    try:
        from faster_whisper import WhisperModel  # type: ignore
        model = WhisperModel(model_name, device="cpu", compute_type="int8")
        segments, _info = model.transcribe(audio_path, beam_size=1, vad_filter=True)
        return [{"start": rounded(segment.start, 2), "end": rounded(segment.end, 2), "text": str(segment.text).strip()} for segment in segments if str(segment.text).strip()]
    except Exception as exc:
        print(f"Whisper unavailable: {exc}", file=sys.stderr, flush=True)
        return []


def estimate_speaking_rate(transcript: list[dict[str, Any]], voice_summary: dict[str, Any]) -> float:
    if transcript:
        words = sum(len(segment["text"].split()) for segment in transcript)
        duration = sum(max(0.1, finite(segment["end"]) - finite(segment["start"])) for segment in transcript)
        return rounded(words / max(duration, 1) * 60, 1)
    active_percent = finite(voice_summary.get("voiceActivityPercentage"))
    return rounded(active_percent * 0.34, 1)


def median_early(samples: list[dict[str, Any]], key: str, default: float = 0) -> float:
    if not samples: return default
    count = max(1, int(len(samples) * 0.3))
    values = [finite(item.get(key)) for item in samples[:count] if key in item]
    return statistics.median(values) if values else default


def body_events(samples: list[dict[str, Any]], duration: float) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if not samples: return [], {"bodyVisiblePercentage": 0, "movementIntensity": 0, "torsoAngle": 0, "postureShifts": 0, "stillnessPercentage": 0}
    movement = [finite(sample.get("bodyMovement")) for sample in samples]
    shifts = sum(1 for value in movement if value > 0.025)
    intensity = mean_or(movement, 0) * 10
    stillness = sum(1 for value in movement if value < 0.01) / len(movement) * 100
    torso = mean_or((finite(sample.get("torsoAngle")) for sample in samples))
    summary = {"bodyVisiblePercentage": rounded(statistics.mean(finite(sample.get("bodyVisible")) for sample in samples) * 100, 1), "movementIntensity": rounded(intensity), "torsoAngle": rounded(torso, 1), "leaningDirection": "forward" if torso < -8 else "backward" if torso > 8 else "centered", "postureShifts": shifts, "stillnessPercentage": rounded(stillness, 1), "shoulderActivity": rounded(statistics.mean(finite(sample.get("shoulderActivity")) for sample in samples))}
    events: list[dict[str, Any]] = []
    for sample in samples:
        value = finite(sample.get("bodyMovement")) * 10
        if value > max(0.18, intensity * 1.7):
            events.append({"timestamp": finite(sample.get("timestamp")), "category": "body", "event": "movement_increased", "label": "Movement intensity increased", "value": rounded(value), "confidence": 0.66})
    if summary["stillnessPercentage"] > 70:
        events.append({"timestamp": finite(samples[0].get("timestamp")), "category": "body", "event": "stillness", "label": "Sustained stillness", "value": summary["stillnessPercentage"], "confidence": 0.68})
    return events[:30], summary


def sections_and_baseline(face_samples: list[dict[str, Any]], pose_samples: list[dict[str, Any]], eyes: dict[str, Any], face: dict[str, Any], voice: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    early_face = face_samples[:max(1, int(len(face_samples) * 0.3))]
    early_pose = pose_samples[:max(1, int(len(pose_samples) * 0.3))]
    return {
        "gazeShiftsPerMinute": rounded(eyes.get("gazeShiftsPerMinute")),
        "blinkRate": rounded(eyes.get("blinkRate")),
        "facialActivity": rounded(mean_or((finite(item.get("faceActivity")) for item in early_face), finite(face.get("facialActivity")))),
        "bodyMovement": rounded(mean_or((finite(item.get("bodyMovement")) * 10 for item in early_pose), finite(body.get("movementIntensity")))),
        "headMovement": rounded(median_early(face_samples, "headMovement")),
        "averagePitch": rounded(voice.get("averagePitch")),
        "pitchVariation": rounded(voice.get("pitchVariation")),
        "speakingRate": rounded(voice.get("speakingRate")),
        "averageVolume": rounded(voice.get("averageVolume")),
        "averagePauseDuration": rounded(voice.get("averagePauseDuration")),
        "baselineWindow": "Earlier 30% of the available recording",
        "sufficientData": bool(face_samples or pose_samples),
    }


def baseline_deviation_events(face_samples: list[dict[str, Any]], pose_samples: list[dict[str, Any]], baseline: dict[str, Any], duration: float) -> list[dict[str, Any]]:
    """Compare later time windows with the earlier recording baseline."""
    events: list[dict[str, Any]] = []
    window = max(5.0, duration / 8)

    def add(timestamp: float, category: str, event: str, label: str, value: float, base: float, confidence: float = 0.66) -> None:
        difference = difference_percent(value, base)
        if abs(difference) < 25 or abs(base) < 0.0001:
            return
        direction = "increased" if difference > 0 else "decreased"
        events.append({"timestamp": rounded(timestamp, 1), "endTimestamp": rounded(min(duration, timestamp + window), 1), "category": category, "event": event, "label": f"{label} {direction}", "value": rounded(value, 2), "baseline": rounded(base, 2), "differencePercent": difference, "confidence": confidence})

    for start in [index * window for index in range(max(1, math.ceil(duration / window)))] [1:]:
        end = min(duration, start + window)
        face_window = [item for item in face_samples if start <= finite(item.get("timestamp")) < end]
        pose_window = [item for item in pose_samples if start <= finite(item.get("timestamp")) < end]
        if face_window:
            face_activity = mean_or((finite(item.get("faceActivity")) for item in face_window))
            head_movement = mean_or((finite(item.get("headMovement")) for item in face_window))
            gaze_states = [category_for_gaze(item) for item in face_window]
            gaze_shifts = sum(1 for index in range(1, len(gaze_states)) if gaze_states[index] != gaze_states[index - 1]) / max((end - start), 1) * 60
            add(start, "face", "facial_activity_deviation", "Facial activity", face_activity, finite(baseline.get("facialActivity")))
            add(start, "face", "head_movement_deviation", "Head movement", head_movement, finite(baseline.get("headMovement")))
            add(start, "eyes", "gaze_shift_deviation", "Gaze shifting", gaze_shifts, finite(baseline.get("gazeShiftsPerMinute")))
        if pose_window:
            movement = mean_or((finite(item.get("bodyMovement")) * 10 for item in pose_window))
            add(start, "body", "body_movement_deviation", "Body movement", movement, finite(baseline.get("bodyMovement")))
    return events[:40]


def multi_signal_events(face_samples: list[dict[str, Any]], pose_samples: list[dict[str, Any]], voice_events: list[dict[str, Any]], baseline: dict[str, Any], duration: float) -> list[dict[str, Any]]:
    buckets: dict[int, list[str]] = {}
    for sample in face_samples:
        timestamp = int(finite(sample.get("timestamp")) // 5)
        if finite(sample.get("headMovement")) > max(0.08, finite(baseline.get("headMovement")) * 1.8): buckets.setdefault(timestamp, []).append("head movement increased")
        if finite(sample.get("facialChange")) > max(0.08, finite(baseline.get("facialActivity")) * 0.25): buckets.setdefault(timestamp, []).append("facial activity changed")
        if category_for_gaze(sample) != "center": buckets.setdefault(timestamp, []).append("gaze direction changed")
    for sample in pose_samples:
        timestamp = int(finite(sample.get("timestamp")) // 5)
        if finite(sample.get("bodyMovement")) > max(0.025, finite(baseline.get("bodyMovement")) * 0.08): buckets.setdefault(timestamp, []).append("body movement increased")
    for event in voice_events:
        timestamp = int(finite(event.get("timestamp")) // 5)
        buckets.setdefault(timestamp, []).append(event.get("label", "voice changed"))
    combined = []
    for bucket, signals in buckets.items():
        unique = list(dict.fromkeys(signals))
        if len(unique) >= 3:
            timestamp = min(duration, bucket * 5 + 0.1)
            combined.append({"timestamp": rounded(timestamp, 1), "endTimestamp": rounded(min(duration, timestamp + 5), 1), "category": "combined", "event": "multiple_behavioral_changes", "label": "Multiple behavioral changes", "value": len(unique), "confidence": 0.62, "detail": "Several behavioral signals changed during this section. This pattern may be consistent with increased activation, concentration, uncertainty, discomfort, or other causes; other explanations are possible."})
    return combined[:20]


def section(summary: dict[str, Any], events: list[dict[str, Any]], series: list[dict[str, Any]]) -> dict[str, Any]:
    clean_series = []
    for item in series:
        timestamp = rounded(item.get("timestamp"), 2)
        numeric = finite(item.get("value"))
        clean_series.append({"timestamp": timestamp, "value": rounded(numeric, 3), **({"label": item["label"]} if "label" in item else {})})
    return {"summary": summary, "events": sorted(events, key=lambda item: finite(item.get("timestamp"))), "series": clean_series[:1200]}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--max-minutes", type=float, default=30)
    parser.add_argument("--face-fps", type=float, default=4)
    parser.add_argument("--pose-fps", type=float, default=2)
    parser.add_argument("--whisper-model", default="tiny")
    args = parser.parse_args()

    progress("Reading media")
    probe = ffprobe(args.input)
    media, duration, has_audio = media_info(probe, args.max_minutes)
    progress("Extracting audio")
    audio_path = str(Path(args.output).with_name("audio.wav"))
    audio_ready = extract_audio(args.input, audio_path, has_audio)
    progress("Detecting subject")
    progress("Analyzing face")
    face_samples, pose_samples, detection = process_video(args.input, duration, args.face_fps, args.pose_fps)
    progress("Analyzing eyes")
    eye_events, face_events, eye_summary, face_summary = make_face_and_eye_events(face_samples, duration)
    progress("Analyzing body")
    body_events_list, body_summary = body_events(pose_samples, duration)
    progress("Analyzing voice")
    voice_events, voice_summary, voice_series = audio_analysis(audio_path, duration) if audio_ready else ([], {"averagePitch": 0, "pitchVariation": 0, "averageVolume": 0, "volumeVariation": 0, "speakingRate": 0, "averagePauseDuration": 0, "voiceActivityPercentage": 0}, [])
    progress("Transcribing speech")
    transcript = transcribe(audio_path, args.whisper_model) if audio_ready else []
    voice_summary["speakingRate"] = estimate_speaking_rate(transcript, voice_summary)
    progress("Calculating baseline")
    baseline = sections_and_baseline(face_samples, pose_samples, eye_summary, face_summary, voice_summary, body_summary)
    progress("Building timeline")
    deviation_events = baseline_deviation_events(face_samples, pose_samples, baseline, duration)
    eye_events.extend([event for event in deviation_events if event.get("category") == "eyes"])
    face_events.extend([event for event in deviation_events if event.get("category") == "face"])
    body_events_list.extend([event for event in deviation_events if event.get("category") == "body"])
    combined_events = multi_signal_events(face_samples, pose_samples, voice_events + deviation_events, baseline, duration)
    eye_series = [{"timestamp": item.get("timestamp"), "value": abs(finite(item.get("gazeX"), 0.5) - 0.5) * 2} for item in face_samples]
    face_series = [{"timestamp": item.get("timestamp"), "value": item.get("faceActivity", 0)} for item in face_samples]
    body_series = [{"timestamp": item.get("timestamp"), "value": finite(item.get("bodyMovement")) * 10} for item in pose_samples]
    voice_chart = [{"timestamp": item.get("timestamp"), "value": item.get("value", 0)} for item in voice_series]
    all_events = sorted(eye_events + face_events + body_events_list + voice_events + combined_events, key=lambda item: finite(item.get("timestamp")))
    notable = [event for event in all_events if event.get("category") == "combined"] + [event for event in all_events if event.get("event") in ("long_pause", "gaze_away", "movement_increased")][:8]
    face_visible = finite(eye_summary.get("faceVisiblePercentage"))
    body_visible = finite(body_summary.get("bodyVisiblePercentage"))
    overview = {"behavioralChanges": len(all_events), "faceVisiblePercentage": rounded(face_visible, 1), "bodyVisiblePercentage": rounded(body_visible, 1), "notableMoments": notable[:12], "methodNote": "Measurements are computer-vision and audio signals, not conclusions about deception, honesty, intent, emotion, or mental state."}
    result = {
        "jobId": args.job_id,
        "duration": rounded(duration, 2),
        "media": media,
        "baseline": baseline,
        "overview": overview,
        "subjects": [{"subjectId": "subject-1", "detectionConfidence": 0.76 if detection.get("faceDetected") else 0.0, "faceVisiblePercentage": rounded(face_visible, 1), "bodyVisiblePercentage": rounded(body_visible, 1)}],
        "timeline": all_events,
        "eyes": section(eye_summary, eye_events, eye_series),
        "face": section(face_summary, face_events, face_series),
        "body": section(body_summary, body_events_list, body_series),
        "voice": section(voice_summary, voice_events, voice_chart),
        "transcript": transcript,
        "summary": [
            f"{len(all_events)} measurable event{'' if len(all_events) == 1 else 's'} were timestamped across the recording.",
            f"Face visibility was {face_visible:.0f}% and body visibility was {body_visible:.0f}% in sampled frames.",
            "Changes are compared with this speaker's earlier recording baseline; other explanations are always possible.",
        ],
    }
    progress("Preparing report")
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    try: Path(audio_path).unlink(missing_ok=True)
    except Exception: pass
    progress("Complete", 100)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Analysis error: {exc}", file=sys.stderr, flush=True)
        raise
