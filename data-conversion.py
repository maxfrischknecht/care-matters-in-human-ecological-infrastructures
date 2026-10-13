"""Convert the care-infrastructures data folders into a single table.

Expected layout under DATA_DIR::

    <Day1_SessionTitle_DataSetTitle>/   one folder per data item
        meta.txt                  dataset metadata (applies to every file)
        <file>.jpg                a data file
        <file>.txt                that file's metadata (same stem)
        <document>.txt            a data file that is itself a text document

The folder name is split on the first two ``_`` characters into ``day``,
``session`` and ``dataset_title`` (spaces within each part are kept).

Every data file becomes one row:

* dataset metadata (from ``meta.txt``) is used as-is,
* file metadata (from ``<file>.txt``) is prefixed with ``file_`` so keys
  never collide with the dataset keys,
* ``file_path`` is relative to DATA_DIR, e.g. ``parent-folder/file.jpg``.

Files without metadata keep null (NaN) metadata columns. Any metadata key
found anywhere becomes a column; keys that are not in ENCOURAGED_FIELDS are
logged as freely-chosen types. Parsing problems are collected as warnings
instead of raising, so a single bad file cannot abort the run.

Run with::

    python data-conversion.py

Output is written to ``export/metadata.csv`` and ``export/metadata.json``.
"""

from __future__ import annotations

import re
from pathlib import Path

import pandas as pd

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
OUTPUT_DIR = BASE_DIR / "export"
WRITE_OUTPUT = True

# Prefix applied to per-file (companion .txt) metadata keys.
FILE_PREFIX = "file_"

# Fields that are "encouraged". Anything else that shows up is reported as a
# freely-chosen metadata type.
ENCOURAGED_FIELDS = {"title", "authors", "tags", "timestamp", "description"}

# Columns treated as comma-separated lists. Names are WITHOUT the file_ prefix,
# so "authors" covers both the dataset `authors` and the file `file_authors`.
LIST_FIELDS = {"authors", "tags", "sensor"}

# List fields whose values may also be space-separated / `#`-prefixed tags.
TAG_FIELDS = {"tags"}

# Row-identity columns (always present, never list-parsed or prefixed).
IDENTITY_COLS = [
    "file",
    "file_path",
    "folder",
    "day",
    "session",
    "dataset_title",
    "file_type",
]

# Metadata files ignored on the assumption they belong to another file.
RESERVED_NAMES = {"meta.txt"}

# --------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------
KEY_VALUE_RE = re.compile(r"^(?P<key>[\w.\-]+)\s*:\s*(?P<value>.*)$")


def parse_metadata(path: Path) -> tuple[dict[str, str | None], list[str]]:
    """Parse one metadata file into a raw ``{key: string}`` mapping.

    Returns ``(metadata, warnings)``. I/O and format problems are reported as
    warnings rather than raised.
    """
    path = Path(path)
    meta: dict[str, str | None] = {}
    warnings: list[str] = []

    if not path.exists():
        return meta, [f"missing metadata file: {path}"]

    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        text = path.read_text(encoding="utf-8", errors="replace")
        warnings.append(f"{path}: non-UTF-8 bytes (decoded with replacement)")
    except OSError as exc:
        return meta, [f"{path}: could not read ({exc})"]

    for lineno, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue  # blank line or comment

        match = KEY_VALUE_RE.match(line)
        if not match:
            warnings.append(f"{path}:{lineno}: cannot parse {raw!r}")
            continue

        key = match.group("key").strip().lower()
        value = match.group("value").strip().strip("'\"")
        meta[key] = value or None

    return meta, warnings


def base_field(key: str) -> str:
    """Field name without the ``file_`` prefix."""
    return key[len(FILE_PREFIX):] if key.startswith(FILE_PREFIX) else key


def split_list(value: str, is_tags: bool) -> list[str]:
    """Split a raw string into list items.

    Tag fields are additionally split on whitespace and stripped of leading
    ``#`` characters.
    """
    raw = re.split(r"[,\s]+", value) if is_tags else value.split(",")
    items: list[str] = []
    for part in raw:
        part = part.strip().strip("'\"").lstrip("#").strip()
        if part:
            items.append(part)
    return items


def parse_folder_name(name: str) -> tuple[int | str | None, str | None, str | None, list[str]]:
    """Split ``Day[n]_SessionTitle_DataSetTitle`` into its three parts.

    Only the first two ``_`` are used as delimiters, so spaces (and any
    further ``_``) are preserved inside the parts. Returns
    ``(day, session, dataset_title, warnings)``.
    """
    warnings: list[str] = []
    parts = name.split("_", 2)
    if len(parts) != 3:
        warnings.append(
            f"{name}: folder name does not match Day[n]_SessionTitle_DataSetTitle"
        )
        return None, None, None, warnings

    day_raw, session, dataset_title = (p.strip() for p in parts)

    match = re.search(r"\d+", day_raw)
    if match:
        day: int | str = int(match.group())
    else:
        day = day_raw
        warnings.append(f"{name}: no day number found in {day_raw!r}")

    return day, session or None, dataset_title or None, warnings


# --------------------------------------------------------------------------
# Directory walking
# --------------------------------------------------------------------------
def _is_metadata_txt(file: Path, by_stem: dict[str, list[Path]]) -> bool:
    """True if a ``.txt`` file is the metadata companion of a data file.

    A ``.txt`` is metadata only when a sibling with the same stem exists that
    has a different (non-``.txt``) extension. Otherwise it is itself data
    (e.g. a text document).
    """
    if file.suffix.lower() != ".txt":
        return False
    return any(other.suffix.lower() != ".txt" for other in by_stem.get(file.stem, []))


