"""Artifact rendering adapter with a stable font environment receipt.

The existing text probe stays byte-for-byte pinned to its compatibility reports.
This adapter binds both producer files and never interprets paragraphs as lines.
"""
import hashlib
import importlib.util
import json
import os
import pathlib
import signal
import subprocess
import sys


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def font_inventory():
    """Record file contents, including fallback fonts and active fontconfig rules.

    This identifies a Linux target, not the fonts actually used by each glyph.
    Repeat after rendering so a changed font environment cannot issue a receipt.
    """
    paths = sorted(set(subprocess.check_output(
        ['fc-list', '-f', '%{file}\n'], text=True, timeout=15).splitlines()))
    configuration_list = subprocess.check_output(['fc-conflist'], text=True, timeout=15)
    configurations = {line[2:].split(': ', 1)[0] for line in configuration_list.splitlines() if line.startswith('+ ')}
    primary = pathlib.Path(os.environ.get('FONTCONFIG_FILE', '/etc/fonts/fonts.conf'))
    if not primary.is_absolute():
        raise RuntimeError('Font inventory requires an absolute FONTCONFIG_FILE')
    configurations.add(str(primary))
    return {
        'version': 1,
        'fontconfigVersion': subprocess.check_output(['fc-list', '-V'], stderr=subprocess.STDOUT, text=True, timeout=15).strip(),
        'variables': {key: os.environ.get(key) for key in ('FONTCONFIG_FILE', 'FONTCONFIG_PATH', 'FC_LANG')},
        'files': [{'path': path, 'sha256': digest(pathlib.Path(path))} for path in paths],
        'configurations': [{'path': path, 'sha256': digest(pathlib.Path(path))} for path in sorted(configurations)],
    }


def render(manifest):
    directory = pathlib.Path(manifest['directory']).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    result_path = directory / 'observations.json'
    result_path.unlink(missing_ok=True)
    producer = pathlib.Path(__file__)
    helper = producer.with_name('libreoffice-text-probe.py')
    script_hash = digest(producer)
    dependency_hash = digest(helper)
    fonts = font_inventory()
    spec = importlib.util.spec_from_file_location('fastppt_text_probe', helper)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    result = module.probe(manifest)
    if font_inventory() != fonts:
        raise RuntimeError('Font environment changed while LibreOffice was rendering')
    if script_hash != digest(producer) or dependency_hash != digest(helper):
        raise RuntimeError('Renderer implementation changed during rendering')
    font_path = directory / 'font-inventory.json'
    font_path.write_text(json.dumps(fonts, ensure_ascii=False, sort_keys=True, indent=2) + '\n')
    result['fontInventorySha256'] = digest(font_path)
    result['rendererScriptSha256'] = script_hash
    result['rendererDependenciesSha256'] = [dependency_hash]
    result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    def terminate(_signal, _frame):
        raise SystemExit('Render probe terminated')
    signal.signal(signal.SIGTERM, terminate)
    if sys.argv[1] == '--check-fonts':
        if font_inventory() != json.loads(pathlib.Path(sys.argv[2]).read_text()):
            raise RuntimeError('Font environment changed before rasterization completed')
    else:
        render(json.loads(pathlib.Path(sys.argv[1]).read_text()))
