"""Build the Career CoPilot OpenAI Build Week demo and an editable JianYing draft."""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
import sys
import textwrap
import wave
from pathlib import Path

import edge_tts
import cv2
import imageio_ffmpeg
from playwright.sync_api import sync_playwright


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


CURRENT_DIR = Path(__file__).resolve().parent
REPO_ROOT = CURRENT_DIR.parents[1]
ENV_ROOT = os.getenv("JY_SKILL_ROOT", "").strip()
SKILL_CANDIDATES = [
    ENV_ROOT,
    CURRENT_DIR / ".agent" / "skills" / "jianying-editor",
    CURRENT_DIR / ".trae" / "skills" / "jianying-editor",
    CURRENT_DIR / ".claude" / "skills" / "jianying-editor",
    CURRENT_DIR / "skills" / "jianying-editor",
    REPO_ROOT / ".agent" / "skills" / "jianying-editor",
    REPO_ROOT / ".agents" / "skills" / "jianying-editor",
    Path.cwd() / ".agent" / "skills" / "jianying-editor",
    CURRENT_DIR.parent,
]

SCRIPTS_PATH: Path | None = None
ATTEMPTED: list[str] = []
for candidate in SKILL_CANDIDATES:
    if not candidate:
        continue
    candidate_path = Path(candidate).resolve()
    ATTEMPTED.append(str(candidate_path))
    if (candidate_path / "scripts" / "jy_wrapper.py").exists():
        SCRIPTS_PATH = candidate_path / "scripts"
        break

if SCRIPTS_PATH is None:
    raise ImportError(
        "Could not find jianying-editor/scripts/jy_wrapper.py\nTried:\n- "
        + "\n- ".join(ATTEMPTED)
    )

if str(SCRIPTS_PATH) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_PATH))

from jy_wrapper import JyProject  # noqa: E402
import pyJianYingDraft as draft  # noqa: E402


TOTAL_DURATION = 176.0
PROJECT_NAME = "Career CoPilot - OpenAI Build Week"
VOICE = "en-US-GuyNeural"
VOICE_RATE = "+6%"
FFMPEG = Path(imageio_ffmpeg.get_ffmpeg_exe())
ARTIFACT_ROOT = Path(
    os.getenv(
        "BUILD_WEEK_ARTIFACT_ROOT",
        str(Path.home() / "Videos" / "Career-CoPilot-OpenAI-Build-Week"),
    )
).resolve()
SOURCE_ROOT = Path(
    os.getenv(
        "CAREER_COPILOT_VIDEO_SOURCE",
        r"D:\Dev\github\kairwang01\career-copilot-jianying-backup",
    )
).resolve()
DRAFTS_ROOT = Path(os.getenv("JY_PROJECTS_ROOT", r"D:\JianyingPro Drafts")).resolve()
REUSE_RENDERED = os.getenv("BUILD_WEEK_REUSE_RENDERED", "").strip().lower() in {
    "1",
    "true",
    "yes",
}
REMUX_RENDERED = os.getenv("BUILD_WEEK_REMUX_RENDERED", "").strip().lower() in {
    "1",
    "true",
    "yes",
}
REUSE_VOICE = os.getenv("BUILD_WEEK_REUSE_VOICE", "").strip().lower() in {
    "1",
    "true",
    "yes",
}