def collect_rows(root: Path) -> tuple[list[dict], list[str]]:
    """Build one raw row per data file under ``root`` (never skips a file)."""
    root = Path(root)
    if not root.is_dir():
        raise FileNotFoundError(f"data directory not found: {root}")

    rows: list[dict] = []
    warnings: list[str] = []

    folders = [root] + sorted(p for p in root.rglob("*") if p.is_dir())

    for folder in folders:
        files = [
            f for f in folder.iterdir()
            if f.is_file() and not f.name.startswith(".")
        ]
        if not files:
            continue

        by_stem: dict[str, list[Path]] = {}
        for f in files:
            by_stem.setdefault(f.stem, []).append(f)

        # --- dataset metadata (folder meta.txt), keys kept as-is ---
        dataset_meta: dict[str, str | None] = {}
        meta_txt = folder / "meta.txt"
        if meta_txt.exists():
            dataset_meta, w = parse_metadata(meta_txt)
            warnings += w

        # --- folder name -> day / session / dataset_title ---
        day, session, dataset_title, w = parse_folder_name(folder.name)
        warnings += w

        for file in sorted(files):
            if file.name in RESERVED_NAMES or _is_metadata_txt(file, by_stem):
                continue  # not a data file

            try:
                # --- file metadata (companion .txt), keys prefixed ---
                companion = folder / (file.stem + ".txt")
                if companion.exists() and companion != file:
                    file_meta, w = parse_metadata(companion)
                    warnings += w
                else:
                    file_meta = {}
                    if file.suffix.lower() != ".txt":
                        warnings.append(
                            f"{file.relative_to(root)}: no companion "
                            f"{companion.name} (file metadata null)"
                        )

                row = {
                    "file": file.name,
                    "file_path": file.relative_to(root).as_posix(),
                    "folder": folder.name,
                    "day": day,
                    "session": session,
                    "dataset_title": dataset_title,
                    "file_type": file.suffix.lower().lstrip("."),
                }
                row.update(dataset_meta)
                row.update({FILE_PREFIX + k: v for k, v in file_meta.items()})
                rows.append(row)
            except Exception as exc:  # one bad file cannot kill the run
                warnings.append(f"{file}: unexpected error ({exc})")

    return rows, warnings


# --------------------------------------------------------------------------
# DataFrame assembly
# --------------------------------------------------------------------------
def build_dataframe(raw_rows: list[dict]) -> tuple[pd.DataFrame, list[str]]:
    """Convert raw rows into a DataFrame with list columns expanded."""
    rows: list[dict] = []
    for raw in raw_rows:
        row: dict = {}
        for key, value in raw.items():
            if key in IDENTITY_COLS or value is None:
                row[key] = value
            elif base_field(key) in LIST_FIELDS:
                row[key] = split_list(value, base_field(key) in TAG_FIELDS)
            else:
                row[key] = value
        rows.append(row)

    df = pd.DataFrame(rows)
    meta_fields = sorted(set(df.columns) - set(IDENTITY_COLS))

    enc_order = ["title", "authors", "tags", "timestamp", "description", "sensor"]
    dataset_fields = [k for k in meta_fields if not k.startswith(FILE_PREFIX)]
    file_fields = [k for k in meta_fields if k.startswith(FILE_PREFIX)]

    def ordered(fields: list[str], prefix: str = "") -> list[str]:
        preferred = [prefix + f for f in enc_order if prefix + f in fields]
        return preferred + [f for f in fields if f not in preferred]

    columns = IDENTITY_COLS + ordered(dataset_fields) + ordered(file_fields, FILE_PREFIX)
    return df[columns], meta_fields


def report(df: pd.DataFrame, meta_fields: list[str], warnings: list[str]) -> None:
    list_cols = [k for k in meta_fields if base_field(k) in LIST_FIELDS]
    scalar_cols = [k for k in meta_fields if base_field(k) not in LIST_FIELDS]
    print(f"Rows: {len(df)}   Columns: {df.shape[1]}")
    print("List columns  :", ", ".join(list_cols) or "(none)")
    print("Scalar columns:", ", ".join(scalar_cols) or "(none)")

    print("\nFreely-chosen fields (not in ENCOURAGED_FIELDS):")
    free = [k for k in meta_fields if base_field(k) not in ENCOURAGED_FIELDS]
    for key in free:
        n_null = int(df[key].isna().sum())
        print(f"  {key}: {len(df) - n_null} present / {n_null} null")
    if not free:
        print("  (none)")

    print("\nNull count per metadata field:")
    for key in meta_fields:
        print(f"  {key:<20} {int(df[key].isna().sum())} / {len(df)} null")

    print("\nWarnings:")
    for warning in warnings or ["  (none)"]:
        print(" \u2022", warning)


def save(df: pd.DataFrame, list_cols: list[str]) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    df_out = df.copy()
    for col in list_cols:
        if col in df_out.columns:
            df_out[col] = df_out[col].apply(
                lambda v: "; ".join(v) if isinstance(v, list) else v
            )
    csv_path = OUTPUT_DIR / "metadata.csv"
    json_path = OUTPUT_DIR / "metadata.json"
    df_out.to_csv(csv_path, index=False)
    df.to_json(json_path, orient="records", indent=2, force_ascii=False)
    print(f"\nWrote {csv_path}")
    print(f"Wrote {json_path}")


def main() -> None:
    print("Starting data conversion...")
    raw_rows, warnings = collect_rows(DATA_DIR)
    df, meta_fields = build_dataframe(raw_rows)
    report(df, meta_fields, warnings)

    if WRITE_OUTPUT:
        list_cols = [k for k in meta_fields if base_field(k) in LIST_FIELDS]
        save(df, list_cols)

    print("\nPreview:")
    print(df.head().to_string())


if __name__ == "__main__":
    main()
