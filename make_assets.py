#!/usr/bin/env python3
"""
Walks through the data folder, scales every image and video down and
saves it into a new assets folder with the same structure:

    data/<folder>/<file>   ->   assets/<folder>/<file>

Requirements:
    pip install pillow
    ffmpeg installed and on PATH (for videos)

Usage:
    python make_assets.py
    python make_assets.py --src ../../data --dst ../../assets
    python make_assets.py --img-size 400 --vid-size 360 --force
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageOps

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
VIDEO_EXT = {".mp4", ".mov", ".webm", ".m4v"}


def process_image(src: Path, dst: Path, max_px: int, quality: int):
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im)      # respect phone rotation
        im.thumbnail((max_px, max_px), Image.LANCZOS)  # keeps aspect ratio, never upscales
        ext = dst.suffix.lower()
        if ext in (".jpg", ".jpeg"):
            im.convert("RGB").save(dst, "JPEG", quality=quality, optimize=True, progressive=True)
        elif ext == ".png":
            im.save(dst, "PNG", optimize=True)
        elif ext == ".webp":
            im.save(dst, "WEBP", quality=quality)
        else:  # gif: only the first frame is kept
            im.save(dst)


def process_video(src: Path, dst: Path, max_px: int, fps: int, crf: int):
    vf = (
        f"scale='min({max_px},iw)':'min({max_px},ih)'"
        f":force_original_aspect_ratio=decrease:force_divisible_by=2,fps={fps}"
    )
    if dst.suffix.lower() == ".webm":
        codec = ["-c:v", "libvpx-vp9", "-crf", str(crf + 4), "-b:v", "0"]
    else:
        codec = ["-c:v", "libx264", "-preset", "medium", "-crf", str(crf),
                 "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src),
           "-vf", vf, *codec, "-an", str(dst)]   # -an = drop audio (videos are muted anyway)
    subprocess.run(cmd, check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="../../data", help="original media root")
    ap.add_argument("--dst", default="../../assets", help="output root")
    ap.add_argument("--img-size", type=int, default=512, help="max px of the longer image side")
    ap.add_argument("--vid-size", type=int, default=480, help="max px of the longer video side")
    ap.add_argument("--quality", type=int, default=80, help="jpeg/webp quality")
    ap.add_argument("--fps", type=int, default=24, help="video frame rate")
    ap.add_argument("--crf", type=int, default=28, help="video quality, higher = smaller")
    ap.add_argument("--force", action="store_true", help="overwrite existing outputs")
    a = ap.parse_args()

    src_root, dst_root = Path(a.src).resolve(), Path(a.dst).resolve()
    if not src_root.is_dir():
        sys.exit(f"source folder not found: {src_root}")
    if dst_root == src_root or src_root in dst_root.parents:
        sys.exit("destination must not be inside the source folder")

    has_ffmpeg = shutil.which("ffmpeg") is not None
    if not has_ffmpeg:
        print("warning: ffmpeg not found, videos will be skipped")

    done = skipped = failed = 0
    before = after = 0

    for src in sorted(src_root.rglob("*")):
        if not src.is_file():
            continue
        ext = src.suffix.lower()
        if ext not in IMAGE_EXT and ext not in VIDEO_EXT:
            continue                      # meta.txt etc.
        if ext in VIDEO_EXT and not has_ffmpeg:
            skipped += 1
            continue

        rel = src.relative_to(src_root)
        # .mov / .m4v become .mp4 so every browser can play them
        if ext in (".mov", ".m4v"):
            rel = rel.with_suffix(".mp4")
        dst = dst_root / rel
        dst.parent.mkdir(parents=True, exist_ok=True)

        if dst.exists() and not a.force:
            skipped += 1
            continue

        try:
            if ext in IMAGE_EXT:
                process_image(src, dst, a.img_size, a.quality)
            else:
                process_video(src, dst, a.vid_size, a.fps, a.crf)
            before += src.stat().st_size
            after += dst.stat().st_size
            done += 1
            print(f"ok    {rel}")
        except Exception as e:
            failed += 1
            if dst.exists():
                dst.unlink()              # don't leave half-written files
            print(f"FAIL  {rel}: {e}")

    mb = 1024 * 1024
    print(f"\n{done} converted, {skipped} skipped, {failed} failed")
    if done:
        print(f"{before / mb:.1f} MB -> {after / mb:.1f} MB")


if __name__ == "__main__":
    main()