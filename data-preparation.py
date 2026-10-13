"""
Convert the care-infrastructures data folders into a single table.

Expected layout of the data folders:

    <Day1_SessionTitle_DataSetTitle>/       one folder per data item
        meta.txt                            dataset metadata (applies to every file)
        <file>.jpg                          a data file
        <file>.txt                          that file's metadata (same name)
        <document>.txt                      a data file that is itself a text document

The folder name is split on the first two ``_`` characters into ``day``,
``session`` and ``dataset_title`` (spaces within each part are kept).

Every data file becomes one row:

* dataset metadata (from ``meta.txt``) is used as-is and applies to every file in the dataset
* file metadata (from ``<file>.txt``) is prefixed with ``file_`` so keys never collide with the dataset keys
* ``file_path`` is relative to DATA_DIR, e.g. ``parent-folder/file.jpg``.

Files without metadata keep null (NaN) metadata columns. Any metadata key
found anywhere becomes a column; keys that are not in ENCOURAGED_FIELDS are
logged as freely-chosen types. Parsing problems are collected as warnings
instead of raising, so a single bad file cannot abort the run.

Run with:

    python data-conversion.py

Output is written to ``export/metadata.csv`` and ``export/metadata.json``.
"""

from __future__ import annotations
import re
from pathlib import Path
import pandas as pd

# --------------------------------------------------------------------------
# SETUP
# --------------------------------------------------------------------------
DATA_DIR = "./data-example/"
OUTPUT_DIR = "./export"
EXPORT_FILENAME = "dataset.csv"

# toggle if output is generated
WRITE_OUTPUT = True

# Prefix applied to per-file metadata keys.
FILE_PREFIX = "file_"

# Fields that are "encouraged". Anything else that shows up is reported as a
# freely-chosen metadata type.
ENCOURAGED_FIELDS = {"title", "authors", "tags", "timestamp", "description"}

# Columns treated as comma-separated lists. Names are WITHOUT the file_ prefix,
# so "authors" covers both the dataset `authors` and the file `file_authors`.
# Update this if new meta data appears that should become a list
LIST_FIELDS = {"authors", "tags", "sensor"}

# Row-identity columns (always present, never list-parsed or prefixed).
IDENTITY_COLS = [
    "file_name",
    "file_path",
    "file_type",
    "folder",
    "day",
    "session",
    "dataset_title",
]

# Files that are for metadata of and are not treated as regular data files
RESERVED_NAMES = {"meta.txt"}

warnings = []

# --------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------
KEY_VALUE_RE = re.compile(r"^(?P<key>[\w.\-]+)\s*:\s*(?P<value>.*)$")

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

# A function to open a folder, look up the meta.txt and all files
def get_folder_meta(folder_path):
    path = Path(folder_path)
    print("folder to get meta:", path, "\n")
    
    # build identity fields from the folder name:
    # <Day>_<Session>_<DatasetTitle>, split on the first two "_" (spaces kept)
    name_parts = path.name.split("_", 2)
    meta = {
        "folder": path.name,
        "day": name_parts[0] if len(name_parts) > 0 else "",
        "session": name_parts[1] if len(name_parts) > 1 else "",
        "dataset_title": name_parts[2] if len(name_parts) > 2 else "",
    }

    
    # try to to get the metadata file
    meta_path = path / "meta.txt"
    if not meta_path.exists():
        print(f"no meta.txt found in {path}")
        return {}
    
    # go through every line in meta.txt and create key:value pairs
    with open(meta_path, "r") as meta_file:
        for line in meta_file:
            line = line.strip()
            if not line:
                continue
            match = KEY_VALUE_RE.match(line)
            if match:
                key = match.group("key")
                if key in LIST_FIELDS:
                    # create a list out of the string
                    list_values = match.group("value").replace(",", " ").split()
                    # remove # hashtags
                    list_values = [v.lstrip("#") for v in list_values if v.lstrip("#")]
                    # add to meta
                    meta[key] = list_values
                else:
                    value = match.group("value").strip().strip('"')
                    meta[key] = value

    # print(meta)
    return meta

