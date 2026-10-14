
# Setup Guide for the Local Machine

## 1. Installing [Homebrew](https://brew.sh/)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```
Make sure to follow the instructions prompted in the terminal after installation.

## 2. Pyenv Setup

```bash
# pyenv instakk
brew install pyenv

# install pyenv dependencies:
brew install openssl readline sqlite3 xz tcl-tk@8 libb2 zstd zlib pkgconfig

# setup the shell:
echo 'export PYENV_ROOT="$HOME/.pyenv"' >> ~/.zshrc
echo '[[ -d $PYENV_ROOT/bin ]] && export PATH="$PYENV_ROOT/bin:$PATH"' >> ~/.zshrc
echo 'eval "$(pyenv init - zsh)"' >> ~/.zshrc

# reload the shell
source ~./zshrc
```

## 3. Python Setup

```bash
# install a python version
pyenv install 3.13.0

# set it globally
pyenv global 3.13.0

# verify, should output the path to your set python
which python

# install libraries
pip install pandas "altair[all]"
```

## 4. Code Setup

Install [VS Code](https://code.visualstudio.com/download?_exp_download=d53503e735)

```bash
cd Desktop/
mkdir care-infrastructures-data
mkdir care-infrastructures-data/data
mkdir care-infrastructures-data/export
touch ./care-infrastructures-data/data-conversion.ipynb
touch ./care-infrastructures-data/data-analysis.ipynb
```

## 5. Local LLM Support

Install [Ollama](https://ollama.com/download) for local models and [Open Code](https://opencode.ai/) as terminal app.  

```bash
#install ollama
curl -fsSL https://ollama.com/install.sh | sh

# install a model
ollama pull qwen3.5:9b

# install open code
curl -fsSL https://opencode.ai/v2/install | bash

```

The machine used in the autumn school is a Mac Mini with a M4 Chip an 28GB Ram, according to this [guide](https://insiderllm.com/guides/best-local-llms-mac-2026/), [Qwen 3.5](https://ollama.com/library/qwen3.5) was chosen. 

## 6. Transcription.py

```bash
pip install "av==18.1.0"
pip install faster-whisper
```