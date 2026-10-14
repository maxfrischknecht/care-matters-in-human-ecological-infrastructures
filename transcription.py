"""
1. get_data_folders(data_dir) — reuse the exact iteration pattern from data-preparation.py:78 (sorted, skip hidden dirs), so both scripts stay consistent.
2. find_audio_files(folder) — return visible files whose suffix is in AUDIO_EXTENSIONS, sorted.
3. load_model() — instantiate WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE) once and reuse across files (avoids reload cost).
4. transcribe_file(model, audio_path) — call model.transcribe(str(audio_path), language=LANGUAGE), join segment.text over segments, return the string.
5. output_path_for(audio_path) — audio_path.with_name(audio_path.stem + "-transcription.txt").
6. main() — loop folders → loop audio files → skip if output exists and not OVERWRITE → transcribe → write UTF-8 → print progress.
"""
from pathlib import Path
from faster_whisper import WhisperModel

DATA_DIR = "./data-example/"
AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".aiff", ".aif"}
TRANSCRIPTION_SUFFIX = "-transcription"
MODEL_SIZE = "small"        # tiny|base|small|medium|large-v3
DEVICE = "cpu"              # no CUDA on the M4
COMPUTE_TYPE = "int8"       # fastest on CPU
LANGUAGE = None             # None = auto-detect; "de"/"en" to pin
WRITE_OUTPUT = True
OVERWRITE = True           # skip existing transcriptions when False

# --------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------

# A function that iterates over every folder inside /data
def get_data_folders(data_dir):
    """
    Yield every data folder inside ``data_dir`` as a ``Path``.
    Hidden folders and files are skipped; results are sorted by name.
    """
    root = Path(data_dir)
    # print(root)
    # check if the data dictionary is there
    if not root.is_dir():
        print(f"data directory not found: {root}")
        return

    # iterate over all folders
    folders = []
    for entry in sorted(root.iterdir()):
        if entry.is_dir() and not entry.name.startswith("."):
            folders.append(entry)

    return folders

# get all audio files in one folder
def find_audio_files(folder):
    """
    Return the audio files inside ``folder`` as a sorted list of ``Path``.

    A file counts as audio when its (case-insensitive) suffix is in
    AUDIO_EXTENSIONS. Hidden files are skipped. Returns an empty list if the
    folder contains no audio.
    """
    audios = []
    for entry in sorted(folder.iterdir()):
        if entry.is_file() and not entry.name.startswith("."):
            if entry.suffix.lower() in AUDIO_EXTENSIONS:
                audios.append(entry)

    return audios

# load the open wispers model
def load_model():
    """
    Load the faster-whisper model once and return it.

    Model, device and compute type come from the config block. On the first
    run the weights are downloaded to the local HF cache; afterwards it runs
    fully offline.
    """
    print(f"Loading whisper model '{MODEL_SIZE}' ({DEVICE}/{COMPUTE_TYPE}) ...")
    model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)

    return model

# transcribe the audio files
def transcribe_file(model, audio_path):
    """
    Transcribe a single audio file and return the text.

    ``audio_path`` is one ``Path`` from the audios list. ``segments`` is a
    generator, so joining it forces the actual transcription to run.
    """
    print(f"Transcribing {audio_path.name} ...")

    segments, info = model.transcribe(str(audio_path), language=LANGUAGE)
    text = " ".join(segment.text.strip() for segment in segments)

    print(f"  language={info.language} duration={info.duration:.1f}s")
    return text.strip()

# export the audio files
def write_transcription(audio_path, text):
    """
    Write ``text`` next to the audio file as ``<audio-name>-transcription.txt``.

    ``audio_path`` is used to build the output name; the text is written as
    UTF-8. Returns the output ``Path``, or ``None`` when WRITE_OUTPUT is off.
    """
    if not WRITE_OUTPUT:
        return None

    output_path = audio_path.with_name(audio_path.stem + TRANSCRIPTION_SUFFIX + ".txt")
    output_path.write_text(text, encoding="utf-8")

    print(f"  wrote {output_path.name}")
    return output_path

def main():
    
    try:
        model = load_model()
    except Exception as exc:
        print(f"Could not load model: {exc}")
        print("Install the dependency with: pip install faster-whisper")
        return
    
    folders = get_data_folders(DATA_DIR)
    # print(folders)
    
    # find all audios
    audios = []
    for folder in folders:
        for audio in find_audio_files(folder):
            audios.append(audio)

    # transcribe the audios
    for audio in audios:
        text = transcribe_file(model, audio)
        print(text)
        write_transcription(audio, text)
        

    print(audios)

if __name__ == "__main__":
    main()