# Get files and file meta
def get_files_meta(folder_path):
    root = Path(folder_path)
    
    # get every file in the folder (skip hidden files and reserved meta.txt)
    all_files = [
        f for f in sorted(root.iterdir())
        if f.is_file() and not f.name.startswith(".") and f.name not in RESERVED_NAMES
    ]

    # get all file names
    data_filenames = set()
    for f in all_files:
        if f.suffix.lower() != ".txt":
            data_filenames.add(f.stem)
    
     # split into data files and (sidecar) metadata files
    data_files = []
    meta_files = []
    for f in all_files:
        if f.suffix.lower() == ".txt" and f.stem in data_filenames:
            meta_files.append(f)   # a .txt whose stem matches a non-.txt sibling
        else:
            data_files.append(f)   # real data: media files + standalone .txt documents
            
    # pair each data file with its same-name .txt metadata file
    files_meta = []
    for data_file in data_files:
        
        # add filename and filepath
        entry = {
            "file_name": data_file.name,
            "file_path": str(data_file),
            "file_type": data_file.suffix.lower().lstrip("."),
        }

        # find the matching meta file and create a dictionary to add to entry
        meta_path = data_file.with_suffix(".txt")
        if meta_path in meta_files:
            with open(meta_path, "r") as meta_file:
                for line in meta_file:
                    line = line.strip()
                    if not line:
                        continue
                    match = KEY_VALUE_RE.match(line)
                    if match:
                        key = match.group("key")
                        list_values = []
                        # check if should become a list: 
                        if key in LIST_FIELDS:
                            # create a list out of the string
                            list_values = match.group("value").replace(",", " ").split()
                            # remove # hashtags
                            list_values = [v.lstrip("#") for v in list_values if v.lstrip("#")]
                            # add to entry
                            entry[FILE_PREFIX + key] = list_values
                        else:
                            entry[FILE_PREFIX + match.group("key")] = (
                                match.group("value").strip().strip('"')
                            )
        # append the found meta
        files_meta.append(entry)
        
    
    return files_meta

# merge folder and files meta
def merge_folder_file_meta(file_meta, folder_meta):
    # create a new merged dictionary with a copy of folder_meta
    merged = folder_meta.copy()
    # add the file meta
    merged.update(file_meta)
    
    return merged
        

def main():
    folders = get_data_folders(DATA_DIR)
    # print(folders)
    
    # all rows for all files in all folders
    all_rows = []
    
    # iterate over every folder and collect the metadata
    for folder in folders:
        
        # get the meta.txt from each folder
        folder_meta = get_folder_meta(folder)
        print("Folder Meta: \n__________________________________ \n")
        print(folder_meta, "\n")
        
        # iterate over all files and their metadata inside a folder
        folder_files_meta = get_files_meta(folder)
        print("Files Meta: \n__________________________________ \n")
        print(folder_files_meta, "\n")
        
        
        # iterate over each folder file meta and combine it with the folder meta
        for file_meta in folder_files_meta:
            merged_row = merge_folder_file_meta(file_meta, folder_meta)
            # add to list with all rows from all files in all folders
            all_rows.append(merged_row)
            print("Merged Meta: \n__________________________________ \n")
            print(merged_row, "\n")
            
    # create dataframe         
    # one row per file; pandas unions all keys -> missing keys become NaN
    df = pd.DataFrame(all_rows).fillna("")
    
    # stable, readable column order
    leading = [c for c in IDENTITY_COLS if c in df.columns]
    rest = [c for c in df.columns if c not in leading]
    df = df[leading + rest]

    print("Finished DF: \n__________________________________ \n")
    print(df, "\n")

    # export
    if WRITE_OUTPUT:
        export_dir = Path(OUTPUT_DIR)
        df.to_csv(export_dir / EXPORT_FILENAME)
        print("Exporting ... \n__________________________________ Done 🎈 \n")

        

if __name__ == "__main__":
    main()