SCENES = [
    {
        "id": "intro",
        "start": 0.0,
        "end": 9.0,
        "text": (
            "What if one workspace could turn resume evidence into a clearer path to a better hire? "
            "This is Career CoPilot."
        ),
    },
    {
        "id": "problem",
        "start": 9.0,
        "end": 23.0,
        "text": (
            "Candidates usually move between resume editors, job boards, spreadsheets, and interview tools. "
            "We built one guided workflow for candidates and hiring teams."
        ),
    },
    {
        "id": "resume",
        "start": 23.0,
        "end": 43.0,
        "text": (
            "A candidate starts with a resume. Career CoPilot produces an evidence-based readiness report, "
            "identifies skill gaps, and turns them into concrete next actions."
        ),
    },
    {
        "id": "workspace",
        "start": 43.0,
        "end": 61.0,
        "text": (
            "The same workspace supports career planning, explainable opportunity matching, application tracking, "
            "and timed interview practice with feedback tied to the target role."
        ),
    },
    {
        "id": "employer",
        "start": 61.0,
        "end": 80.0,
        "text": (
            "For employers, opted-in candidates enter a structured workflow. Hiring teams see supporting evidence, "
            "manage stages and scorecards, and keep decisions auditable."
        ),
    },
    {
        "id": "localization",
        "start": 80.0,
        "end": 95.0,
        "text": (
            "The product supports seven interface languages and adapts resume structure for different hiring markets, "
            "rather than translating labels alone."
        ),
    },
    {
        "id": "reliability",
        "start": 95.0,
        "end": 121.0,
        "text": (
            "Reliability lives behind the interface. Every AI request is authenticated, validated, claimed once, "
            "routed by server policy, checked against a structured schema, and recorded or refunded safely if execution fails."
        ),
    },
    {
        "id": "release",
        "start": 121.0,
        "end": 139.0,
        "text": (
            "Privileged actions, credits, consent, and hiring state remain server authoritative. "
            "The release gate verifies source contracts, focused tests, server boundaries, and browser journeys on an exact commit."
        ),
    },
    {
        "id": "codex",
        "start": 139.0,
        "end": 166.0,
        "text": (
            "Codex with GPT-5.6 accelerated our Build Week workflow. It mapped the TypeScript and server-functions codebase, "
            "traced failure paths across components, generated focused tests, and compared every product claim with source and runtime evidence. "
            "We made the product and architecture decisions, reviewed each change, and kept deployment approval human-controlled."
        ),
    },
    {
        "id": "closing",
        "start": 166.0,
        "end": 176.0,
        "text": (
            "Career CoPilot is a governed decision-support system connecting resume evidence, "
            "interview readiness, and hiring decisions."
        ),
    },
]


ASSET_MAP = {
    "landing.webm": SOURCE_ROOT / "source" / "dti_real" / "final" / "f2_landing_framed.mp4",
    "workspace.webm": SOURCE_ROOT / "source" / "dti_real" / "final" / "f5_workspace_framed.mp4",
    "i18n.webm": SOURCE_ROOT / "source" / "dti_real" / "final" / "f4_i18n_framed.mp4",
    "cover.png": REPO_ROOT / "public" / "og-cover.png",
    "resume-readiness-report.png": REPO_ROOT / "public" / "product-screenshots" / "resume-readiness-report.png",
    "interview-practice-feedback.png": REPO_ROOT / "public" / "product-screenshots" / "interview-practice-feedback.png",
    "employer-candidate-match.png": REPO_ROOT / "public" / "product-screenshots" / "employer-candidate-match.png",
    "career-path-planner.png": REPO_ROOT / "public" / "product-screenshots" / "career-path-planner.png",
}


def run(command: list[str | Path], *, cwd: Path | None = None) -> None:
    printable = " ".join(str(part) for part in command)
    print(f"[run] {printable}")
    subprocess.run(
        [str(part) for part in command],
        cwd=str(cwd) if cwd else None,
        check=True,
    )


def prepare_assets(assets_dir: Path) -> None:
    assets_dir.mkdir(parents=True, exist_ok=True)
    missing = [str(source) for source in ASSET_MAP.values() if not source.exists()]
    if missing:
        raise FileNotFoundError("Missing source assets:\n- " + "\n- ".join(missing))
    for target_name, source in ASSET_MAP.items():
        target = assets_dir / target_name
        if target.suffix.lower() == ".webm":
            if target.exists() and target.stat().st_mtime >= source.stat().st_mtime:
                continue
            run(
                [
                    FFMPEG,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    source,
                    "-an",
                    "-c:v",
                    "libvpx-vp9",
                    "-crf",
                    "27",
                    "-b:v",
                    "0",
                    "-row-mt",
                    "1",
                    target,
                ]
            )
        else:
            shutil.copy2(source, target)


