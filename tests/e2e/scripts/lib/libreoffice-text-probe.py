"""Render PPTX files in a fresh, verified LibreOffice locale using system Python/UNO.

Only this process's private profile and pipe are used. Input documents are opened
read-only; paragraph properties are observed and never rewritten before export.
"""
import hashlib
import json
import pathlib
import platform
import os
import signal
import subprocess
import sys
import tempfile
import time
import uuid
import xml.etree.ElementTree as ET

import uno
from com.sun.star.beans import PropertyValue


def prop(name, value):
    result = PropertyValue()
    result.Name, result.Value = name, value
    return result


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def config(provider, path):
    return provider.createInstanceWithArguments(
        'com.sun.star.configuration.ConfigurationAccess', (prop('nodepath', path),))


def probe(manifest):
    directory = pathlib.Path(manifest['directory']).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    requested = manifest['locale']
    # Escape via an XML builder, even though the reproducible runner has fixed locales.
    registry = ET.Element('oor:items', {'xmlns:oor': 'http://openoffice.org/2001/registry'})
    item = ET.SubElement(registry, 'item', {'oor:path': '/org.openoffice.Setup/L10N'})
    for key, value in [('ooLocale', 'en-US'), ('ooSetupSystemLocale', requested), ('DecimalSeparatorAsLocale', 'true')]:
        setting = ET.SubElement(item, 'prop', {'oor:name': key, 'oor:op': 'fuse'})
        ET.SubElement(setting, 'value').text = value
    configuration = ET.tostring(registry, encoding='utf-8', xml_declaration=True)
    (directory / 'initial-configuration.xcu').write_bytes(configuration)
    pipe = 'fastppt_' + uuid.uuid4().hex
    command_version = subprocess.check_output(['libreoffice', '--version'], text=True, timeout=15).strip()
    with tempfile.TemporaryDirectory(prefix='profile-', dir=directory) as profile_path:
        profile = pathlib.Path(profile_path)
        (profile / 'user').mkdir()
        (profile / 'user' / 'registrymodifications.xcu').write_bytes(configuration)
        with (directory / 'libreoffice.log').open('w') as log:
            process = subprocess.Popen([
                'libreoffice', '-env:UserInstallation=' + profile.as_uri(), '--headless',
                '--norestore', '--nodefault', '--nofirststartwizard',
                '--accept=pipe,name=' + pipe + ';urp;StarOffice.ComponentContext',
            ], stdout=log, stderr=log, start_new_session=True)
            desktop = None
            try:
                local = uno.getComponentContext()
                resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
                context, deadline = None, time.monotonic() + 20
                while context is None and time.monotonic() < deadline:
                    if process.poll() is not None:
                        raise RuntimeError('Isolated LibreOffice exited before accepting UNO')
                    try:
                        context = resolver.resolve('uno:pipe,name=' + pipe + ';urp;StarOffice.ComponentContext')
                    except Exception:
                        time.sleep(0.1)
                if context is None:
                    raise RuntimeError('Isolated LibreOffice did not accept UNO within 20 seconds')
                manager = context.ServiceManager
                provider = manager.createInstanceWithContext('com.sun.star.configuration.ConfigurationProvider', context)
                settings = config(provider, '/org.openoffice.Setup/L10N')
                product = config(provider, '/org.openoffice.Setup/Product')
                observed = settings.getPropertyValue('ooSetupSystemLocale')
                if observed != requested:
                    raise RuntimeError('LibreOffice did not apply the requested system locale')
                locale = uno.createUnoStruct('com.sun.star.lang.Locale')
                locale.Language, locale.Country = observed.split('-')
                locale_data = manager.createInstanceWithContext('com.sun.star.i18n.LocaleData', context)
                environment = {
                    'application': {'name': product.getPropertyValue('ooName'), 'version': product.getPropertyValue('ooSetupVersionAboutBox'), 'commandVersion': command_version},
                    'platform': {'system': platform.system(), 'release': platform.release(), 'architecture': platform.machine()},
                    'locale': {'requested': requested, 'observed': observed, 'ui': settings.getPropertyValue('ooLocale'), 'decimalSeparator': locale_data.getLocaleItem(locale).decimalSeparator, 'decimalSeparatorAsLocale': settings.getPropertyValue('DecimalSeparatorAsLocale')},
                    'configurationSha256': hashlib.sha256(configuration).hexdigest(),
                }
                desktop = manager.createInstanceWithContext('com.sun.star.frame.Desktop', context)
                artifacts = []
                for artifact in manifest['artifacts']:
                    source = pathlib.Path(artifact['input']).resolve()
                    source_hash = digest(source)
                    pdf = directory / (artifact['stage'] + '.pdf')
                    pdf.unlink(missing_ok=True)
                    document = desktop.loadComponentFromURL(source.as_uri(), '_blank', 0, (prop('Hidden', True), prop('ReadOnly', True), prop('UpdateDocMode', uno.getConstantByName('com.sun.star.document.UpdateDocMode.NO_UPDATE')), prop('MacroExecutionMode', uno.getConstantByName('com.sun.star.document.MacroExecMode.NEVER_EXECUTE'))))
                    if document is None:
                        raise RuntimeError('LibreOffice could not open ' + str(source))
                    try:
                        pages = []
                        for index in range(document.DrawPages.Count):
                            page, paragraphs = document.DrawPages.getByIndex(index), []
                            for shape_index in range(page.Count):
                                shape = page.getByIndex(shape_index)
                                if not hasattr(shape, 'createEnumeration'):
                                    continue
                                enumeration = shape.createEnumeration()
                                while enumeration.hasMoreElements():
                                    paragraph = enumeration.nextElement()
                                    if not paragraph.String:
                                        continue  # Unused seed placeholders are not probe content.
                                    paragraphs.append({'text': paragraph.String, 'tabs': [
                                        {'positionHundredthMm': stop.Position, 'alignment': stop.Alignment.value, 'decimalCharacter': stop.DecimalChar.value}
                                        for stop in paragraph.ParaTabStops
                                    ]})
                            pages.append({'paragraphs': paragraphs})
                        document.storeToURL(pdf.as_uri(), (prop('FilterName', 'impress_pdf_Export'), prop('Overwrite', True)))
                    finally:
                        document.close(True)
                    if digest(source) != source_hash:
                        raise RuntimeError('Input PPTX changed while LibreOffice was rendering it')
                    artifacts.append({'stage': artifact['stage'], 'pptxSha256': source_hash, 'pdfSha256': digest(pdf), 'pages': pages, 'pdf': str(pdf)})
                return {'environment': environment, 'artifacts': artifacts}
            finally:
                if desktop is not None:
                    try:
                        desktop.terminate()
                    except Exception:
                        pass
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=5)


if __name__ == '__main__':
    def terminate(_signal, _frame):
        raise SystemExit('Text probe terminated')
    signal.signal(signal.SIGTERM, terminate)
    manifest_path = pathlib.Path(sys.argv[1])
    manifest = json.loads(manifest_path.read_text())
    result_path = pathlib.Path(manifest['directory']) / 'observations.json'
    result_path.unlink(missing_ok=True)
    result_path.write_text(json.dumps(probe(manifest), ensure_ascii=False, indent=2) + '\n')
