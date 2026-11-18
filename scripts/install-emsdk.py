#!/usr/bin/env python3
"""Fetch the checksum-locked SDK; prints its activation script path."""
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import urllib.request

root=Path(__file__).resolve().parent.parent
lock=json.loads((root/'build-support/ngspice/engine.lock.json').read_text())['emsdk']
directory=root/'build/toolchains'
directory.mkdir(parents=True,exist_ok=True)
archive=directory/'emsdk.tar.gz'
if not archive.exists(): urllib.request.urlretrieve(lock['url'],archive)
if hashlib.sha256(archive.read_bytes()).hexdigest()!=lock['sha256']: raise RuntimeError('emsdk archive checksum mismatch')
sdk=directory/f'emsdk-{lock["version"]}'
if not sdk.exists():
    with tarfile.open(archive) as tar: tar.extractall(directory,filter='data')
for action in ['install','activate']: subprocess.run(['bash',str(sdk/'emsdk'),action,lock['version']],cwd=sdk,check=True)
print(sdk/'emsdk_env.sh')