async def synthesize_scene(text: str, output_mp3: Path) -> None:
    communicate = edge_tts.Communicate(
        text=text,
        voice=VOICE,
        rate=VOICE_RATE,
        pitch="-2Hz",
    )
    await communicate.save(str(output_mp3))


def wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as wav_file:
        return wav_file.getnframes() / float(wav_file.getframerate())


def build_voice_clips(voice_dir: Path) -> list[dict]:
    voice_dir.mkdir(parents=True, exist_ok=True)
    rendered: list[dict] = []
    for scene in SCENES:
        mp3_path = voice_dir / f"{scene['id']}.mp3"
        wav_path = voice_dir / f"{scene['id']}.wav"
        asyncio.run(synthesize_scene(scene["text"], mp3_path))
        run(
            [
                FFMPEG,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                mp3_path,
                "-ar",
                "48000",
                "-ac",
                "2",
                wav_path,
            ]
        )
        duration = wav_duration(wav_path)
        available = scene["end"] - scene["start"] - 0.65
        if duration > available:
            speed = duration / available
            compressed_path = voice_dir / f"{scene['id']}-compressed.wav"
            run(
                [
                    FFMPEG,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    wav_path,
                    "-filter:a",
                    f"atempo={speed:.5f}",
                    "-ar",
                    "48000",
                    "-ac",
                    "2",
                    compressed_path,
                ]
            )
            compressed_path.replace(wav_path)
            duration = wav_duration(wav_path)
        rendered.append({**scene, "wav": wav_path, "duration": duration})
    return rendered


def build_narration(voice_clips: list[dict], output_path: Path) -> None:
    command: list[str | Path] = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y"]
    filters: list[str] = []
    labels: list[str] = []
    for index, scene in enumerate(voice_clips):
        command.extend(["-i", scene["wav"]])
        delay_ms = int(round((scene["start"] + 0.35) * 1000))
        filters.append(f"[{index}:a]adelay={delay_ms}|{delay_ms}[voice{index}]")
        labels.append(f"[voice{index}]")
    filters.append(
        "".join(labels)
        + f"amix=inputs={len(labels)}:duration=longest:dropout_transition=0,"
        + "loudnorm=I=-16:TP=-1.5:LRA=11[narration]"
    )
    command.extend(
        [
            "-filter_complex",
            ";".join(filters),
            "-map",
            "[narration]",
            "-t",
            f"{TOTAL_DURATION:.3f}",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-c:a",
            "pcm_s16le",
            output_path,
        ]
    )
    run(command)


def caption_chunks(text: str, max_words: int = 11) -> list[str]:
    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", text) if part.strip()]
    chunks: list[str] = []
    for sentence in sentences:
        words = sentence.split()
        while words:
            chunk = words[:max_words]
            words = words[max_words:]
            chunks.append(" ".join(chunk))
    return chunks


