#!/usr/bin/env python3
"""Build the locked upstream release. Requires make, patch, C/C++, and tar.

Native Windows builds run inside MSYS2 UCRT64/CLANGARM64. WASM builds
require the exact emsdk in engine.lock.json; no system ngspice is used.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
LOCK = json.loads((ROOT / 'build-support/ngspice/engine.lock.json').read_text())
WORK = ROOT / 'build/ngspice'


def run(args, cwd=None):
    print('+', ' '.join(map(str, args)), flush=True)
    subprocess.run([arg.as_posix() if isinstance(arg,Path) else str(arg) for arg in args], cwd=cwd, check=True)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('backend', choices=['native','wasm'])
    parser.add_argument('--source-archive', type=Path)
    args = parser.parse_args()
    WORK.mkdir(parents=True,exist_ok=True)
    archive=args.source_archive or WORK / f'ngspice-{LOCK["version"]}.tar.gz'
    if not archive.exists():
        urllib.request.urlretrieve(LOCK['source']['url'],archive)
    if sha(archive) != LOCK['source']['sha256']:
        raise RuntimeError('ngspice source checksum does not match engine.lock.json')
    source=WORK / f'source-{args.backend}'
    build=WORK / f'build-{args.backend}'
    prefix=WORK / f'install-{args.backend}'
    for directory in [source,build,prefix]:
        if directory.exists(): shutil.rmtree(directory)
        directory.mkdir()
    with tarfile.open(archive) as tar:
        tar.extractall(source,filter='data')
    source=source / f'ngspice-{LOCK["version"]}'
    patch_records=[]
    for patch in sorted((ROOT/'build-support/ngspice/patches').glob('*.patch')):
        expected=LOCK['patches'].get(patch.name)
        if sha(patch) != expected: raise RuntimeError(f'Unreviewed patch: {patch.name}')
        run(['patch','--batch','--forward','-p1','-i',patch],source)
        patch_records.append({'path':patch.name,'sha256':expected})
    (build/'package.json').write_text('{"type":"commonjs"}')
    flags=LOCK['configure']+[f'--prefix={prefix.as_posix()}']
    if args.backend == 'wasm':
        version=subprocess.check_output(['emcc','--version'],text=True)
        if LOCK['emsdk']['version'] not in version: raise RuntimeError('Wrong emsdk version')
        run(['emconfigure',source/'configure',*flags,'--disable-shared','--enable-static','--disable-xspice','--disable-maintainer-mode'],build)
        run(['emmake','make','-j4','STATIC=','libngspice_la_CFLAGS=-O2','libngspice_la_LDFLAGS=','CFLAGS=-O2','CXXFLAGS=-O2'],build)
        output=ROOT/'public/engines/ngspice'
        output.mkdir(parents=True,exist_ok=True)
        run(['em++','-std=c++17','-O2','-I',source/'src/include',ROOT/'native/ngspice-host/host.cpp',build/'src/.libs/libngspice.a','--no-entry','-sMODULARIZE=1','-sEXPORT_ES6=1','-sENVIRONMENT=worker,node','-sALLOW_MEMORY_GROWTH=1',f'-sMAXIMUM_MEMORY={LOCK["wasm"]["maximumMemory"]}',"-sEXPORTED_FUNCTIONS=['_tc_run']","-sEXPORTED_RUNTIME_METHODS=['ccall','FS']",'-o',output/'ngspice.js'])
        system,arch='wasm','wasm32'
        helper=library=None;modules=[]
    else:
        run(['bash',source/'configure',*flags,'--enable-xspice'],build)
        if os.environ.get('MSYSTEM') == 'CLANGARM64':
            makefile=build/'src/Makefile'
            makefile.write_text(makefile.read_text().replace('-lstdc++','-lc++'))
        run(['make','-j4'],build)
        run(['make','install'],build)
        output=ROOT/'build/engines/native'
        if output.exists(): shutil.rmtree(output)
        output.mkdir(parents=True)
        system='win32' if os.name=='nt' or 'MSYS' in platform.system() or 'MINGW' in platform.system() else 'darwin' if platform.system()=='Darwin' else 'linux'
        arch='arm64' if platform.machine().lower() in ['aarch64','arm64'] else 'x64'
        helper='tinycad-ngspice-host'+('.exe' if system=='win32' else '')
        cxx=os.environ.get('CXX','c++')
        link=['-static','-static-libgcc','-static-libstdc++'] if system=='win32' else ['-ldl'] if system=='linux' else []
        run([cxx,'-std=c++17','-O2','-pthread','-I',source/'src/include',ROOT/'native/ngspice-host/host.cpp',*link,'-o',output/helper])
        suffix='.dll' if system=='win32' else '.dylib' if system=='darwin' else '.so'
        candidates=[p for p in prefix.rglob('*') if p.is_file() and 'ngspice' in p.name and p.name.endswith(suffix)]
        if not candidates: raise RuntimeError('No built shared ngspice library')
        library='ngspice'+suffix
        shutil.copy2(candidates[0],output/library)
        modules=[]
        for module in sorted(prefix.rglob('*.cm')):
            if module.name in modules: raise RuntimeError('Duplicate code model name')
            shutil.copy2(module,output/module.name);modules.append(module.name)
        if not modules: raise RuntimeError('Native profile requires bundled XSPICE code models')
        if system=='win32':
            # Recursively resolve MinGW runtime imports; OS DLLs come from Windows.
            pending=[output/library,*[output/name for name in modules]]
            while pending:
                current=pending.pop()
                imports=subprocess.check_output([shutil.which('objdump') or shutil.which('llvm-objdump') or 'objdump','-p',str(current)],text=True)
                for line in imports.splitlines():
                    if 'DLL Name:' not in line: continue
                    name=line.split('DLL Name:')[1].strip()
                    dependency=shutil.which(name)
                    if dependency and not str(Path(dependency).resolve()).lower().startswith(os.environ.get('SystemRoot','C:/Windows').lower()) and not (output/name).exists():
                        shutil.copy2(dependency,output/name);pending.append(output/name)
            licenses=Path(shutil.which(cxx)).resolve().parent.parent/'share/licenses'
            if licenses.exists(): shutil.copytree(licenses,output/'runtime-licenses',dirs_exist_ok=True)
        elif system=='darwin':
            run(['install_name_tool','-id',f'@loader_path/{library}',output/library])
            for binary in [output/library,*[output/name for name in modules]]:
                dependencies=subprocess.check_output(['otool','-L',str(binary)],text=True)
                for line in dependencies.splitlines()[1:]:
                    name=line.strip().split(' (')[0]
                    if 'libngspice' in name: run(['install_name_tool','-change',name,f'@loader_path/{library}',binary])
        # Linux ngspice and code models depend only on the platform runtime.
        # The helper opens the library and modules by absolute verified paths.
    # Include the original source archive and patch set for offline redistribution
    # and exact reconstruction, together with the upstream licensing inventory.
    shutil.copy2(archive,output/archive.name)
    shutil.copy2(source/'COPYING',output/'NGSPICE-LICENSE.txt')
    shutil.copy2(ROOT/'native/ngspice-host/host.cpp',output/'tinycad-ngspice-host.cpp')
    shutil.copy2(ROOT/'build-support/ngspice/engine.lock.json',output/'engine.lock.json')
    shutil.copy2(ROOT/'scripts/build-ngspice.py',output/'build-ngspice.py')
    shutil.copytree(ROOT/'build-support/ngspice/patches',output/'patches',dirs_exist_ok=True)
    files=[{'path':p.name,'size':p.stat().st_size,'sha256':sha(p)} for p in sorted(output.iterdir()) if p.is_file() and p.name!='manifest.json']
    compiler=subprocess.check_output(['emcc' if args.backend=='wasm' else os.environ.get('CC','cc'),'--version'],text=True).splitlines()[0]
    identity=hashlib.sha256((json.dumps(LOCK,sort_keys=True)+sha(ROOT/'native/ngspice-host/host.cpp')+sha(ROOT/'scripts/build-ngspice.py')+compiler+args.backend+system+arch).encode()).hexdigest()[:16]
    manifest={'protocol':1,'buildId':f'ngspice-{LOCK["version"]}-{identity}','version':LOCK['version'],'compiler':compiler,'configure':flags,'platform':system,'arch':arch,'helper':helper,'library':library,'modules':modules,'source':LOCK['source'],'patches':patch_records,'capabilities':{'pause':False,'live':False,'xspice':args.backend=='native'},'files':files}
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    if args.backend == 'native': shutil.copytree(output,ROOT/f'build/engines/native-{arch}',dirs_exist_ok=True)
    print('Built',output)


if __name__=='__main__': main()
