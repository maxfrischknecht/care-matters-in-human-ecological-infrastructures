import re, os
from pathlib import Path
import pandas as pd

# --------------------------------------------------------------------------
# SETUP
# --------------------------------------------------------------------------
DATA_DIR = "./data/"
OUTPUT_DIR = "./export"
EXPORT_FILENAME = "manifesta-dataset.csv"

# toggle if output is generated
WRITE_OUTPUT = True

LIST_FIELDS = {"authors", "tags"}

# Row-identity columns (always present, never list-parsed or prefixed).
IDENTITY_COLS = [
    "manifesta",
    "folder"
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
    # print("folder to get meta:", path, "\n")
    
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
        print(f"no meta.txt found in {path}", "\n")
        return {}
    
    # go through every line in meta.txt and create key:value pairs
    with open(meta_path, "r") as meta_file:
        for line in meta_file:
            line = line.strip()
            if not line:
                continue
            match = KEY_VALUE_RE.match(line)
            if match:
                key = match.group("key").casefold()
                if key in LIST_FIELDS:
                    # create a list out of the string
                    list_values = match.group("value").split(",")
                    # remove # hashtags
                    list_values = [v.lstrip("#") for v in list_values if v.lstrip("#")]
                    # add to meta
                    meta[key] = list_values
                else:
                    value = match.group("value").strip().strip('"')
                    meta[key] = value
    return meta


# get all files in the folder to connext to meta.txt
def get_folder_files(folder_path):
    path = Path(folder_path)
    all_files = []
    
    for filename in os.listdir(folder_path):
        # Check if it's a file (not including directories)
        if os.path.isfile(os.path.join(folder_path, filename)):
            all_files.append(filename)
            
    return all_files

    
# find .txt files except meta.txt and -transcript.txt that contain manifesta info
def find_additional_manifesta(folder_path):
    path = Path(folder_path)
    
    # search for all !meta.txt that are also no transcripts
    for file in path.glob('*.txt'):
        if file.name != 'meta.txt' and 'transcript' not in file.stem:
            # print(file.name)
    
            # open the file and check if there is a manifesta in it
            with open(file, "r") as txt_file:
                for line in txt_file:
                    line = line.strip()
                    if not line:
                        continue
                    match = KEY_VALUE_RE.match(line)
                    if match:
                        key = match.group("key")
                        # check if manifesta appears
                        if key == "manifesta" or key == "Manifesta":
                            # print("found additional manifesta in: ", file.name)
                            return file.name     
        # else:
        #     return None
    
    
# get the meta of txt files with additional manifesta
def get_additional_meta(folder_path, file_name):
    path = Path(folder_path)
    file_path = path / file_name
    
    # build identity fields from the folder name:
    # <Day>_<Session>_<DatasetTitle>, split on the first two "_" (spaces kept)
    name_parts = path.name.split("_", 2)
    meta = {
        "folder": path.name,
        "day": name_parts[0] if len(name_parts) > 0 else "",
        "session": name_parts[1] if len(name_parts) > 1 else "",
        "dataset_title": name_parts[2] if len(name_parts) > 2 else "",
    }
    
    with open(file_path, "r") as txt_file:
        for line in txt_file:
            line = line.strip()
            if not line:
                continue
            match = KEY_VALUE_RE.match(line)
            if match:
                key = match.group("key").casefold()
                if key in LIST_FIELDS:
                    # create a list out of the string
                    list_values = match.group("value").split(",")
                    # remove # hashtags
                    list_values = [v.lstrip("#") for v in list_values if v.lstrip("#")]
                    # add to meta
                    meta[key] = list_values
                else:
                    value = match.group("value").strip().strip('"')
                    meta[key] = value
    return meta

# find the sibling file of the same name
def get_manifesta_siblings(folder_path, file_key):    
    path = Path(folder_path)
    # Extract the base name without the .txt extension
    base_name = Path(file_key).stem
    
    sibling_files = []
    
    for file in path.iterdir():
        if file.is_file() and file.stem == base_name and file.suffix != ".txt":
            sibling_files.append(str(file.name))
    
    #print(sibling_files)
    return sibling_files

def print_some_care():
    print("""
 ,-----.                       
'  .--./ ,--,--.,--.--. ,---.  
|  |    ' ,-.  ||  .--'| .-. : 
'  '--'\\ '-'  ||  |   \   --. 
 `-----' `--`--'`--'    `----'     
           
,--.   ,--.          ,--.    ,--.                        
|   `.'   | ,--,--.,-'  '-.,-'  '-. ,---. ,--.--. ,---.  
|  |'.'|  |' ,-.  |'-.  .-''-.  .-'| .-. :|  .--'(  .-'  
|  |   |  |\ '-'  |  |  |    |  |  \   --.|  |   .-'  `) 
`--'   `--' `--`--'  `--'    `--'   `----'`--'   `----'       
    """)

# --------------------------------------------------------------------------
# M * A * I * N 
# --------------------------------------------------------------------------

def main():
    folders = get_data_folders(DATA_DIR)
    # print(folders)
    
    all_rows = []
    
    # iterate over every folder and collect the metadata
    for folder in folders:
        
        # get the meta.txt from each folder
        folder_meta = get_folder_meta(folder)
        
        # folder files list
        folder_files = get_folder_files(folder)
        # print(folder_files)
        
        # add the files to the folder_meta dictionary
        if folder_meta:
            folder_meta["files"] = folder_files
            all_rows.append(folder_meta)
            print("Found META.TXT Manifesta: \n__\n")
            print(folder_meta, "\n")
    
        # find additional files with manifesta content and the same-named file
        additional_manifesta_file = find_additional_manifesta(folder)
        
        # get the additional manifesta meta data
        if additional_manifesta_file:
            print("Found Additional Manifesta: \n__\n")
            additional_manifesta_meta = get_additional_meta(folder, additional_manifesta_file)
            print(additional_manifesta_meta, "\n")
            
            manifesta_sibling_files = get_manifesta_siblings(folder, additional_manifesta_file)
            print("Of the following files: \n__\n")
            print(manifesta_sibling_files, "\n")
            
            # add the files to the manifesta meta dictionary
            additional_manifesta_meta["files"] = manifesta_sibling_files
            all_rows.append(additional_manifesta_meta)
            
        print("_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-\n")
            
    df = pd.DataFrame(all_rows).fillna("")
    
    # stable, readable column order
    leading = [c for c in IDENTITY_COLS if c in df.columns]
    rest = [c for c in df.columns if c not in leading]
    df = df[leading + rest]
        
    print("Dataframe Ready 🌱", "\n")
    print(df.head())
    
    # export
    if WRITE_OUTPUT:
        export_dir = Path(OUTPUT_DIR)
        df.to_csv(export_dir / EXPORT_FILENAME)
        df.to_json(export_dir / "manifesta-dataset.json")
        print("Exporting ... Done \n")
        print("_-🌱_-🌱_-🌱_-🌱_-🌱_-🌱_-🌱_-🌱_-🌱_-🌱_-🌱_-🌱_-🌱_-🌱_-")

    print_some_care()
    print("_-🌱_-🌱_-🌱_-🌱_-🌱_-🌱_-🌱_-🌱_-🌱_-🌱_-🌱_-🌱_-🌱_-🌱_-")
            
if __name__ == "__main__":
    main()