def format_srt_time(seconds: float) -> str:
    millis = max(0, int(round(seconds * 1000)))
    hours, remainder = divmod(millis, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def build_srt(voice_clips: list[dict], output_path: Path) -> None:
    entries: list[str] = []
    index = 1
    for scene in voice_clips:
        chunks = caption_chunks(scene["text"])
        weights = [max(1, len(chunk.split())) for chunk in chunks]
        total_weight = sum(weights)
        cursor = scene["start"] + 0.35
        for chunk, weight in zip(chunks, weights):
            duration = scene["duration"] * weight / total_weight
            end = min(cursor + duration, scene["end"] - 0.15)
            wrapped = "\n".join(textwrap.wrap(chunk, width=48, break_long_words=False))
            entries.append(
                f"{index}\n{format_srt_time(cursor)} --> {format_srt_time(end)}\n{wrapped}\n"
            )
            index += 1
            cursor = end
    output_path.write_text("\n".join(entries), encoding="utf-8-sig")


def record_visual(html_path: Path, output_video: Path) -> None:
    temp_dir = output_video.parent / "playwright-scenes"
    if temp_dir.exists():
        shutil.rmtree(temp_dir)
    temp_dir.mkdir(parents=True)
    normalized_scenes: list[Path] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for scene in SCENES:
            scene_dir = temp_dir / scene["id"]
            scene_dir.mkdir()
            context = browser.new_context(
                record_video_dir=str(scene_dir),
                record_video_size={"width": 1920, "height": 1080},
                viewport={"width": 1920, "height": 1080},
                device_scale_factor=1,
            )
            page = context.new_page()
            page.goto(f"{html_path.as_uri()}?scene={scene['id']}", wait_until="load")
            scene_duration = scene["end"] - scene["start"]
            page.wait_for_function(
                "() => window.animationFinished === true",
                timeout=int((scene_duration + 20) * 1000),
            )
            context.close()
            raw_videos = list(scene_dir.glob("*.webm"))
            if len(raw_videos) != 1:
                raise RuntimeError(
                    f"Expected one recorded visual for {scene['id']}, found {len(raw_videos)}"
                )
            raw_video = raw_videos[0]
            captured_duration = video_duration(raw_video)
            timing_factor = scene_duration / captured_duration
            normalized = temp_dir / f"{scene['id']}.mp4"
            run(
                [
                    FFMPEG,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    raw_video,
                    "-vf",
                    f"setpts={timing_factor:.9f}*PTS,fps=30",
                    "-t",
                    f"{scene_duration:.3f}",
                    "-an",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "medium",
                    "-crf",
                    "18",
                    "-pix_fmt",
                    "yuv420p",
                    normalized,
                ]
            )
            normalized_scenes.append(normalized)
        browser.close()

    concat_file = temp_dir / "concat.txt"
    concat_file.write_text(
        "\n".join(f"file '{path.as_posix()}'" for path in normalized_scenes),
        encoding="utf-8",
    )
    run(
        [
            FFMPEG,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            concat_file,
            "-c",
            "copy",
            output_video,
        ]
    )
    shutil.rmtree(temp_dir)


def video_duration(path: Path) -> float:
    capture = cv2.VideoCapture(str(path))
    fps = capture.get(cv2.CAP_PROP_FPS)
    frames = capture.get(cv2.CAP_PROP_FRAME_COUNT)
    capture.release()
    if fps <= 0 or frames <= 0:
        raise RuntimeError(f"Could not measure video duration: {path}")
    return frames / fps


def mux_video(visual_video: Path, narration_wav: Path, clean_mp4: Path) -> None:
    captured_duration = video_duration(visual_video)
    timing_factor = TOTAL_DURATION / captured_duration
    run(
        [
            FFMPEG,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            visual_video,
            "-i",
            narration_wav,
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-vf",
            f"setpts={timing_factor:.9f}*PTS,fps=30",
            "-t",
            f"{TOTAL_DURATION:.3f}",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            clean_mp4,
        ]
    )


def burn_subtitles(clean_mp4: Path, srt_path: Path, final_mp4: Path) -> None:
    subtitle_filter = (
        f"subtitles={srt_path.name}:"
        "force_style='FontName=Segoe UI,FontSize=26,PrimaryColour=&H00FFFFFF,"
        "OutlineColour=&H00101A2E,BorderStyle=1,Outline=3,Shadow=0,Alignment=2,MarginV=38'"
    )
    run(
        [
            FFMPEG,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            clean_mp4.name,
            "-vf",
            subtitle_filter,
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "copy",
            "-movflags",
            "+faststart",
            final_mp4.name,
        ],
        cwd=final_mp4.parent,
    )


def create_diagnostics(
    final_mp4: Path,
    clean_mp4: Path,
    thumbnail: Path,
    contact_sheet: Path,
) -> None:
    run(
        [
            FFMPEG,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            "2.2",
            "-i",
            clean_mp4,
            "-vf",
            "scale=1500:844,pad=1500:1000:0:78:color=#f4f8ff",
            "-frames:v",
            "1",
            thumbnail,
        ]
    )
    run(
        [
            FFMPEG,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            final_mp4,
            "-vf",
            "fps=1/17.6,scale=480:270,tile=5x2:padding=4:margin=4",
            "-frames:v",
            "1",
            contact_sheet,
        ]
    )


def create_jianying_draft(clean_mp4: Path, srt_path: Path) -> dict:
    project = JyProject(
        PROJECT_NAME,
        width=1920,
        height=1080,
        drafts_root=str(DRAFTS_ROOT),
        overwrite=True,
    )
    segment = project.add_media_safe(
        str(clean_mp4),
        start_time="0s",
        duration=f"{TOTAL_DURATION:.3f}s",
        track_name="Main Demo",
    )
    if segment is None:
        raise RuntimeError("Failed to add the final demo video to the JianYing draft")
    project.script.import_srt(
        str(srt_path),
        "Subtitles",
        text_style=draft.TextStyle(
            size=6.8,
            bold=True,
            align=1,
            auto_wrapping=True,
            max_line_width=0.78,
        ),
        clip_settings=draft.ClipSettings(transform_y=-0.82),
    )
    return project.save()


def main() -> None:
    ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
    assets_dir = ARTIFACT_ROOT / "assets"
    voice_dir = ARTIFACT_ROOT / "voice"
    html_path = ARTIFACT_ROOT / "openai_build_week_showcase.html"
    visual_video = ARTIFACT_ROOT / "career-copilot-build-week-visual.mp4"
    narration_wav = ARTIFACT_ROOT / "career-copilot-build-week-narration.wav"
    srt_path = ARTIFACT_ROOT / "career-copilot-openai-build-week.srt"
    clean_mp4 = ARTIFACT_ROOT / "career-copilot-openai-build-week-clean.mp4"
    final_mp4 = ARTIFACT_ROOT / "career-copilot-openai-build-week-demo.mp4"
    thumbnail = ARTIFACT_ROOT / "career-copilot-build-week-thumbnail.png"
    contact_sheet = ARTIFACT_ROOT / "career-copilot-build-week-contact-sheet.png"
    report_path = ARTIFACT_ROOT / "build-report.json"

    prepare_assets(assets_dir)
    shutil.copy2(CURRENT_DIR / "assets" / "openai_build_week_showcase.html", html_path)
    voice_reusable = all(
        (voice_dir / f"{scene['id']}.wav").exists() for scene in SCENES
    ) and narration_wav.exists() and srt_path.exists()
    if REUSE_VOICE and voice_reusable:
        voice_clips = [
            {
                **scene,
                "wav": voice_dir / f"{scene['id']}.wav",
                "duration": wav_duration(voice_dir / f"{scene['id']}.wav"),
            }
            for scene in SCENES
        ]
    else:
        voice_clips = build_voice_clips(voice_dir)
        build_narration(voice_clips, narration_wav)
        build_srt(voice_clips, srt_path)

    reusable = all(
        path.exists()
        for path in [voice_dir, narration_wav, srt_path, visual_video, clean_mp4, final_mp4]
    )
    if REUSE_RENDERED and reusable:
        if REMUX_RENDERED:
            mux_video(visual_video, narration_wav, clean_mp4)
            burn_subtitles(clean_mp4, srt_path, final_mp4)
            create_diagnostics(final_mp4, clean_mp4, thumbnail, contact_sheet)
        if not thumbnail.exists() or not contact_sheet.exists():
            create_diagnostics(final_mp4, clean_mp4, thumbnail, contact_sheet)
    else:
        record_visual(html_path, visual_video)
        mux_video(visual_video, narration_wav, clean_mp4)
        burn_subtitles(clean_mp4, srt_path, final_mp4)
        create_diagnostics(final_mp4, clean_mp4, thumbnail, contact_sheet)
    draft_result = create_jianying_draft(clean_mp4, srt_path)

    report = {
        "ok": True,
        "code": "ok",
        "reason": "",
        "data": {
            "duration_seconds": TOTAL_DURATION,
            "video": str(final_mp4),
            "clean_video": str(clean_mp4),
            "subtitles": str(srt_path),
            "thumbnail": str(thumbnail),
            "contact_sheet": str(contact_sheet),
            "draft": draft_result,
            "voice": VOICE,
            "music": None,
            "scene_audio_durations": {
                scene["id"]: round(scene["duration"], 3) for scene in voice_clips
            },
        },
    }
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
