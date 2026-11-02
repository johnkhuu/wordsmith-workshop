#!/usr/bin/env python3
"""Record the film's voiceover with Kokoro and master it for the web.

Writes assets/film/vo/<id>.mp3 and assets/film/vo/durations.json. After a
re-record, copy the new durations into CUES in assets/film/film-scenes.js
(the unit tests check they match) and check the timeline still fits.

Setup (once), in a virtualenv:
    pip install kokoro-onnx soundfile phonemizer-fork
    curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
    curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
ffmpeg must be on the PATH.

Usage:
    python3 tools/film/make_voiceover.py --models /path/to/model/folder [--only n3,n6]
"""

import argparse, json, os, pathlib, subprocess, sys, tempfile

# id, voice, speed, text. Keep in step with CUES in assets/film/film-scenes.js.
LINES = [
    ("n1", "af_heart", 1.0, "You've read this email a thousand times."),
    ("b1", "am_michael", 0.92, "I hope this message finds you well!"),
    ("b2", "am_michael", 0.92, "Your kindness is a vibrant testament."),
    ("n2", "af_heart", 1.0, "Words that could belong to anyone."),
    ("n3", "af_heart", 1.0, "Wordsmith Workshop puts your point first, and backs it with real details."),
    ("n4", "af_heart", 1.0, "It shapes each piece with methods real editors use,"),
    ("n5", "af_heart", 1.0, "then checks every line for the tells that give a chatbot away."),
    ("n6", "af_heart", 1.0, "Now it sounds like you."),
    ("n7", "af_heart", 1.0, "Wordsmith Workshop. Lead with the point."),
]

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "assets" / "film" / "vo"
TRIM = ("silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.03,areverse,"
        "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.08,areverse")
POLISH = ("highpass=f=70,equalizer=f=3200:t=q:w=1.2:g=1.5,"
          "acompressor=threshold=-22dB:ratio=2.5:attack=8:release=140:makeup=2,"
          "alimiter=limit=0.5:attack=3:release=40:level=false")


def ff(*args, capture=False):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-y", *args], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(r.stderr)
    return r.stderr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", required=True, help="folder with kokoro-v1.0.onnx and voices-v1.0.bin")
    ap.add_argument("--only", help="comma-separated line ids to re-record")
    a = ap.parse_args()

    import espeakng_loader, soundfile as sf
    from kokoro_onnx import Kokoro
    from kokoro_onnx.config import EspeakConfig

    # espeak-ng truncates long data paths, so point it at a short symlink.
    short = pathlib.Path(tempfile.gettempdir()) / "espk"
    short.mkdir(exist_ok=True)
    link = short / "espeak-ng-data"
    if not link.exists():
        link.symlink_to(espeakng_loader.get_data_path())
    os.environ["ESPEAK_DATA_PATH"] = str(short)
    k = Kokoro(str(pathlib.Path(a.models) / "kokoro-v1.0.onnx"), str(pathlib.Path(a.models) / "voices-v1.0.bin"),
               espeak_config=EspeakConfig(data_path=str(short)))

    only = set(a.only.split(",")) if a.only else None
    OUT.mkdir(parents=True, exist_ok=True)
    work = pathlib.Path(tempfile.mkdtemp())
    for key, voice, speed, text in LINES:
        if only and key not in only:
            continue
        samples, sr = k.create(text, voice=voice, speed=speed, lang="en-us")
        raw, pre = work / f"{key}.wav", work / f"{key}.pre.wav"
        sf.write(raw, samples, sr)
        ff("-i", str(raw), "-af", f"{TRIM},{POLISH}", "-ar", "24000", str(pre))
        # two-pass loudness normalisation to -18 LUFS, true peak -1.5 dB
        log = ff("-i", str(pre), "-af", "loudnorm=I=-18:TP=-1.5:LRA=7:print_format=json", "-f", "null", "-")
        m = json.loads(log[log.index("{"):log.rindex("}") + 1])
        norm = (f"loudnorm=I=-18:TP=-1.5:LRA=7:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
                f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true,"
                "afade=t=in:d=0.012,areverse,afade=t=in:d=0.05,areverse")
        ff("-i", str(pre), "-af", norm, "-ar", "24000", "-ac", "1", "-c:a", "libmp3lame", "-q:a", "2", str(OUT / f"{key}.mp3"))
        print("recorded", key)

    durations = {}
    for key, *_ in LINES:
        d = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                                     str(OUT / f"{key}.mp3")]).decode()
        durations[key] = round(float(d), 3)
    (OUT / "durations.json").write_text(json.dumps(durations, indent=2) + "\n")
    print(json.dumps(durations, indent=2))


if __name__ == "__main__":
    main()
